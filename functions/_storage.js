/**
 * Stores article images in the agent's own Supabase Storage (public bucket
 * `article-images`), for every client. The resulting public URL is just a
 * string, so it works as DS Motors' `featured_image` and as a Worker client's
 * `featuredImage` alike — no per-client storage setup, and nothing needed in
 * client accounts we don't control (DS Motors' Supabase is Lovable-managed).
 */
const BUCKET = "article-images";

export async function storeImage(env, { clientId, slug, bytes, contentType }) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured");
  }
  const base = env.VITE_SUPABASE_URL.trim().replace(/\/$/, "");
  const ext = contentType.includes("png") ? "png"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : "jpg";
  // A fresh name per upload — replacing an image must not hit a CDN-cached copy.
  const safe = (s) => String(s || "x").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
  const path = `${safe(clientId)}/${safe(slug)}-${Date.now()}.${ext}`;

  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + env.VITE_SUPABASE_ANON_KEY,
    },
    body: bytes,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("Image upload failed: HTTP " + res.status + " " + detail.slice(0, 200));
  }
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}
