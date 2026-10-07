/**
 * Receives a client's approve / request-changes answer from the review page
 * (a plain HTML form post, so it works without JavaScript) and redirects back.
 */
import { respondToReview, validToken } from "../_reviews.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("token") || "");
  const decision = String(form?.get("decision") || "");
  const comment = String(form?.get("comment") || "").trim().slice(0, 4000);

  if (!validToken(token) || !["approved", "changes"].includes(decision)) {
    return new Response("Bad request", { status: 400 });
  }

  try {
    await respondToReview(env, token, decision, comment);
  } catch (e) {
    return new Response("שגיאה בשמירת התשובה — נסו שוב", { status: 502 });
  }
  return Response.redirect(new URL(`/review/${token}?sent=1`, request.url), 303);
}
