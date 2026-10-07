import {
  escapeHtml,
  htmlResponse,
  isSameOriginPost,
  forbiddenResponse,
  readSmallForm,
  singleFormValue,
  redirectResponse
} from "./http.js";

const PAGE_SIZE = 20;

const STYLE = `
  :root {
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
    color: #42443d;
    background: #f8f8f4;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 24px 16px 48px;
  }

  main {
    max-width: 820px;
    margin: auto;
  }

  h1 {
    margin: 0;
    font-size: 23px;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 17px;
    overflow-wrap: anywhere;
  }

  p {
    line-height: 1.8;
    overflow-wrap: anywhere;
  }

  header,
  .actions,
  nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  header {
    justify-content: space-between;
    margin-bottom: 24px;
  }

  .card {
    margin-bottom: 18px;
    padding: 20px;
    border: 1px solid #deded5;
    border-radius: 14px;
    background: #fff;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 20px;
  }

  .stat {
    padding: 15px 8px;
    border: 1px solid #deded5;
    border-radius: 12px;
    background: #fff;
    text-align: center;
  }

  .stat strong {
    display: block;
    margin-bottom: 6px;
    font-size: 24px;
  }

  .stat span,
  .muted {
    color: #787c70;
    font-size: 12px;
  }

  label {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 14px;
  }

  input,
  select,
  button {
    font: inherit;
  }

  input,
  select {
    width: 100%;
    min-height: 44px;
    padding: 11px;
    border: 1px solid #d7d9cf;
    border-radius: 8px;
    background: #fff;
    color: inherit;
    font-size: 16px;
  }

  button,
  .button {
    display: inline-block;
    min-height: 44px;
    padding: 11px 15px;
    border: 1px solid #626957;
    border-radius: 8px;
    background: #626957;
    color: #fff;
    text-decoration: none;
    text-align: center;
    cursor: pointer;
    touch-action: manipulation;
  }

  .secondary {
    background: #fff;
    color: #626957;
  }

  .danger {
    border-color: #a76860;
    background: #fff;
    color: #99564e;
  }

  :is(input, select, button, a, summary):focus-visible {
    outline: 2px solid #687454;
    outline-offset: 3px;
  }

  .divider {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid #ecece5;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    line-height: 1.6;
  }

  .check input {
    width: 18px;
    height: 18px;
    min-height: 18px;
    flex: 0 0 auto;
    margin-top: 2px;
  }

  .message {
    padding: 14px;
    border: 1px solid #d9deca;
    border-radius: 10px;
    background: #f0f4e8;
  }

  .badge {
    display: inline-block;
    padding: 4px 9px;
    border-radius: 20px;
    background: #f0f1e9;
    font-size: 12px;
  }

  summary {
    padding: 10px 0;
    cursor: pointer;
  }

  nav {
    margin: 24px 0;
  }
`;

const NOTICES = Object.freeze({
  label: "备注已保存。",
  limit: "浏览器名额已更新。",
  limit_failed:
    "未能调整名额。请先移除超过新上限的绑定，并确认访问资格仍存在。",
  disabled: "密码已禁用，相关登录会话已撤销。",
  enabled: "访问资格已恢复，旧会话不会恢复。",
  missing: "没有找到这条访问资格。",
  deleted: "访问密码及相关绑定、会话已永久删除。",
  delete_failed:
    "未删除。请确认密码已禁用，并完整输入当前备注。"
});

