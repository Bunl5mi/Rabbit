import {
  escapeHtml,
  htmlResponse
} from "./http.js";

const ADMIN_STYLE = `
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
    max-width: 760px;
    margin: auto;
  }

  h1 {
    margin: 0;
    font-size: 23px;
  }

  h2 {
    margin: 0 0 18px;
    font-size: 17px;
  }

  p {
    line-height: 1.8;
    overflow-wrap: anywhere;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }

  .card {
    margin-bottom: 18px;
    padding: 20px;
    border: 1px solid #deded5;
    border-radius: 14px;
    background: #fff;
  }

  .muted {
    color: #787c70;
    font-size: 13px;
  }

  .message {
    padding: 14px;
    border: 1px solid #d9deca;
    border-radius: 10px;
    background: #f0f4e8;
    overflow-wrap: anywhere;
  }

  label {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 14px;
  }

  input,
  textarea,
  button {
    font: inherit;
  }

  input,
  textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid #d7d9cf;
    border-radius: 8px;
    background: #fff;
    color: inherit;
    font-size: 16px;
  }

  textarea {
    min-height: 120px;
    resize: vertical;
    overflow-wrap: anywhere;
  }

  button,
  .link-button {
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

  input:focus-visible,
  textarea:focus-visible,
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid #687454;
    outline-offset: 3px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }

  .actions form {
    margin: 0;
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
    font-size: 13px;
    line-height: 1.6;
  }

  .check input {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    margin-top: 2px;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 22px;
  }

  .badge {
    display: inline-block;
    padding: 4px 9px;
    border-radius: 20px;
    background: #f0f1e9;
    font-size: 12px;
  }
`;

function formatTime(value) {
  const seconds = Number(value);

  if (!Number.isFinite(seconds)) {
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
  }).format(new Date(seconds * 1000));
}

function hidden(name, value) {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function documentPage(title, content, message = "") {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)} · 工作室管理</title>
  <style>${ADMIN_STYLE}</style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <form method="post" action="/__admin/logout">
        <button class="secondary" type="submit">退出管理</button>
      </form>
    </header>
    ${message ? `<p class="message" role="status">${escapeHtml(message)}</p>` : ""}
    ${content}
    <p class="muted">时间按北京时间显示。管理页面不保存聊天内容或本地草稿。</p>
  </main>
