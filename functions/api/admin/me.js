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
    const latestLogin = await env.DB.prepare(
      "SELECT details FROM activity_log WHERE user_id = ? AND action = 'login' ORDER BY id DESC LIMIT 1"
    ).bind(user.id).first();
    const authMethod = String(latestLogin?.details || '').toLowerCase().includes('emergency credential')
      ? 'Developer password'
      : 'Personal password';
    return new Response(JSON.stringify({
      user: {
        username: user.username,
        role: user.role
      },
      auth_method: authMethod
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
