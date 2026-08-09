/**
 * Crawls a site TWICE and measures the difference:
 *   1. raw HTML straight from the server (what a crawler that doesn't run JS sees)
 *   2. fully rendered content via Jina Reader (what a browser / Googlebot sees)
 *
 * The gap between them is the single most useful SEO signal for a React SPA —
 * if the raw HTML is an empty shell, non-JS crawlers get nothing. Everything
 * here is measured, not guessed, so the audit can state facts instead of
 * letting the model invent findings. Runs server-side so it isn't limited by
 * browser CORS or a short in-page timeout.
 */
const RENDER_TIMEOUT_MS = 25000;
const RAW_TIMEOUT_MS = 12000;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const input = (body.url || "").trim();
  if (!input) return json({ error: "url is required" }, 400);
  const url = input.startsWith("http") ? input : "https://" + input;

  const [raw, rendered] = await Promise.all([fetchRaw(url), fetchRendered(url, env)]);

  // Both paths failed — say so loudly rather than letting the caller audit nothing.
  if (!raw.ok && !rendered.ok) {
    return json({ error: "לא הצלחנו לסרוק את האתר: " + (rendered.error || raw.error || "unknown") }, 502);
  }

  const rawTextChars = raw.bodyTextChars || 0;
  const renderedChars = rendered.chars || 0;
  const clientSideRendered =
    rendered.ok && (rawTextChars < 600 || (renderedChars > 0 && renderedChars > rawTextChars * 3));

  return json({
    ok: true,
    url,
    raw,
    rendered,
    spa: {
      clientSideRendered,
      rawTextChars,
      renderedTextChars: renderedChars,
      visibleWithoutJsPct:
        renderedChars > 0 ? Math.min(100, Math.round((rawTextChars / renderedChars) * 100)) : null,
    },
  });
}

async function fetchRaw(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOAgentBot/1.0)" },
    });
    const html = await res.text();
    return { ok: res.ok, status: res.status, htmlBytes: html.length, ...analyzeHtml(html) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchRendered(url, env) {
  try {
    const headers = { Accept: "text/plain" };
    // Optional — a Jina key raises rate limits, but the endpoint works without one.
    if (env.JINA_API_KEY) headers.Authorization = "Bearer " + env.JINA_API_KEY;
    const res = await fetch("https://r.jina.ai/" + url, {
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
      headers,
    });
    if (!res.ok) return { ok: false, error: "Jina HTTP " + res.status };
    const content = await res.text();
    return { ok: true, chars: content.length, content: content.slice(0, 8000), source: "jina" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function analyzeHtml(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const jsonLdBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const jsonLdTypes = [];
  for (const block of jsonLdBlocks) {
    const types = block.match(/"@type"\s*:\s*"([^"]+)"/g) || [];
    for (const t of types) {
      const name = t.split('"')[3];
      if (name && !jsonLdTypes.includes(name)) jsonLdTypes.push(name);
    }
  }

  const h1s = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || [];
  const firstH1 = h1s.length
    ? h1s[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    : null;

  return {
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i),
    metaDescription: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    metaRobots: pick(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i),
    canonical: pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i),
    ogDescription: pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i),
    ogImage: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i),
    lang: pick(/<html[^>]+lang=["']([^"']*)["']/i),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    h1Count: h1s.length,
    h1First: firstH1,
    h2Count: (html.match(/<h2\b/gi) || []).length,
    imgCount: (html.match(/<img\b/gi) || []).length,
    imgMissingAlt: (html.match(/<img\b(?![^>]*\balt=)[^>]*>/gi) || []).length,
    jsonLdCount: jsonLdBlocks.length,
    jsonLdTypes,
    bodyTextChars: bodyText.length,
    bodyTextSample: bodyText.slice(0, 300),
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
