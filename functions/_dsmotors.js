/**
 * Shared DS Motors helpers — used by both the browser-invoked
 * /api/publish-dsmotors endpoint and the daily /api/publish-scheduled cron.
 * DS Motors' site has its own blog UI reading directly from Supabase; there's
 * no Cloudflare Worker for this client. The DB is RLS-protected, so every
 * write signs in as the site admin first (credentials held server-side only,
 * never sent to the browser).
 */
import { markdownToHtml } from "./_markdown.js";

const SUPABASE_URL = "https://ymxodnhfurjvrytdiuww.supabase.co"; // project ref is public info

export async function dsMotorsLogin(env) {
  if (!env.DSMOTORS_ADMIN_EMAIL || !env.DSMOTORS_ADMIN_PASSWORD || !env.DSMOTORS_SUPABASE_ANON_KEY) {
    throw new Error("DS Motors publish credentials are not configured");
  }
  const loginRes = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.DSMOTORS_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: env.DSMOTORS_ADMIN_EMAIL, password: env.DSMOTORS_ADMIN_PASSWORD }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || !loginData.access_token) {
    throw new Error("DS Motors admin login failed: " + (loginData.error_description || loginData.msg || "unknown"));
  }
  return loginData.access_token;
}

export async function dsMotorsPublish(env, { title, metaDescription, article, keywords, slug, readTime, category, featuredImage }) {
  if (!title || !article || !slug) throw new Error("title, article and slug are required");
  const accessToken = await dsMotorsLogin(env);

  const row = {
    slug,
    title,
    excerpt: (metaDescription || "").slice(0, 300),
    full_content: markdownToHtml(article),
    category: category || "כללי",
    read_time: readTime || "5 דקות קריאה",
    keywords: keywords || [],
    is_published: true,
    ...(featuredImage ? { featured_image: featuredImage } : {}),
  };

  const insertRes = await fetch(SUPABASE_URL + "/rest/v1/blog_articles?on_conflict=slug", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.DSMOTORS_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + accessToken,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  const insertData = await insertRes.json();
  if (!insertRes.ok) {
    throw new Error("Insert failed: " + (insertData.message || JSON.stringify(insertData)));
  }
  return Array.isArray(insertData) ? insertData[0] : insertData;
}
