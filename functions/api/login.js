import { AUTH_COOKIE, sessionToken } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const password = form.get("password") || "";

  if (!env.AGENT_PASSWORD || password !== env.AGENT_PASSWORD) {
    return Response.redirect(new URL("/?err=1", request.url), 303);
  }

  const token = await sessionToken(env.AGENT_PASSWORD);
  const headers = new Headers({ Location: "/" });
  headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
  return new Response(null, { status: 303, headers });
}
