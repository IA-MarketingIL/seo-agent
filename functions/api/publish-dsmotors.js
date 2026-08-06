/**
 * Publishes an article to DS Motors' own Supabase `blog_articles` table.
 * DS Motors' site already has its own blog UI reading directly from Supabase —
 * no Cloudflare Worker is involved for this client. The table is RLS-protected
 * (writes require an authenticated admin), so this Function signs in as the
 * site admin (credentials held server-side only, never sent to the browser)
 * and then upserts the article by slug.
 */
const SUPABASE_URL = "https://ymxodnhfurjvrytdiuww.supabase.co"; // project ref is public info

function markdownToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (md || "")
    .split("\n")
    .map((line) => {
      if (line.startsWith("### ")) return `<h3>${esc(line.slice(4))}</h3>`;
      if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
      if (line.trim() === "") return "";
      return `<p>${esc(line)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const { title, metaDescription, article, keywords, slug, readTime, category } = body;
  if (!title || !article || !slug) return json({ error: "title, article and slug are required" }, 400);
  if (!env.DSMOTORS_ADMIN_EMAIL || !env.DSMOTORS_ADMIN_PASSWORD || !env.DSMOTORS_SUPABASE_ANON_KEY) {
    return json({ error: "DS Motors publish credentials are not configured" }, 500);
  }

  // 1. Sign in as the site admin — this is what satisfies the is_admin() RLS check.
  const loginRes = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.DSMOTORS_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: env.DSMOTORS_ADMIN_EMAIL, password: env.DSMOTORS_ADMIN_PASSWORD }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.access_token) {
    return json({ error: "DS Motors admin login failed: " + (loginData.error_description || loginData.msg || "unknown") }, 502);
  }

  // 2. Upsert by slug — republishing an existing article updates it instead of duplicating.
  const row = {
    slug,
    title,
    excerpt: (metaDescription || "").slice(0, 300),
    full_content: markdownToHtml(article),
    category: category || "כללי",
    read_time: readTime || "5 דקות קריאה",
    keywords: keywords || [],
    is_published: true,
  };

  const insertRes = await fetch(SUPABASE_URL + "/rest/v1/blog_articles?on_conflict=slug", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.DSMOTORS_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + loginData.access_token,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  const insertData = await insertRes.json();
  if (!insertRes.ok) {
    return json({ error: "Insert failed: " + (insertData.message || JSON.stringify(insertData)) }, 502);
  }

  return json({ ok: true, article: Array.isArray(insertData) ? insertData[0] : insertData });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
