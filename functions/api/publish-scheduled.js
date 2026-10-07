/**
 * Called once a day by a GitHub Actions cron job (see
 * .github/workflows/publish-scheduled.yml). Publishes every article whose
 * scheduledDate has arrived, for every client, without a human clicking
 * anything. Auth is a shared secret header (not the browser login cookie —
 * GitHub Actions can't hold a session cookie), checked here directly.
 */
import { dsMotorsPublish } from "../_dsmotors.js";

const isDsMotors = (domain) => (domain || "").includes("dsmotors.co.il");

export async function onRequestPost({ request, env }) {
  try {
    return await run(request, env);
  } catch (e) {
    // Without this the Worker throws and Cloudflare returns an opaque 1101,
    // which says nothing about what actually broke.
    return json({ error: e.message || String(e) }, 500);
  }
}

async function run(request, env) {
  if (!env.CRON_SECRET || request.headers.get("X-Cron-Secret") !== env.CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return json({ error: "Supabase is not configured" }, 500);
  }
  if (!/^https?:\/\//i.test(env.VITE_SUPABASE_URL.trim())) {
    return json({ error: "VITE_SUPABASE_URL is not a URL: " + env.VITE_SUPABASE_URL.slice(0, 20) + "..." }, 500);
  }

  const rows = await fetchClients(env);
  const now = new Date();
  const published = [];
  const failed = [];

  for (const row of rows) {
    const client = row.data;
    if (!client?.articles?.length) continue;

    let changed = false;
    for (const article of client.articles) {
      if (article.status !== "scheduled") continue;
      if (!article.scheduledDate || new Date(article.scheduledDate) > now) continue;
      const draft = article.draftContent;
      if (!draft) {
        failed.push({ id: article.id, error: "no draftContent to publish" });
        continue;
      }

      try {
        await publishOne(env, client, draft);
        const nowIso = now.toISOString();
        const prevVersions = article.versions || [];
        const nextVersions = article.publishedContent
          ? [...prevVersions, { ...article.publishedContent, publishedAt: article.publishedAt, version: prevVersions.length + 1 }]
          : prevVersions;
        article.status = "published";
        article.publishedAt = nowIso;
        article.slug = draft.slug;
        article.publishedContent = {
          title: draft.title, metaTitle: draft.metaTitle, metaDescription: draft.metaDescription,
          content: draft.article, keywords: draft.keywords, slug: draft.slug, featuredImage: draft.featuredImage || null,
        };
        article.versions = nextVersions;
        changed = true;
        published.push(article.id);
      } catch (e) {
        failed.push({ id: article.id, error: e.message });
      }
    }

    if (changed) await saveClient(env, row.id, client);
  }

  return json({ ok: true, published, failed });
}

async function publishOne(env, client, draft) {
  if (isDsMotors(client.domain)) {
    await dsMotorsPublish(env, {
      title: draft.title, metaDescription: draft.metaDescription, article: draft.article,
      keywords: draft.keywords, slug: draft.slug, readTime: draft.readTime, featuredImage: draft.featuredImage,
    });
    return;
  }

  const workerUrl = (client.workerUrl || "").replace(/\/$/, "");
  const token = client.token || "";
  if (!workerUrl || !token) throw new Error("client has no Worker URL / Auth Token configured");

  const res = await fetch(workerUrl + "/seo-api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      title: draft.title, metaTitle: draft.metaTitle, metaDescription: draft.metaDescription,
      content: draft.article, keywords: draft.keywords, slug: draft.slug,
      publishedAt: new Date().toISOString(), featuredImage: draft.featuredImage || null,
    }),
  });
  if (!res.ok) throw new Error("Worker publish failed: HTTP " + res.status);
}

const supabaseBase = (env) => env.VITE_SUPABASE_URL.trim().replace(/\/$/, "");

async function fetchClients(env) {
  const res = await fetch(supabaseBase(env) + "/rest/v1/seo_clients?select=id,data", {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: "Bearer " + env.VITE_SUPABASE_ANON_KEY },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Failed to read seo_clients: HTTP " + res.status + " " + detail.slice(0, 200));
  }
  return res.json();
}

async function saveClient(env, id, data) {
  const res = await fetch(supabaseBase(env) + "/rest/v1/seo_clients?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + env.VITE_SUPABASE_ANON_KEY,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Failed to save client " + id + ": HTTP " + res.status + " " + detail.slice(0, 200));
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
