/**
 * Generates a featured image and stores it via storeImage. Provider is picked
 * by which key is configured: OPENAI_API_KEY (ChatGPT's image model) wins,
 * otherwise GEMINI_API_KEY. Keys live only here as Cloudflare Pages secrets.
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

// Each provider resolves to { bytes, contentType } or throws an Error whose
// message is already user-facing Hebrew (with `status` for the HTTP code).
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

async function generateWithOpenAI(env, prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: env.OPENAI_IMAGE_QUALITY || "medium",
      output_format: "jpeg",
      output_compression: 85,
      n: 1,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || "unknown";
    if (res.status === 403 && /verif/i.test(msg)) {
      throw fail("OpenAI דורשים אימות ארגון לפני יצירת תמונות: platform.openai.com/settings/organization/general ← Verify Organization.", 403);
    }
    if (res.status === 429 || /quota|billing|insufficient/i.test(msg)) {
      throw fail("אין יתרה בחשבון OpenAI — יש להוסיף קרדיט ב-platform.openai.com/settings/organization/billing.", 429);
    }
    if (res.status === 400 && /safety|policy|moderation/i.test(msg)) {
      throw fail("OpenAI סירבו ליצור את התמונה בגלל מדיניות התוכן — נסה תיאור אחר.", 400);
    }
    throw fail("OpenAI error: " + msg);
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw fail("OpenAI לא החזירו תמונה — נסה שוב");
  return { bytes: base64ToBytes(b64), contentType: "image/jpeg" };
}

async function generateWithGemini(env, prompt) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || "unknown";
    // Image models have no free tier — "limit: 0" means billing isn't enabled,
    // not that a quota ran out.
    if (res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
      throw fail(
        /limit:\s*0\b/.test(msg)
          ? "יצירת תמונות ב-Gemini דורשת הפעלת חיוב: aistudio.google.com/apikey ← Set up billing על הפרויקט של המפתח."
          : "הגעת למכסת יצירת התמונות ב-Gemini — נסה שוב בעוד כמה דקות.",
        429
      );
    }
    throw fail("Gemini error: " + msg);
  }
  const imgPart = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!imgPart) throw fail("Gemini לא החזיר תמונה — נסה שוב או נסח תיאור אחר");
  return { bytes: base64ToBytes(imgPart.inlineData.data), contentType: imgPart.inlineData.mimeType || "image/png" };
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const { clientId, slug, title } = body;
  if (!slug || (!body.prompt && !title)) return json({ error: "slug and a prompt or title are required" }, 400);

  const generate = env.OPENAI_API_KEY ? generateWithOpenAI : env.GEMINI_API_KEY ? generateWithGemini : null;
  if (!generate) return json({ error: "לא הוגדר מפתח ליצירת תמונות — הוסף OPENAI_API_KEY ב-Cloudflare" }, 500);

  const prompt = body.prompt?.trim() || buildPrompt(body);

  try {
    const { bytes, contentType } = await generate(env, prompt);
    const url = await storeImage(env, { clientId, slug, bytes, contentType });
    return json({ ok: true, url, prompt });
  } catch (e) {
    return json({ error: e.message }, e.status || 502);
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
