/**
 * Routes an image blob to the right storage for a given client:
 * DS Motors → its own Supabase Storage; everyone else → their own
 * Cloudflare Worker's KV (via a new /seo-api/image endpoint on the
 * per-client Worker template).
 */
import { dsMotorsUploadImage } from "./_dsmotors.js";

const isDsMotors = (domain) => (domain || "").includes("dsmotors.co.il");

export async function storeImage(env, { domain, workerUrl, token, bytes, contentType, filename }) {
  if (isDsMotors(domain)) {
    return dsMotorsUploadImage(env, { bytes, contentType, filename });
  }

  if (!workerUrl || !token) {
    throw new Error("חסר Worker URL או Auth Token אצל הלקוח");
  }
  const base = workerUrl.replace(/\/$/, "");
  const slug = filename.replace(/\.[^.]+$/, "");
  const res = await fetch(base + "/seo-api/image/" + encodeURIComponent(slug), {
    method: "POST",
    headers: { "Content-Type": contentType || "application/octet-stream", Authorization: "Bearer " + token },
    body: bytes,
  });
  if (!res.ok) throw new Error("Image upload to Worker failed: HTTP " + res.status);
  return base + "/seo-api/image/" + encodeURIComponent(slug);
}
