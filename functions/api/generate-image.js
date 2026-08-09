/**
 * Generates a featured image with Google Gemini and stores it via storeImage.
 * GEMINI_API_KEY lives only here (Cloudflare Pages secret) — never sent to the browser.
 */
import { storeImage } from "../_storage.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const { prompt, domain, workerUrl, token, slug } = body;
  if (!prompt || !slug) return json({ error: "prompt and slug are required" }, 400);
  if (!env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY is not configured" }, 500);

  const genRes = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const genData = await genRes.json();
  if (!genRes.ok) {
    return json({ error: "Gemini error: " + (genData.error?.message || "unknown") }, 502);
  }

  const parts = genData.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart) return json({ error: "Gemini did not return an image" }, 502);

  const contentType = imgPart.inlineData.mimeType || "image/png";
  const bytes = base64ToBytes(imgPart.inlineData.data);
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

  try {
    const url = await storeImage(env, { domain, workerUrl, token, bytes, contentType, filename: slug + "." + ext });
    return json({ ok: true, url });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
