export const COOKIE_NAMES = Object.freeze({
  device: "__Host-rabbit_device",
  session: "__Host-rabbit_session",
  admin: "__Host-rabbit_admin"
});

export const DEVICE_SECONDS = 365 * 24 * 60 * 60;
export const ADMIN_SECONDS = 2 * 60 * 60;

export function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const matches = [];

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      matches.push(part.slice(separator + 1).trim());
    }
  }

  return matches.length === 1 ? matches[0] : "";
}

export function makeCookie(name, value, maxAge) {
  if (
    !Object.values(COOKIE_NAMES).includes(name) ||
    typeof value !== "string" ||
    !/^[A-Za-z0-9._-]*$/.test(value) ||
    !Number.isSafeInteger(maxAge) ||
    maxAge < 0
  ) {
    throw new Error("INVALID_COOKIE");
  }

  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAge}`
  ].join("; ");
}

export function clearCookie(name) {
  return makeCookie(name, "", 0);
}

export function appendCookies(headers, cookies = []) {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  return headers;
}

export function isSameOriginPost(request) {
  if (request.method !== "POST") {
    return false;
  }

  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");

  if (origin !== expectedOrigin) {
    return false;
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");

  return !fetchSite || fetchSite === "same-origin";
}

export async function readSmallForm(
  request,
  maxBytes = 16384
) {
  const contentType = (
    request.headers.get("Content-Type") || ""
  ).split(";")[0].trim().toLowerCase();

  if (contentType !== "application/x-www-form-urlencoded") {
    throw new Error("UNSUPPORTED_FORM_TYPE");
  }

  const contentLength = request.headers.get("Content-Length");

  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Error("INVALID_CONTENT_LENGTH");
    }

    if (Number(contentLength) > maxBytes) {
      throw new Error("FORM_TOO_LARGE");
    }
  }

  if (!request.body) {
    return new URLSearchParams();
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("FORM_TOO_LARGE");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder(
    "utf-8",
    { fatal: true }
  ).decode(bytes);

  return new URLSearchParams(text);
}

export function singleFormValue(form, name) {
  const values = form.getAll(name);

  if (values.length !== 1) {
    throw new Error("INVALID_FORM_FIELD");
  }

  return values[0];
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function privateHeaders(initial = {}) {
  const headers = new Headers(initial);

  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
headers.set("Referrer-Policy", "same-origin");

  return headers;
}

export function htmlResponse(
  html,
  status = 200,
  cookies = []
) {
  const headers = privateHeaders({
    "Content-Type": "text/html; charset=UTF-8",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'none'; img-src https://s3.bmp.ovh; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });

  appendCookies(headers, cookies);

  return new Response(html, {
    status,
    headers
  });
}

export function redirectResponse(
  request,
  pathname = "/",
  cookies = []
) {
  const current = new URL(request.url);
  const target = new URL(pathname, current);

  if (
    target.origin !== current.origin ||
    target.username ||
    target.password
  ) {
    throw new Error("INVALID_REDIRECT");
  }

  const headers = privateHeaders({
    Location: target.href
  });

  appendCookies(headers, cookies);

  return new Response(null, {
    status: 303,
    headers
  });
}

export function unavailableResponse() {
  return new Response(
    "访问验证暂时不可用，请稍后重试。",
    {
      status: 503,
      headers: privateHeaders({
        "Content-Type": "text/plain; charset=UTF-8",
        "Retry-After": "60"
      })
    }
  );
}

export function forbiddenResponse() {
  return new Response(
    "请求未通过安全检查，请返回本站页面重新操作。",
    {
      status: 403,
      headers: privateHeaders({
        "Content-Type": "text/plain; charset=UTF-8"
      })
    }
  );
}
