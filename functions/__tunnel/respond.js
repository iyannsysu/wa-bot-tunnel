// Client lokal kirim response untuk sebuah request
export async function onRequestPost({ request, env }) {
  const { key, id, status_code, headers, body } = await request.json().catch(() => ({}));
  if (key !== env.TUNNEL_KEY || !id) return new Response("forbidden", { status: 403 });

  await env.DB.prepare(
    "INSERT OR REPLACE INTO tunnel_responses (id, status_code, headers, body, created_at) VALUES (?,?,?,?,?)"
  ).bind(id, status_code | 0, JSON.stringify(headers || {}), body || null, Date.now()).run();

  return Response.json({ ok: true });
}
