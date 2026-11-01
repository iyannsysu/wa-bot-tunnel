// Client lokal long-poll: tahan koneksi s/d ~20 detik sampai ada request antri.
// Menghemat request Pages: dari 1 poll/2.5 dtk (~35rb/hari) menjadi ~1 poll/20 dtk
// (~4.3rb/hari) saat idle. Client langsung poll ulang begitu dapat item.
//
// Filter rute (opsional, dari body poll): "only" / "exclude" = array prefix
// path (mis. ["/waifu"]). Untuk berbagi satu antrean antar DUA klien tunnel:
// tiap klien hanya mengklaim rute yang bisa ia layani lokal, rute lain tetap
// pending untuk klien satunya. Tanpa filter = perilaku lama (klaim apa saja).
export async function onRequestPost({ request, env }) {
  const { key, limit, only, exclude } = await request.json().catch(() => ({}));
  if (key !== env.TUNNEL_KEY) return new Response("forbidden", { status: 403 });

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tunnel_requests WHERE created_at < ?").bind(now - 120000),
    env.DB.prepare("DELETE FROM tunnel_responses WHERE created_at < ?").bind(now - 120000),
  ]);

  const n = Math.min(Math.max(parseInt(limit) || 4, 1), 8);

  const onlyP = Array.isArray(only) ? only.filter((x) => typeof x === "string" && x.startsWith("/")) : [];
  const exclP = Array.isArray(exclude) ? exclude.filter((x) => typeof x === "string" && x.startsWith("/")) : [];
  let cond = "";
  const binds = [];
  // Path tersimpan = pathname + query ("/waifu?k=..."), jadi tiap prefix
  // dicocokkan 3 bentuk: persis, diikuti "/", atau diikuti "?".
  const grup = (arr) => "(" + arr.map(() => "(path = ? OR path LIKE ? OR path LIKE ?)").join(" OR ") + ")";
  if (onlyP.length) {
    cond += " AND " + grup(onlyP);
    for (const p of onlyP) binds.push(p, p + "/%", p + "?%");
  }
  if (exclP.length) {
    cond += " AND NOT " + grup(exclP);
    for (const p of exclP) binds.push(p, p + "/%", p + "?%");
  }

  const deadline = Date.now() + 20000; // hold ~20 dtk (di bawah batas wajar eksekusi Function)
  for (;;) {
    const rows = await env.DB.prepare(
      `SELECT id, method, path, headers, body FROM tunnel_requests WHERE status='pending'${cond} ORDER BY created_at ASC LIMIT ?`
    ).bind(...binds, n).all();

    if (rows.results.length > 0) {
      const ids = rows.results.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      await env.DB.prepare(
        `UPDATE tunnel_requests SET status='claimed' WHERE id IN (${placeholders}) AND status='pending'`
      ).bind(...ids).run();
      return Response.json({ requests: rows.results });
    }
    if (Date.now() >= deadline) return Response.json({ requests: [] });
    await new Promise((r) => setTimeout(r, 250));
  }
}
