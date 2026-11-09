import { getAdminSession } from "../../_shared/admin-session.js";

export async function onRequestGet({ request, env }) {
  try {
    const user = await getAdminSession(request, env);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    return new Response(JSON.stringify({
      user: {
        username: user.username,
        role: user.role
      }
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  } catch {
    return new Response(JSON.stringify({ error: "Could not load signed-in account" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
}
