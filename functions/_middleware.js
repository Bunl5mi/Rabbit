import {
  COOKIE_NAMES,
  DEVICE_SECONDS,
  readCookie,
  makeCookie,
  clearCookie,
  isSameOriginPost,
  readSmallForm,
  singleFormValue,
  privateHeaders,
  htmlResponse,
  redirectResponse,
  unavailableResponse,
  forbiddenResponse
} from "./_lib/http.js";

import {
  findBrowserBinding,
  createBrowserBinding,
  listBrowserBindings,
  revokeBrowserBinding
} from "./_lib/bindings.js";

import {
  SESSION_SECONDS,
  createLoginSession,
  verifyLoginSession,
  touchBrowserBinding,
  revokeLoginSession,
  cleanupExpiredSessions
} from "./_lib/sessions.js";

import {
  createAccessCode,
  verifyAccessCode,
  listAccessCodes,
  updateAccessCodeLabel,
  updateBrowserLimit,
  disableAccessCode,
  enableAccessCode
} from "./_lib/access-codes.js";

import {
  verifyAdminPassword,
  createAdminCookie,
  verifyAdminSession,
  clearAdminCookie
} from "./_lib/admin.js";

import {
  checkLoginRateLimit,
  cleanupLoginRateLimits
} from "./_lib/rate-limit.js";

import {
  visitorLoginPage,
  adminLoginPage
} from "./_lib/login-pages.js";

import {
  adminDashboardPage,
  accessCodeCreatedPage,
  browserBindingsPage
} from "./_lib/admin-pages.js";

const ADMIN_ACTIONS = new Set([
  "/__admin/codes/create",
  "/__admin/codes/label",
  "/__admin/codes/limit",
  "/__admin/codes/disable",
  "/__admin/codes/enable",
  "/__admin/bindings/revoke"
]);

const FORM_ERRORS = new Set([
  "UNSUPPORTED_FORM_TYPE",
  "INVALID_CONTENT_LENGTH",
  "FORM_TOO_LARGE",
  "INVALID_FORM_FIELD",
  "INVALID_LABEL",
  "INVALID_BROWSER_LIMIT",
  "INVALID_PAGE",
  "INVALID_ID",
  "CONFIRMATION_REQUIRED"
]);

const NOTICE_TEXT = Object.freeze({
  label: "备注已保存。",
  limit: "浏览器名额已更新。",
  limit_failed:
    "未能调整名额。请确认该密码仍存在，并先移除超过新上限的浏览器绑定。",
  disabled: "访问密码已禁用，相关登录会话已撤销。",
  enabled: "访问资格已恢复，使用者需要重新登录。",
  revoked: "浏览器绑定已移除，对应登录会话已撤销。",
  missing: "没有找到这条访问资格。"
});

function textResponse(message, status = 400, extra = {}) {
  return new Response(message, {
    status,
    headers: privateHeaders({
      "Content-Type": "text/plain; charset=UTF-8",
      ...extra
    })
  });
}

function methodNotAllowed(allow) {
  return textResponse(
    "此地址不支持当前请求方式。",
    405,
    { Allow: allow }
  );
}

function requireConfig(env) {
  if (
    !env.DB ||
    typeof env.ADMIN_PASSWORD !== "string" ||
    env.ADMIN_PASSWORD.length < 20 ||
    env.ADMIN_PASSWORD.length > 1024 ||
    typeof env.AUTH_SECRET !== "string" ||
    env.AUTH_SECRET.length < 32
  ) {
    throw new Error("AUTH_CONFIG_INVALID");
  }
}

function requireId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ) {
    throw new Error("INVALID_ID");
  }

  return value;
}

function formId(form, name = "id") {
  return requireId(singleFormValue(form, name));
}

function requireConfirmation(form) {
  if (singleFormValue(form, "confirm") !== "yes") {
    throw new Error("CONFIRMATION_REQUIRED");
  }
}

async function getForm(request) {
  try {
    return await readSmallForm(request);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("INVALID_FORM_FIELD");
    }

    throw error;
  }
}

function runCleanup(context) {
  context.waitUntil(
    Promise.all([
      cleanupExpiredSessions(context.env),
      cleanupLoginRateLimits(context.env)
    ]).catch(() => {
      console.error("AUTH_CLEANUP_FAILED");
    })
  );
}

function adminRedirect(request, notice) {
  return redirectResponse(
    request,
    `/__admin?notice=${encodeURIComponent(notice)}`
  );
}

async function getAccessCode(env, id) {
  return env.DB.prepare(`
    SELECT id, label, max_browsers, enabled
    FROM access_codes
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();
}

function logoutPage() {
  return htmlResponse(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>退出工具箱</title>
  <style>
    body {
      margin: 0;
      padding: 32px 20px;
      background: #f8f8f4;
      color: #42443d;
      font-family: sans-serif;
    }
    main {
      max-width: 400px;
      margin: 40px auto;
      padding: 24px;
      background: white;
      border: 1px solid #deded5;
      border-radius: 14px;
    }
    p { line-height: 1.8; }
    button {
      padding: 12px 20px;
      background: #626957;
      color: white;
      border: 0;
      border-radius: 8px;
      font: inherit;
    }
    a {
      display: inline-block;
      margin-top: 20px;
      color: #626957;
    }
  </style>
</head>
<body>
  <main>
    <h1>退出工具箱</h1>
    <p>退出会结束当前登录，但不会释放浏览器名额，也不会清除本地草稿。</p>
    <form method="post" action="/__logout">
      <button type="submit">确认退出</button>
    </form>
    <a href="/">返回工具箱</a>
  </main>
</body>
</html>`);
}

