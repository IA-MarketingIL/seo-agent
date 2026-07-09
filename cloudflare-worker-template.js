/**
 * SEO Agent — Cloudflare Worker Template
 *
 * Deploy this Worker on each client's Cloudflare account.
 *
 * Setup:
 *   1. Create a KV namespace named "SEO_ARTICLES" and bind it to this Worker
 *   2. Add an Environment Variable: AUTH_TOKEN=<your_secret_token>
 *   3. Add a route: client-domain.com/seo-api/*  → this Worker
 *
 * Endpoints:
 *   GET  /seo-api/articles         — list all published articles (public)
 *   GET  /seo-api/articles/:slug   — get single article (public)
 *   POST /seo-api/articles         — publish article (requires Authorization header)
 *   DELETE /seo-api/articles/:slug — delete article (requires Authorization header)
 *   GET  /seo-api/info             — site metadata for SEO agent scanning (public)
 *   GET  /seo-api/ping             — auth check for SEO agent connection test
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return auth === "Bearer " + (env.AUTH_TOKEN || "");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── GET /seo-api/info ──────────────────────────────────────────
    if (request.method === "GET" && path === "/seo-api/info") {
      const articles = await listArticles(env);
      return json({
        workerVersion: "1.1",
        domain: url.hostname,
        articleCount: articles.length,
        latestArticles: articles.slice(0, 5).map(a => ({ slug: a.slug, title: a.title, publishedAt: a.publishedAt })),
      });
    }

    // ── GET /seo-api/ping ──────────────────────────────────────────
    if (request.method === "GET" && path === "/seo-api/ping") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json({
        ok: true,
        workerVersion: "1.1",
        domain: url.hostname,
      });
    }

    // ── GET /seo-api/articles ──────────────────────────────────────
    if (request.method === "GET" && path === "/seo-api/articles") {
      const articles = await listArticles(env);
      return json({ articles });
    }

    // ── GET /seo-api/articles/:slug ────────────────────────────────
    const slugMatch = path.match(/^\/seo-api\/articles\/(.+)$/);
    if (request.method === "GET" && slugMatch) {
      const slug = slugMatch[1];
      const raw = await env.SEO_ARTICLES.get("article:" + slug);
      if (!raw) return json({ error: "not found" }, 404);
      return json(JSON.parse(raw));
    }

    // ── POST /seo-api/articles ─────────────────────────────────────
    if (request.method === "POST" && path === "/seo-api/articles") {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: "invalid JSON" }, 400); }

      const { slug, title, metaTitle, metaDescription, content, keywords, publishedAt } = body;
      if (!slug || !title || !content) return json({ error: "slug, title and content are required" }, 400);

      const article = { slug, title, metaTitle, metaDescription, content, keywords: keywords || [], publishedAt: publishedAt || new Date().toISOString() };

      await env.SEO_ARTICLES.put("article:" + slug, JSON.stringify(article));

      // Update index
      const index = JSON.parse(await env.SEO_ARTICLES.get("index") || "[]");
      const existing = index.findIndex(a => a.slug === slug);
      const summary = { slug, title, metaTitle, metaDescription, publishedAt: article.publishedAt };
      if (existing >= 0) index[existing] = summary;
      else index.unshift(summary);
      await env.SEO_ARTICLES.put("index", JSON.stringify(index));

      return json({ ok: true, slug });
    }

    // ── DELETE /seo-api/articles/:slug ─────────────────────────────
    if (request.method === "DELETE" && slugMatch) {
      if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      const slug = slugMatch[1];
      await env.SEO_ARTICLES.delete("article:" + slug);
      const index = JSON.parse(await env.SEO_ARTICLES.get("index") || "[]");
      await env.SEO_ARTICLES.put("index", JSON.stringify(index.filter(a => a.slug !== slug)));
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  },
};

async function listArticles(env) {
  return JSON.parse(await env.SEO_ARTICLES.get("index") || "[]");
}
