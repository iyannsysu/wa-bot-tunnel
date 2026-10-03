// Client lokal long-poll: tahan koneksi s/d ~20 detik sampai ada request antri.
// Menghemat request Pages: dari 1 poll/2.5 dtk (~35rb/hari) menjadi ~1 poll/20 dtk
// (~4.3rb/hari) saat idle. Client langsung poll ulang begitu dapat item.
export async function onRequestPost({ request, env }) {
  const { key, limit } = await request.json().catch(() => ({}));
  if (key !== env.TUNNEL_KEY) return new Response("forbidden", { status: 403 });

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tunnel_requests WHERE created_at < ?").bind(now - 120000),
    env.DB.prepare("DELETE FROM tunnel_responses WHERE created_at < ?").bind(now - 120000),
  ]);

  const n = Math.min(Math.max(parseInt(limit) || 4, 1), 8);
  const deadline = Date.now() + 20000; // hold ~20 dtk (di bawah batas wajar eksekusi Function)
  for (;;) {
    const rows = await env.DB.prepare(
      "SELECT id, method, path, headers, body FROM tunnel_requests WHERE status='pending' ORDER BY created_at ASC LIMIT ?"
    ).bind(n).all();

    if (rows.results.length > 0) {
      const ids = rows.results.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      await env.DB.prepare(
        `UPDATE tunnel_requests SET status='claimed' WHERE id IN (${placeholders}) AND status='pending'`
      ).bind(...ids).run();
      return Response.json({ requests: rows.results });
    }
    if (Date.now() >= deadline) return Response.json({ requests: [] });
    await new Promise((r) => setTimeout(r, 1000));
  }
}
