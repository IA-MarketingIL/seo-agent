/**
 * Generates a featured image with Google Gemini and stores it via storeImage.
 * GEMINI_API_KEY lives only here (Cloudflare Pages secret) — never sent to the browser.
 *
 * With no explicit `prompt`, the prompt is built from the article itself so a
 * single click produces an image that matches what the article is about.
 */
import { storeImage } from "../_storage.js";

const buildPrompt = ({ title, metaDescription, industry, businessName }) =>
  [
    `Professional editorial photograph to illustrate a blog article titled "${title}".`,
    metaDescription ? `The article is about: ${metaDescription}` : "",
    industry ? `Industry context: ${industry}${businessName ? ` (${businessName})` : ""}.` : "",
    "Photorealistic, natural lighting, high quality, wide landscape composition.",
    "Absolutely no text, letters, words, logos or watermarks anywhere in the image.",
  ].filter(Boolean).join(" ");

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const { clientId, slug, title } = body;
  if (!slug || (!body.prompt && !title)) return json({ error: "slug and a prompt or title are required" }, 400);
  if (!env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY לא מוגדר ב-Cloudflare" }, 500);

  const prompt = body.prompt?.trim() || buildPrompt(body);

  try {
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
      const msg = genData.error?.message || "unknown";
      // Image models have no free tier — "limit: 0" means billing isn't enabled,
      // not that a quota ran out. Say what to do instead of dumping the raw error.
      if (genRes.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
        const noFreeTier = /limit:\s*0\b/.test(msg);
        return json({
          error: noFreeTier
            ? "יצירת תמונות ב-Gemini דורשת הפעלת חיוב: aistudio.google.com/apikey ← Set up billing על הפרויקט של המפתח."
            : "הגעת למכסת יצירת התמונות ב-Gemini — נסה שוב בעוד כמה דקות.",
        }, 429);
      }
      return json({ error: "Gemini error: " + msg }, 502);
    }

    const parts = genData.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p) => p.inlineData?.data);
    if (!imgPart) return json({ error: "Gemini לא החזיר תמונה — נסה שוב או נסח תיאור אחר" }, 502);

    const contentType = imgPart.inlineData.mimeType || "image/png";
    const url = await storeImage(env, { clientId, slug, bytes: base64ToBytes(imgPart.inlineData.data), contentType });
    return json({ ok: true, url, prompt });
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