async function visitorLogin(context) {
  const { request, env } = context;

  const rate = await checkLoginRateLimit(
    request,
    env,
    "visitor"
  );

  if (!rate.allowed) {
    return visitorLoginPage({
      message:
        `提交过于频繁，请约 ${Math.ceil(rate.retryAfter / 60)} 分钟后再试。`,
      status: 429,
      retryAfter: rate.retryAfter
    });
  }

  const form = await getForm(request);
  const password = singleFormValue(form, "password");
  const accessCode = await verifyAccessCode(env, password);

  if (!accessCode) {
    return visitorLoginPage({
      message: "访问密码不正确或已被禁用，请检查后重试。",
      status: 401
    });
  }

  let deviceToken = readCookie(
    request,
    COOKIE_NAMES.device
  );

  let binding = await findBrowserBinding(
    env,
    accessCode.id,
    deviceToken
  );

  if (!binding) {
    const created = await createBrowserBinding(
      env,
      accessCode.id,
      request.headers.get("User-Agent") || ""
    );

    if (!created.ok) {
      return visitorLoginPage({
        message:
          created.reason === "BROWSER_LIMIT_REACHED"
            ? "浏览器名额已满，请使用已绑定的浏览器，或联系作者解除旧绑定。"
            : "此访问密码暂时不可用，请联系作者。",
        status: 403
      });
    }

    deviceToken = created.deviceToken;
    binding = { id: created.bindingId };
  }

  const session = await createLoginSession(
    env,
    binding.id,
    deviceToken
  );

  if (!session) {
    return visitorLoginPage({
      message: "访问资格发生变化，请联系作者后重试。",
      status: 403,
      cookies: [
        makeCookie(
          COOKIE_NAMES.device,
          deviceToken,
          DEVICE_SECONDS
        )
      ]
    });
  }

  context.waitUntil(
    touchBrowserBinding(env, binding.id).catch(() => {
      console.error("BINDING_TOUCH_FAILED");
    })
  );

  runCleanup(context);

  return redirectResponse(request, "/", [
    makeCookie(
      COOKIE_NAMES.device,
      deviceToken,
      DEVICE_SECONDS
    ),
    makeCookie(
      COOKIE_NAMES.session,
      session.sessionToken,
      SESSION_SECONDS
    ),
    "bunny_auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  ]);
}

async function administratorLogin(context) {
  const { request, env } = context;

  const rate = await checkLoginRateLimit(
    request,
    env,
    "admin"
  );

  if (!rate.allowed) {
    return adminLoginPage({
      message:
        `提交过于频繁，请约 ${Math.ceil(rate.retryAfter / 60)} 分钟后再试。`,
      status: 429,
      retryAfter: rate.retryAfter
    });
  }

  const form = await getForm(request);
  const password = singleFormValue(form, "password");

  if (!(await verifyAdminPassword(env, password))) {
    return adminLoginPage({
      message: "管理员密码不正确。",
      status: 401
    });
  }

  const cookie = await createAdminCookie(request, env);

  runCleanup(context);

  return redirectResponse(
    request,
    "/__admin",
    [cookie]
  );
}

async function administratorAction(context, path) {
  const { request, env } = context;
  const form = await getForm(request);

  if (path === "/__admin/codes/create") {
    const created = await createAccessCode(
      env,
      singleFormValue(form, "label"),
      singleFormValue(form, "maxBrowsers")
    );

    return accessCodeCreatedPage(created);
  }

  if (path === "/__admin/codes/label") {
    const changed = await updateAccessCodeLabel(
      env,
      formId(form),
      singleFormValue(form, "label")
    );

    return adminRedirect(
      request,
      changed ? "label" : "missing"
    );
  }

  if (path === "/__admin/codes/limit") {
    const changed = await updateBrowserLimit(
      env,
      formId(form),
      singleFormValue(form, "maxBrowsers")
    );

    return adminRedirect(
      request,
      changed ? "limit" : "limit_failed"
    );
  }

  if (path === "/__admin/codes/disable") {
    requireConfirmation(form);
    await disableAccessCode(env, formId(form));

    return adminRedirect(request, "disabled");
  }

  if (path === "/__admin/codes/enable") {
    const changed = await enableAccessCode(
      env,
      formId(form)
    );

    return adminRedirect(
      request,
      changed ? "enabled" : "missing"
    );
  }

  if (path === "/__admin/bindings/revoke") {
    requireConfirmation(form);

    const accessCodeId = formId(form, "accessCodeId");
    const bindingId = formId(form, "bindingId");

    await revokeBrowserBinding(
      env,
      accessCodeId,
      bindingId
    );

    return redirectResponse(
      request,
      `/__admin/bindings?id=${encodeURIComponent(accessCodeId)}&notice=revoked`
    );
  }

  return textResponse("没有找到此操作。", 404);
}

async function administratorRoutes(context, path) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isGet = request.method === "GET";

  if (path === "/__admin/login") {
    if (isGet) {
      if (await verifyAdminSession(request, env)) {
        return redirectResponse(request, "/__admin");
      }

      return adminLoginPage();
    }

    if (request.method !== "POST") {
      return methodNotAllowed("GET, POST");
    }

    return administratorLogin(context);
  }

  if (!(await verifyAdminSession(request, env))) {
    if (isGet) {
      return redirectResponse(
        request,
        "/__admin/login"
      );
    }

    return adminLoginPage({
      message: "管理员登录已失效，请重新登录后再操作。",
      status: 401
    });
  }

  if (path === "/__admin/logout") {
    if (request.method !== "POST") {
      return methodNotAllowed("POST");
    }

    return redirectResponse(
      request,
      "/__admin/login",
      [clearAdminCookie()]
    );
  }

  if (path === "/__admin") {
    if (!isGet) {
      return methodNotAllowed("GET");
    }

    const page = Number(url.searchParams.get("page") || "1");
    const codes = await listAccessCodes(env, page);
    const notice = url.searchParams.get("notice") || "";

    return adminDashboardPage({
      codes,
      page,
      message: Object.prototype.hasOwnProperty.call(
        NOTICE_TEXT,
        notice
      ) ? NOTICE_TEXT[notice] : ""
    });
  }

  if (path === "/__admin/bindings") {
    if (!isGet) {
      return methodNotAllowed("GET");
    }

    const id = requireId(url.searchParams.get("id"));
    const accessCode = await getAccessCode(env, id);

    if (!accessCode) {
      return textResponse("没有找到这条访问资格。", 404);
    }

    const bindings = await listBrowserBindings(env, id);

    return browserBindingsPage({
      accessCode,
      bindings,
      message:
        url.searchParams.get("notice") === "revoked"
          ? NOTICE_TEXT.revoked
          : ""
    });
  }

  if (ADMIN_ACTIONS.has(path)) {
    if (request.method !== "POST") {
      return methodNotAllowed("POST");
    }

    return administratorAction(context, path);
  }

  return textResponse("没有找到此管理页面。", 404);
}

async function handleRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  requireConfig(env);

  if (url.protocol !== "https:") {
    return textResponse("请使用 HTTPS 地址访问。", 400);
  }

if (
    request.method === "POST" &&
    !isSameOriginPost(request)
  ) {
    return textResponse(
      [
        "请求未通过安全检查",
        "",
        `当前站点：${url.origin}`,
        `提交来源：${request.headers.get("Origin") || "未提供"}`,
        `来源类型：${request.headers.get("Sec-Fetch-Site") || "未提供"}`,
        `请求路径：${url.pathname}`
      ].join("\n"),
      403
    );
  }

  if (
    path === "/functions" ||
    path.startsWith("/functions/") ||
    path === "/_routes.json"
  ) {
    return textResponse("没有找到此页面。", 404);
  }

  if (
    path === "/__admin" ||
    path.startsWith("/__admin/")
  ) {
    return administratorRoutes(context, path);
  }

  if (path === "/__login") {
    if (request.method === "GET") {
      return visitorLoginPage();
    }

    if (request.method !== "POST") {
      return methodNotAllowed("GET, POST");
    }

    return visitorLogin(context);
  }

  if (path === "/__logout") {
    if (request.method === "GET") {
      return logoutPage();
    }

    if (request.method !== "POST") {
      return methodNotAllowed("GET, POST");
    }

    await revokeLoginSession(
      env,
      readCookie(request, COOKIE_NAMES.session)
    );

    return redirectResponse(request, "/__login", [
      clearCookie(COOKIE_NAMES.session),
      "bunny_auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    ]);
  }

  if (
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    return methodNotAllowed("GET, HEAD");
  }

  const session = await verifyLoginSession(
    env,
    readCookie(request, COOKIE_NAMES.session),
    readCookie(request, COOKIE_NAMES.device)
  );

  if (!session) {
    return visitorLoginPage({
      status: 401
    });
  }

  const response = await context.next();
  const headers = privateHeaders(response.headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function onRequest(context) {
  let response;

  try {
    response = await handleRequest(context);
  } catch (error) {
    if (FORM_ERRORS.has(error?.message)) {
      response = textResponse(
        "提交内容不正确。请返回上一页，检查输入、名额范围及确认勾选后重试。",
        400
      );
    } else {
      console.error("AUTH_REQUEST_FAILED");
      response = unavailableResponse();
    }
  }

  if (context.request.method === "HEAD") {
    return new Response(null, {
      status: response.status,
      headers: response.headers
    });
  }

  return response;
}
