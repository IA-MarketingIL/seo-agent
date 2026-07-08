// Guards every request (static assets + API routes) behind a single shared
// password. Set AGENT_PASSWORD as a Secret in Cloudflare Pages → Settings →
// Environment variables. Without it configured, the gate is skipped (so you
// aren't locked out before setting it up).
import { AUTH_COOKIE, getCookie, sessionToken } from "./_shared.js";

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);

  if (url.pathname === "/api/login") return next();
  if (!env.AGENT_PASSWORD) return next();

  const expected = await sessionToken(env.AGENT_PASSWORD);
  const cookie = getCookie(request, AUTH_COOKIE);
  if (cookie === expected) return next();

  const failed = url.searchParams.get("err") === "1";
  return new Response(loginPage(failed), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function loginPage(failed) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>התחברות — סוכן SEO</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;background:#0a0f1e;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  form{background:#111827;padding:36px 32px;border-radius:14px;width:280px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 20px}
  input{width:100%;padding:11px 13px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:14px;box-sizing:border-box;margin-bottom:14px}
  button{width:100%;padding:11px 0;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;font-size:14px}
  .err{color:#f87171;font-size:13px;margin-bottom:12px}
</style></head>
<body>
  <form method="POST" action="/api/login">
    <h1>✦ סוכן SEO</h1>
    ${failed ? '<div class="err">סיסמה שגויה</div>' : ""}
    <input type="password" name="password" placeholder="סיסמה" autofocus required />
    <button type="submit">כניסה</button>
  </form>
</body>
</html>`;
}