function hidden(name, value) {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function formatTime(value) {
  if (value === null || value === undefined) {
    return "暂无";
  }

  const date = new Date(Number(value) * 1000);

  if (!Number.isFinite(date.getTime())) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function pageDocument(content) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>工作室管理</title>
  <style>${STYLE}</style>
</head>
<body>
  <main>
    <header>
      <h1>工作室管理</h1>
      <form method="post" action="/__admin/logout">
        <button class="secondary" type="submit">退出管理</button>
      </form>
    </header>
    ${content}
    <p class="muted">时间按北京时间显示。浏览器绑定数不是实际人数或实时在线人数。</p>
  </main>
</body>
</html>`;
}

function codeCard(code) {
  const enabled = Number(code.enabled) === 1;
  const idField = hidden("id", code.id);

  return `
    <section class="card">
      <h2>${escapeHtml(code.label)}</h2>
      <span class="badge">${enabled ? "已启用" : "已禁用"}</span>
      <p>浏览器：${escapeHtml(code.bound_browsers)} / ${escapeHtml(code.max_browsers)}</p>
      <p class="muted">创建时间：${escapeHtml(formatTime(code.created_at))}</p>

      <div class="actions">
        <a class="button secondary" href="/__admin/bindings?id=${encodeURIComponent(code.id)}">查看浏览器</a>
        ${
          enabled
            ? ""
            : `<form method="post" action="/__admin/codes/enable">
                ${idField}
                <button type="submit">恢复资格</button>
              </form>`
        }
      </div>

      <details class="divider">
        <summary>修改备注与名额</summary>
        <form method="post" action="/__admin/codes/label">
          ${idField}
          <label>
            密码备注
            <input name="label" value="${escapeHtml(code.label)}" maxlength="80" required>
          </label>
          <button class="secondary" type="submit">保存备注</button>
        </form>

        <form class="divider" method="post" action="/__admin/codes/limit">
          ${idField}
          <label>
            浏览器名额上限
            <input type="number" name="maxBrowsers" value="${escapeHtml(code.max_browsers)}" min="1" max="20" step="1" required>
          </label>
          <button class="secondary" type="submit">调整名额</button>
        </form>
      </details>

      ${
        enabled
          ? `<details class="divider">
              <summary>禁用访问资格</summary>
              <form method="post" action="/__admin/codes/disable">
                ${idField}
                <label class="check">
                  <input type="checkbox" name="confirm" value="yes" required>
                  确认禁用此密码，并撤销其登录会话
                </label>
                <button class="danger" type="submit">禁用密码</button>
              </form>
            </details>`
          : `<details class="divider">
              <summary>永久删除访问资格</summary>
              <p class="muted">此操作无法撤销，会删除该密码的全部绑定和登录会话，不会删除用户的本地草稿。</p>
              <p>请输入完整备注：<strong>${escapeHtml(code.label)}</strong></p>
              <form method="post" action="/__admin/codes/delete">
                ${idField}
                <label>
                  确认备注
                  <input name="confirmLabel" maxlength="80" autocomplete="off" required>
                </label>
                <label class="check">
                  <input type="checkbox" name="confirm" value="yes" required>
                  我知道删除后无法恢复
                </label>
                <button class="danger" type="submit">永久删除</button>
              </form>
            </details>`
      }
    </section>
  `;
}

function listUrl(q, status, page) {
  const params = new URLSearchParams({
    q,
    status,
    page: String(page)
  });

  return `/__admin?${params.toString()}`;
}

export async function managementPage(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "all";
  const page = Number(url.searchParams.get("page") || "1");

  if (
    q.length > 80 ||
    !["all", "enabled", "disabled", "full"].includes(status) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000
  ) {
    throw new Error("INVALID_PAGE");
  }

  const conditions = [];
  const values = [];

  if (q) {
    conditions.push("instr(a.label, ?) > 0");
    values.push(q);
  }

  if (status === "enabled") {
    conditions.push("a.enabled = 1");
  } else if (status === "disabled") {
    conditions.push("a.enabled = 0");
  } else if (status === "full") {
    conditions.push(`
      a.enabled = 1
      AND (
        SELECT COUNT(*)
        FROM browser_bindings AS b
        WHERE b.access_code_id = a.id
          AND b.revoked_at IS NULL
      ) >= a.max_browsers
    `);
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const results = await env.DB.batch([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS enabled_codes,
        COALESCE(SUM(bound_browsers), 0) AS bound_browsers,
        COALESCE(
          SUM(MAX(max_browsers - bound_browsers, 0)),
          0
        ) AS remaining_slots
      FROM (
        SELECT
          a.max_browsers,
          (
            SELECT COUNT(*)
            FROM browser_bindings AS b
            WHERE b.access_code_id = a.id
              AND b.revoked_at IS NULL
          ) AS bound_browsers
        FROM access_codes AS a
        WHERE a.enabled = 1
      )
    `),

    env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM access_codes AS a
      ${where}
    `).bind(...values),

    env.DB.prepare(`
      SELECT
        a.id,
        a.label,
        a.enabled,
        a.max_browsers,
        a.created_at,
        (
          SELECT COUNT(*)
          FROM browser_bindings AS b
          WHERE b.access_code_id = a.id
            AND b.revoked_at IS NULL
        ) AS bound_browsers
      FROM access_codes AS a
      ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `).bind(
      ...values,
      PAGE_SIZE,
      (page - 1) * PAGE_SIZE
    )
  ]);

  const stats = results[0].results[0];
  const total = Number(results[1].results[0].total);
  const codes = results[2].results || [];
  const totalPages = Math.max(
    1,
    Math.ceil(total / PAGE_SIZE)
  );

  const noticeKey = url.searchParams.get("notice") || "";
  const notice = Object.prototype.hasOwnProperty.call(
    NOTICES,
    noticeKey
  ) ? NOTICES[noticeKey] : "";

  const options = [
    ["all", "全部资格"],
    ["enabled", "已启用"],
    ["disabled", "已禁用"],
    ["full", "已启用且名额已满"]
  ].map(([value, label]) => `
    <option value="${value}"${status === value ? " selected" : ""}>
      ${label}
    </option>
  `).join("");

  const content = `
    ${
      notice
        ? `<p class="message" role="status">${escapeHtml(notice)}</p>`
        : ""
    }

    <div class="stats">
      <div class="stat">
        <strong>${escapeHtml(stats.enabled_codes)}</strong>
        <span>有效密码</span>
      </div>
      <div class="stat">
        <strong>${escapeHtml(stats.bound_browsers)}</strong>
        <span>有效密码已用名额</span>
      </div>
      <div class="stat">
        <strong>${escapeHtml(stats.remaining_slots)}</strong>
        <span>有效密码剩余名额</span>
      </div>
    </div>

    <p class="muted">顶部统计涵盖全部已启用密码，不随下方搜索和筛选变化。</p>

    <section class="card">
      <h2>创建访问密码</h2>
      <form method="post" action="/__admin/codes/create">
        <label>
          备注
          <input name="label" placeholder="例如：社区第 1 组" maxlength="80" required>
        </label>
        <label>
          浏览器上限
          <input type="number" name="maxBrowsers" value="2" min="1" max="20" step="1" required>
        </label>
        <button type="submit">生成独立密码</button>
      </form>
      <p class="muted">完整密码只在创建结果页显示，离开前请保存。</p>
    </section>

    <section class="card">
      <h2>搜索与筛选</h2>
      <form method="get" action="/__admin">
        <label>
          搜索备注
          <input name="q" value="${escapeHtml(q)}" maxlength="80" placeholder="输入备注中的文字">
        </label>
        <label>
          资格状态
          <select name="status">${options}</select>
        </label>
        <div class="actions">
          <button type="submit">查询</button>
          <a class="button secondary" href="/__admin">清除条件</a>
        </div>
      </form>
    </section>

    <h2>访问资格 · 共 ${escapeHtml(total)} 条</h2>

    ${
      codes.length
        ? codes.map(codeCard).join("")
        : '<section class="card"><p class="muted">当前没有符合条件的记录。</p></section>'
    }

    <nav aria-label="列表分页">
      ${
        page > 1
          ? `<a class="button secondary" href="${escapeHtml(listUrl(q, status, page - 1))}">上一页</a>`
          : ""
      }
      <span class="muted">第 ${escapeHtml(page)} 页 / 共 ${escapeHtml(totalPages)} 页</span>
      ${
        page < totalPages
          ? `<a class="button secondary" href="${escapeHtml(listUrl(q, status, page + 1))}">下一页</a>`
          : ""
      }
    </nav>
  `;

  return htmlResponse(pageDocument(content));
}

export async function deleteAccessCodeRequest(
  request,
  env
) {
  if (!isSameOriginPost(request)) {
    return forbiddenResponse();
  }

  let form;

  try {
    form = await readSmallForm(request);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("INVALID_FORM_FIELD");
    }

    throw error;
  }

  const id = singleFormValue(form, "id");
  const label = singleFormValue(form, "confirmLabel");
  const confirmation = singleFormValue(form, "confirm");

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  ) {
    throw new Error("INVALID_ID");
  }

  if (confirmation !== "yes") {
    throw new Error("CONFIRMATION_REQUIRED");
  }

  if (!label || label.length > 80) {
    throw new Error("INVALID_LABEL");
  }

  const results = await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM login_sessions
      WHERE browser_binding_id IN (
        SELECT b.id
        FROM browser_bindings AS b
        JOIN access_codes AS a
          ON a.id = b.access_code_id
        WHERE a.id = ?
          AND a.enabled = 0
          AND a.label = ?
      )
    `).bind(id, label),

    env.DB.prepare(`
      DELETE FROM browser_bindings
      WHERE access_code_id IN (
        SELECT id
        FROM access_codes
        WHERE id = ?
          AND enabled = 0
          AND label = ?
      )
    `).bind(id, label),

    env.DB.prepare(`
      DELETE FROM access_codes
      WHERE id = ?
        AND enabled = 0
        AND label = ?
    `).bind(id, label)
  ]);

  const deleted =
    Number(results[2].meta?.changes) === 1;

  return redirectResponse(
    request,
    deleted
      ? "/__admin?notice=deleted"
      : "/__admin?notice=delete_failed"
  );
}
