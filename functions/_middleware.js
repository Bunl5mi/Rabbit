const COOKIE_NAME = "bunny_auth";
const LOGIN_PATH = "/__login";
const LOGOUT_PATH = "/__logout";

/* 登录保持 7 天 */
const SESSION_SECONDS = 7 * 24 * 60 * 60;

const encoder = new TextEncoder();

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value) {
  return crypto.subtle.digest(
    "SHA-256",
    encoder.encode(String(value))
  );
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(String(value))
  );

  return toBase64Url(signature);
}

function safeEqual(first, second) {
  const a = String(first);
  const b = String(second);

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < a.length; index += 1) {
    difference |=
      a.charCodeAt(index) ^
      b.charCodeAt(index);
  }

  return difference === 0;
}

function readCookie(request, name) {
  const cookieHeader =
    request.headers.get("Cookie") || "";

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const cookieName =
      cookie.slice(0, separator).trim();

    if (cookieName !== name) {
      continue;
    }

    return cookie
      .slice(separator + 1)
      .trim();
  }

  return "";
}

async function getPasswordFingerprint(password) {
  return toBase64Url(
    await sha256(password)
  );
}

async function createSession(env) {
  const expiresAt =
    Math.floor(Date.now() / 1000) +
    SESSION_SECONDS;

  const passwordFingerprint =
    await getPasswordFingerprint(
      env.SITE_PASSWORD
    );

  const signature = await hmac(
    `${expiresAt}.${passwordFingerprint}`,
    env.AUTH_SECRET
  );

  return `${expiresAt}.${signature}`;
}

async function verifySession(request, env) {
  const cookieValue = readCookie(
    request,
    COOKIE_NAME
  );

  if (!cookieValue) {
    return false;
  }

  const separator =
    cookieValue.indexOf(".");

  if (separator === -1) {
    return false;
  }

  const expiresText =
    cookieValue.slice(0, separator);

  const suppliedSignature =
    cookieValue.slice(separator + 1);

  const expiresAt = Number(expiresText);
  const currentTime =
    Math.floor(Date.now() / 1000);

  if (
    !Number.isInteger(expiresAt) ||
    expiresAt <= currentTime
  ) {
    return false;
  }

  const passwordFingerprint =
    await getPasswordFingerprint(
      env.SITE_PASSWORD
    );

  const expectedSignature = await hmac(
    `${expiresAt}.${passwordFingerprint}`,
    env.AUTH_SECRET
  );

  return safeEqual(
    suppliedSignature,
    expectedSignature
  );
}

async function verifyPassword(
  suppliedPassword,
  correctPassword
) {
  const [suppliedHash, correctHash] =
    await Promise.all([
      sha256(suppliedPassword),
      sha256(correctPassword)
    ]);

  const suppliedBytes =
    new Uint8Array(suppliedHash);

  const correctBytes =
    new Uint8Array(correctHash);

  let difference = 0;

  for (
    let index = 0;
    index < suppliedBytes.length;
    index += 1
  ) {
    difference |=
      suppliedBytes[index] ^
      correctBytes[index];
  }

  return difference === 0;
}

