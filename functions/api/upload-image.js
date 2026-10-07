/**
 * Accepts a raw image upload from the browser and stores it via storeImage.
 */
import { storeImage } from "../_storage.js";

const MAX_BYTES = 8 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") || "";
  const clientId = url.searchParams.get("clientId") || "";
  if (!slug) return json({ error: "slug is required" }, 400);

  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!contentType.startsWith("image/")) return json({ error: "רק קבצי תמונה" }, 400);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: "empty upload" }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: "התמונה גדולה מ-8MB" }, 413);

  try {
    const publicUrl = await storeImage(env, { clientId, slug, bytes, contentType });
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
