/**
 * Accepts a raw image upload from the browser and stores it via storeImage.
 * Client metadata travels in headers (not query string) to avoid the Worker
 * Auth Token ending up in access logs.
 */
import { storeImage } from "../_storage.js";

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") || "";
  if (!slug) return json({ error: "slug is required" }, 400);

  const domain = request.headers.get("X-Client-Domain") || "";
  const workerUrl = request.headers.get("X-Worker-Url") || "";
  const token = request.headers.get("X-Worker-Token") || "";
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: "empty upload" }, 400);

  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";

  try {
    const publicUrl = await storeImage(env, { domain, workerUrl, token, bytes, contentType, filename: slug + "." + ext });
    return json({ ok: true, url: publicUrl });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
