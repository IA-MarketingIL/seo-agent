/**
 * Public review page — the link the user sends a client so they can read an
 * article before it's published and approve it or ask for changes. Exempt
 * from the agent's login gate; the unguessable token is the only key, and it
 * exposes just this one article snapshot.
 */
import { escapeHtml, markdownToHtml } from "../_markdown.js";
import { getReview, validToken } from "../_reviews.js";

export async function onRequestGet({ params, request, env }) {
  const token = String(params.token || "");
  if (!validToken(token)) return page("הקישור אינו תקין", "<p>בדקו שהקישור הועתק במלואו.</p>", 404);

  let review;
  try {
    review = await getReview(env, token);
  } catch {
    return page("שגיאה", "<p>לא הצלחנו לטעון את המאמר. נסו שוב מאוחר יותר.</p>", 502);
  }
  if (!review) return page("המאמר לא נמצא", "<p>ייתכן שהקישור בוטל.</p>", 404);

  const sent = new URL(request.url).searchParams.get("sent") === "1";
  const img = /^https?:\/\//i.test(review.featured_image || "")
    ? `<img class="hero" src="${escapeHtml(review.featured_image)}" alt="">`
    : "";

  const status = {
    approved: `<div class="banner ok">✓ אישרתם את המאמר${review.responded_at ? " · " + fmt(review.responded_at) : ""}. תודה!</div>`,
    changes: `<div class="banner warn">ביקשתם שינויים${review.responded_at ? " · " + fmt(review.responded_at) : ""}. נעדכן ונשלח גרסה חדשה.</div>`,
  }[review.status] || "";

  const form = `
    <form method="POST" action="/api/review" class="box">
      <input type="hidden" name="token" value="${token}">
      <label for="c">הערות (לא חובה)</label>
      <textarea id="c" name="comment" rows="4" placeholder="מה תרצו לשנות או להוסיף?">${escapeHtml(review.comment || "")}</textarea>
      <div class="actions">
        <button name="decision" value="approved" class="approve">✓ מאשר/ת את המאמר</button>
        <button name="decision" value="changes" class="changes">✏ מבקש/ת שינויים</button>
      </div>
    </form>`;

  const body = `
    ${sent ? '<div class="banner ok">התשובה נשלחה. תודה!</div>' : ""}
    ${status}
    <div class="meta">${escapeHtml(review.client_name || "")} · טיוטה לאישור</div>
    <h1>${escapeHtml(review.title)}</h1>
    ${review.meta_description ? `<p class="lead">${escapeHtml(review.meta_description)}</p>` : ""}
    ${img}
    <article>${markdownToHtml(review.content)}</article>
    ${form}`;

  return page(review.title, body, 200);
}

const fmt = (d) => {
  try {
    return new Date(d).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

function page(title, body, status) {
  return new Response(
    `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root{--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc;--card:#fff;--blue:#2563eb;--green:#059669;--amber:#d97706}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.75}
  main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
  .meta{color:var(--muted);font-size:13px;margin-bottom:6px}
  h1{font-size:30px;line-height:1.3;margin:0 0 12px}
  .lead{font-size:18px;color:var(--muted);margin:0 0 20px}
  .hero{width:100%;border-radius:12px;margin:8px 0 24px;display:block}
  article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px 28px;font-size:17px}
  article h2{font-size:22px;margin:28px 0 8px}
  article h3{font-size:18px;margin:20px 0 6px}
  article p{margin:0 0 12px}
  .box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:24px}
  label{display:block;font-weight:700;font-size:14px;margin-bottom:8px}
  textarea{width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:8px;font:inherit;font-size:15px;resize:vertical}
  .actions{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
  button{flex:1;min-width:180px;border:none;border-radius:9px;padding:13px 16px;font:inherit;font-size:15px;font-weight:700;color:#fff;cursor:pointer}
  .approve{background:var(--green)} .changes{background:var(--amber)}
  .banner{border-radius:10px;padding:12px 16px;margin-bottom:18px;font-weight:600}
  .banner.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
  .banner.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
  @media (max-width:520px){h1{font-size:24px}article{padding:18px}}
</style>
</head>
<body><main>${body}</main></body>
</html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } }
  );
}