function securityHeaders() {
  return {
    "Content-Type":
      "text/html; charset=UTF-8",

    "Cache-Control":
      "no-store, private",

    "X-Content-Type-Options":
      "nosniff",

    "X-Frame-Options":
      "DENY",

    "Referrer-Policy":
      "no-referrer",

    "Content-Security-Policy":
      "default-src 'none'; img-src https://s3.bmp.ovh; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function loginPage(
  message = "",
  status = 200
) {
  const safeMessage = String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <title>Bunny & Fawn Studio</title>

  <style>
    :root {
      color-scheme: light;
      --paper: #fdfdfb;
      --ink: #3f403b;
      --muted: #92938c;
      --line: #deded7;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      min-height: 100%;
      margin: 0;
    }

    body {
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--paper);
      color: var(--ink);
      font-family:
        Georgia,
        "Times New Roman",
        serif;
    }

    .login-card {
      width: min(100%, 360px);
      padding: 36px 26px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.72);
      text-align: center;
    }

    .avatar {
      display: block;
      width: 96px;
      height: 96px;
      margin: 0 auto 18px;
      border: 1px solid var(--line);
      border-radius: 50%;
      object-fit: cover;
      object-position: center;
      background: #f2f2ee;
    }

    .intro {
      margin: 0 0 25px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.8;
    }

    form {
      display: grid;
      gap: 13px;
    }

    input {
      width: 100%;
      min-height: 46px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 0;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-size: 16px;
      outline: none;
    }

    input:focus {
      border-color: #777970;
    }

    button {
      min-height: 46px;
      padding: 11px 15px;
      border: 1px solid #66685f;
      border-radius: 0;
      background: #66685f;
      color: #fff;
      font: inherit;
      cursor: pointer;
    }

    .message {
      margin: 0 0 15px;
      color: #9b5d58;
      font-size: 13px;
      line-height: 1.6;
    }

    .note {
      margin: 22px 0 0;
      color: #aaa9a1;
      font-size: 10px;
      letter-spacing: 0.05em;
      line-height: 1.7;
      text-transform: uppercase;
    }
  </style>
</head>

<body>
  <main class="login-card">
    <img
      class="avatar"
      src="https://s3.bmp.ovh/2026/09/27/A6dP87wQ.jpg"
      alt="用户头像"
    >

    <p class="intro">
      请输入访问密码
    </p>

    ${
      safeMessage
        ? `<p class="message">${safeMessage}</p>`
        : ""
    }

    <form
      method="post"
      action="${LOGIN_PATH}"
      autocomplete="on"
    >
      <input
        type="password"
        name="password"
        placeholder="访问密码"
        autocomplete="current-password"
        required
        autofocus
      >

      <button type="submit">
        进入工作室
      </button>
    </form>

    <p class="note">
      Private studio access
    </p>
  </main>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: securityHeaders()
  });
}

function redirectTo(
  request,
  pathname,
  cookie = ""
) {
  const url = new URL(
    pathname,
    request.url
  );

  const headers = new Headers({
    Location: url.href,
    "Cache-Control": "no-store"
  });

  if (cookie) {
    headers.set(
      "Set-Cookie",
      cookie
    );
  }

  return new Response(null, {
    status: 303,
    headers
  });
}

export async function onRequest(context) {
  const {
    request,
    env,
    next
  } = context;

  const url = new URL(request.url);

  if (
    !env.SITE_PASSWORD ||
    !env.AUTH_SECRET
  ) {
    return new Response(
      "网站密码尚未配置。",
      {
        status: 503,
        headers: {
          "Content-Type":
            "text/plain; charset=UTF-8",

          "Cache-Control":
            "no-store"
        }
      }
    );
  }

  if (url.pathname === LOGOUT_PATH) {
    const expiredCookie =
      `${COOKIE_NAME}=; ` +
      "Path=/; " +
      "HttpOnly; " +
      "Secure; " +
      "SameSite=Strict; " +
      "Max-Age=0";

    return redirectTo(
      request,
      "/",
      expiredCookie
    );
  }

  if (
    url.pathname === LOGIN_PATH &&
    request.method === "POST"
  ) {
    let formData;

    try {
      formData =
        await request.formData();
    } catch {
      return loginPage(
        "提交内容无法读取，请重新输入。",
        400
      );
    }

    const suppliedPassword =
      String(
        formData.get("password") || ""
      );

    const passwordCorrect =
      await verifyPassword(
        suppliedPassword,
        env.SITE_PASSWORD
      );

    if (!passwordCorrect) {
      return loginPage(
        "密码不正确，请重新输入。",
        401
      );
    }

    const session =
      await createSession(env);

    const authCookie =
      `${COOKIE_NAME}=${session}; ` +
      "Path=/; " +
      "HttpOnly; " +
      "Secure; " +
      "SameSite=Strict; " +
      `Max-Age=${SESSION_SECONDS}`;

    return redirectTo(
      request,
      "/",
      authCookie
    );
  }

  if (
    await verifySession(request, env)
  ) {
    return next();
  }

  return loginPage();
}
