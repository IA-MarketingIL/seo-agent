/**
 * Cloudflare Pages Function — server-side proxy to the Anthropic API.
 * ANTHROPIC_API_KEY lives only here (Pages → Settings → Environment variables,
 * as a Secret, WITHOUT the VITE_ prefix) — it never reaches the browser.
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const { prompt, maxTokens } = body;
  if (!prompt) return json({ error: "prompt is required" }, 400);

  // Article generation uses <<<META>>>/<<<ARTICLE>>> markers — allow that format.
  // Briefs/scans still expect pure JSON.
  const wantsMarkers = /<<<META>>>|<<<ARTICLE>>>/i.test(prompt || "");
  const system = wantsMarkers
    ? "Follow the user's output format exactly. For META: output ONLY valid compact JSON between the markers. For ARTICLE: plain Hebrew markdown text, not JSON. Never wrap the whole response in markdown code fences."
    : "You are a JSON API. ONLY output raw valid JSON. No markdown, no backticks, no explanations. NEVER use double-quote characters inside JSON string values — use single quotes or rephrase.";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: Math.min(Math.max(maxTokens || 2000, 256), 16000),
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return json({ error: data.error?.message || "Anthropic API error" }, res.status);
  }

  const text = (data.content || []).map((c) => c.text || "").join("");
  return json({ text });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