</body>
</html>`;
}

function accessCodeCard(code) {
  const id = String(code.id);
  const enabled = Number(code.enabled) === 1;

  return `
    <section class="card">
      <h2>${escapeHtml(code.label)}</h2>
      <span class="badge">${enabled ? "已启用" : "已禁用"}</span>
      <p>浏览器：${escapeHtml(code.bound_browsers)} / ${escapeHtml(code.max_browsers)}</p>
      <p class="muted">创建时间：${escapeHtml(formatTime(code.created_at))}</p>

      <form method="post" action="/__admin/codes/label">
        ${hidden("id", id)}
        <label>
          密码备注
          <input name="label" value="${escapeHtml(code.label)}" maxlength="80" required>
        </label>
        <button class="secondary" type="submit">保存备注</button>
      </form>

      <form class="divider" method="post" action="/__admin/codes/limit">
        ${hidden("id", id)}
        <label>
          浏览器名额上限
          <input type="number" name="maxBrowsers" value="${escapeHtml(code.max_browsers)}" min="1" max="20" step="1" required>
        </label>
        <button class="secondary" type="submit">调整名额</button>
      </form>

      <div class="actions">
        <a class="link-button secondary" href="/__admin/bindings?id=${encodeURIComponent(id)}">查看浏览器</a>
        ${
          enabled
            ? ""
            : `<form method="post" action="/__admin/codes/enable">
                ${hidden("id", id)}
                <button type="submit">恢复资格</button>
              </form>`
        }
      </div>

      ${
        enabled
          ? `<form class="divider" method="post" action="/__admin/codes/disable">
              ${hidden("id", id)}
              <label class="check">
                <input type="checkbox" name="confirm" value="yes" required>
                我确认禁用此密码，并撤销其登录会话
              </label>
              <button class="danger" type="submit">禁用密码</button>
            </form>`
          : ""
      }
    </section>
  `;
}

export function adminDashboardPage({
  codes = [],
  page = 1,
  message = ""
} = {}) {
  const currentPage = Math.max(1, Number(page) || 1);

  const content = `
    <section class="card">
      <h2>创建访问密码</h2>
      <form method="post" action="/__admin/codes/create">
        <label>
          备注
          <input name="label" placeholder="例如：朋友 A" maxlength="80" required>
        </label>
        <label>
          最多绑定几个浏览器
          <input type="number" name="maxBrowsers" value="2" min="1" max="20" step="1" required>
        </label>
        <button type="submit">生成独立密码</button>
      </form>
      <p class="muted">完整密码只在创建成功后显示，请及时保存。</p>
    </section>

    <h2>访问资格 · 第 ${escapeHtml(currentPage)} 页</h2>

    ${
      codes.length
        ? codes.map(accessCodeCard).join("")
        : '<section class="card"><p class="muted">这一页还没有访问资格。</p></section>'
    }

    <nav aria-label="列表分页">
      ${
        currentPage > 1
          ? `<a class="link-button secondary" href="/__admin?page=${currentPage - 1}">上一页</a>`
          : ""
      }
      ${
        codes.length === 50
          ? `<a class="link-button secondary" href="/__admin?page=${currentPage + 1}">下一页</a>`
          : ""
      }
    </nav>
  `;

  return htmlResponse(
    documentPage("工作室管理", content, message)
  );
}

export function accessCodeCreatedPage({
  label,
  password,
  maxBrowsers
}) {
  const content = `
    <section class="card">
      <h2>${escapeHtml(label)}</h2>
      <p>浏览器名额：${escapeHtml(maxBrowsers)}</p>

      <label>
        完整访问密码
        <textarea readonly spellcheck="false" autocomplete="off">${escapeHtml(password)}</textarea>
      </label>

      <p class="muted">手机长按密码框，选择全选并复制。请先保存，再私下发送给对应的人。</p>
      <p class="muted">关闭此页面后，管理列表不会再次显示原始密码。请勿刷新或重复提交此页面；浏览器提示重新提交时，请取消。</p>

      <a class="link-button" href="/__admin">已保存，返回管理</a>
    </section>
  `;

  return htmlResponse(
    documentPage("密码已创建", content)
  );
}

export function browserBindingsPage({
  accessCode,
  bindings = [],
  message = ""
}) {
  const cards = bindings.map(binding => `
    <section class="card">
      <h2>${escapeHtml(binding.browser_label || "未知浏览器")}</h2>
      <p class="muted">绑定时间：${escapeHtml(formatTime(binding.created_at))}</p>
      <p class="muted">最近验证：${escapeHtml(formatTime(binding.last_verified_at))}</p>
      <p class="muted">绑定编号：${escapeHtml(binding.id)}</p>

      <form method="post" action="/__admin/bindings/revoke">
        ${hidden("accessCodeId", accessCode.id)}
        ${hidden("bindingId", binding.id)}
        <label class="check">
          <input type="checkbox" name="confirm" value="yes" required>
          我确认移除此绑定，撤销登录并释放名额
        </label>
        <button class="danger" type="submit">移除浏览器</button>
      </form>
    </section>
  `).join("");

  const content = `
    <section class="card">
      <h2>${escapeHtml(accessCode.label)}</h2>
      <p>已绑定 ${escapeHtml(bindings.length)} / ${escapeHtml(accessCode.max_browsers)} 个浏览器</p>
      <p class="muted">移除后，该浏览器的旧会话失效。但持有有效访问密码的人，仍可在有空余名额时重新绑定。如需阻止其继续访问，请禁用该密码。</p>
      <a class="link-button secondary" href="/__admin">返回管理列表</a>
    </section>

    ${cards || '<section class="card"><p class="muted">目前没有有效浏览器绑定。</p></section>'}
  `;

  return htmlResponse(
    documentPage("浏览器绑定", content, message)
  );
}
