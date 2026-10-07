import {
  escapeHtml,
  htmlResponse
} from "./http.js";

const LOGIN_STYLE = `
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

  html {
    min-height: 100%;
  }

  body {
    min-height: 100vh;
    min-height: 100svh;
    display: grid;
    place-items: center;
    margin: 0;
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

  h1 {
    margin: 0 0 10px;
    font-size: 20px;
    font-weight: normal;
    letter-spacing: 0.04em;
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

  .field-label {
    text-align: left;
    font-size: 12px;
    color: var(--muted);
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
  }

  input:focus-visible,
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid #777970;
    outline-offset: 3px;
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
    touch-action: manipulation;
  }

  .message {
    margin: 0 0 18px;
    padding: 10px 12px;
    border: 1px solid #e8d8d3;
    background: #fcf7f5;
    color: #9b5d58;
    font-size: 13px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }

  .tips {
    margin: 20px 0 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.9;
    text-align: left;
  }

  .note {
    margin: 22px 0 0;
    color: #aaa9a1;
    font-size: 10px;
    letter-spacing: 0.05em;
    line-height: 1.7;
    text-transform: uppercase;
  }

  .back-link {
    display: inline-block;
    margin-top: 18px;
    padding: 8px;
    color: var(--muted);
    font-size: 12px;
    text-underline-offset: 4px;
  }
`;

function loginDocument({
  title,
  heading,
  intro,
  action,
  label,
  buttonText,
  maxLength,
  tips,
  note,
  message,
  showBackLink
}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <style>${LOGIN_STYLE}</style>
</head>
<body>
  <main class="login-card">
    <img
      class="avatar"
      src="https://s3.bmp.ovh/2026/09/27/A6dP87wQ.jpg"
      alt="工具箱头像"
      width="96"
      height="96"
      referrerpolicy="no-referrer"
    >

    <h1>${escapeHtml(heading)}</h1>

    <p class="intro">${escapeHtml(intro)}</p>

    ${
      message
        ? `<p class="message" role="alert">${escapeHtml(message)}</p>`
        : ""
    }

    <form
      method="post"
      action="${escapeHtml(action)}"
      enctype="application/x-www-form-urlencoded"
      autocomplete="on"
    >
      <label class="field-label" for="password">
        ${escapeHtml(label)}
      </label>

      <input
        id="password"
        type="password"
        name="password"
        placeholder="${escapeHtml(label)}"
        autocomplete="current-password"
        autocapitalize="none"
        spellcheck="false"
        maxlength="${maxLength}"
        aria-describedby="login-tips"
        required
      >

      <button type="submit">
        ${escapeHtml(buttonText)}
      </button>
    </form>

    <p class="tips" id="login-tips">
      ${escapeHtml(tips)}
    </p>

    ${
      showBackLink
        ? '<a class="back-link" href="/">返回工具箱</a>'
        : ""
    }

    <p class="note">${escapeHtml(note)}</p>
  </main>
</body>
</html>`;
}

function makeLoginResponse(
  settings,
  {
    message = "",
    status = 200,
    retryAfter = 0,
    cookies = []
  } = {}
) {
  const response = htmlResponse(
    loginDocument({
      ...settings,
      message
    }),
    status,
    cookies
  );

  if (
    status === 429 &&
    Number.isSafeInteger(retryAfter) &&
    retryAfter > 0
  ) {
    response.headers.set(
      "Retry-After",
      String(retryAfter)
    );
  }

  return response;
}

export function visitorLoginPage(options = {}) {
  return makeLoginResponse(
    {
      title: "Bunny & Fawn Studio",
      heading: "Bunny & Fawn",
      intro: "请输入你的专属访问密码",
      action: "/__login",
      label: "访问密码",
      buttonText: "进入工具箱",
      maxLength: 256,
      tips:
        "每个访问密码默认可绑定两个浏览器，具体以作者设置为准。请使用常用浏览器，避免无痕模式或清除网站数据。名额已满时，请联系作者处理。请勿转发访问密码。",
      note: "Private studio access",
      showBackLink: false
    },
    options
  );
}

export function adminLoginPage(options = {}) {
  return makeLoginResponse(
    {
      title: "工具箱管理 · Lunelle",
      heading: "Studio Management",
      intro: "此入口仅供工具箱作者使用",
      action: "/__admin/login",
      label: "管理员密码",
      buttonText: "进入管理页",
      maxLength: 1024,
      tips:
        "请输入独立的管理员密码，普通访问密码无法进入。请勿在公共设备上登录，管理结束后请退出。",
      note: "Author access only",
      showBackLink: true
    },
    options
  );
}
