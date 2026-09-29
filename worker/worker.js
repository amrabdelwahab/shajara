const LAYERS = ['substrate', 'ground', 'bark', 'bloom'];
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => Date.now();

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Band-Key,X-Member',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status: status || 200, headers: { ...headers, 'Content-Type': 'application/json' } });

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 500) : '');

async function loadTrack(env, id) {
  const track = await env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(id).first();
  if (!track) return null;
  const [holders, ideas] = await Promise.all([
    env.DB.prepare('SELECT layer, member_id, instrument FROM holders WHERE track_id = ?').bind(id).all(),
    env.DB.prepare('SELECT * FROM ideas WHERE track_id = ? ORDER BY created_at DESC').bind(id).all(),
  ]);
  return { ...track, holders: holders.results, ideas: ideas.results };
}

async function touch(env, trackId) {
  await env.DB.prepare('UPDATE tracks SET updated_at = ? WHERE id = ?').bind(now(), trackId).run();
}

async function route(req, env, url, member) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const m = req.method;
  const [a, id, sub, subId] = parts;

  if (a === 'state' && m === 'GET') {
    const [members, tracks, holders, counts] = await Promise.all([
      env.DB.prepare('SELECT * FROM members ORDER BY created_at').all(),
      env.DB.prepare('SELECT id, title, maqam, tonic, tempo, meter, updated_at, created_at FROM tracks ORDER BY updated_at DESC').all(),
      env.DB.prepare('SELECT track_id, layer, member_id, instrument FROM holders').all(),
      env.DB.prepare('SELECT track_id, layer, COUNT(*) AS n FROM ideas GROUP BY track_id, layer').all(),
    ]);
    const byTrack = {};
    for (const t of tracks.results) byTrack[t.id] = { ...t, holders: [], counts: {} };
    for (const h of holders.results) byTrack[h.track_id]?.holders.push(h);
    for (const c of counts.results) if (byTrack[c.track_id]) byTrack[c.track_id].counts[c.layer] = c.n;
    return json({ members: members.results, tracks: tracks.results.map(t => byTrack[t.id]) });
  }

  if (a === 'members') {
    if (m === 'POST' && !id) {
      const b = await body(req);
      const name = str(b.name, 60);
      if (!name) return json({ error: 'name required' }, 400);
      const row = { id: uid(), name, instruments: str(b.instruments, 200), created_at: now() };
      await env.DB.prepare('INSERT INTO members (id, name, instruments, created_at) VALUES (?, ?, ?, ?)')
        .bind(row.id, row.name, row.instruments, row.created_at).run();
      return json(row, 201);
    }
    if (m === 'PATCH' && id) {
      const b = await body(req);
      await env.DB.prepare('UPDATE members SET name = COALESCE(NULLIF(?, \'\'), name), instruments = ? WHERE id = ?')
        .bind(str(b.name, 60), str(b.instruments, 200), id).run();
      return json(await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first());
    }
    if (m === 'DELETE' && id) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM holders WHERE member_id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }

  if (a === 'tracks') {
    if (m === 'POST' && !id) {
      const b = await body(req);
      const title = str(b.title, 120);
      if (!title) return json({ error: 'title required' }, 400);
      const t = now();
      const tid = uid();
      await env.DB.prepare(
        'INSERT INTO tracks (id, title, maqam, tonic, tempo, meter, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(tid, title, str(b.maqam, 60), str(b.tonic, 20), Number(b.tempo) || null, str(b.meter, 60), str(b.notes, 4000), member, t, t).run();
      return json(await loadTrack(env, tid), 201);
    }
    if (!id) return null;
    if (m === 'GET' && !sub) {
      const track = await loadTrack(env, id);
      return track ? json(track) : json({ error: 'not found' }, 404);
    }
    if (m === 'PATCH' && !sub) {
      const b = await body(req);
      const cur = await env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(id).first();
      if (!cur) return json({ error: 'not found' }, 404);
      const pick = (k, max) => (k in b ? str(b[k], max) : cur[k]);
      const tempo = 'tempo' in b ? Number(b.tempo) || null : cur.tempo;
      await env.DB.prepare('UPDATE tracks SET title = ?, maqam = ?, tonic = ?, tempo = ?, meter = ?, notes = ?, updated_at = ? WHERE id = ?')
        .bind(pick('title', 120) || cur.title, pick('maqam', 60), pick('tonic', 20), tempo, pick('meter', 60), pick('notes', 4000), now(), id).run();
      return json(await loadTrack(env, id));
    }
    if (m === 'DELETE' && !sub) {
      const audio = await env.DB.prepare('SELECT audio_id FROM ideas WHERE track_id = ? AND audio_id IS NOT NULL').bind(id).all();
      await Promise.all(audio.results.map(r => env.AUDIO.delete(r.audio_id)));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM holders WHERE track_id = ?').bind(id),
        env.DB.prepare('DELETE FROM ideas WHERE track_id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
    if (sub === 'layers' && m === 'PUT' && LAYERS.includes(subId)) {
      const b = await body(req);
      const list = Array.isArray(b.holders) ? b.holders.slice(0, 12) : [];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM holders WHERE track_id = ? AND layer = ?').bind(id, subId),
        ...list
          .filter(h => h && typeof h.member_id === 'string')
          .map(h => env.DB.prepare('INSERT OR REPLACE INTO holders (track_id, layer, member_id, instrument) VALUES (?, ?, ?, ?)')
            .bind(id, subId, h.member_id, str(h.instrument, 60))),
      ]);
      await touch(env, id);
      return json(await loadTrack(env, id));
    }
    if (sub === 'ideas' && m === 'POST') {
      const b = await body(req);
      if (!LAYERS.includes(b.layer)) return json({ error: 'bad layer' }, 400);
      const kind = ['audio', 'text', 'link'].includes(b.kind) ? b.kind : 'text';
      const row = {
        id: uid(), track_id: id, layer: b.layer, author_id: member, kind,
        body: str(b.body, 4000), url: str(b.url, 1000),
        audio_id: kind === 'audio' ? str(b.audio_id, 40) || null : null,
        audio_mime: kind === 'audio' ? str(b.audio_mime, 80) || null : null,
        duration: Number(b.duration) || null, starred: 0, created_at: now(),
      };
      if (kind === 'audio' && !row.audio_id) return json({ error: 'audio_id required' }, 400);
      if (kind === 'link' && !/^https?:\/\//i.test(row.url)) return json({ error: 'url must start with http' }, 400);
      if (kind === 'text' && !row.body) return json({ error: 'empty note' }, 400);
      await env.DB.prepare(
        'INSERT INTO ideas (id, track_id, layer, author_id, kind, body, url, audio_id, audio_mime, duration, starred, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(row.id, row.track_id, row.layer, row.author_id, row.kind, row.body, row.url, row.audio_id, row.audio_mime, row.duration, 0, row.created_at).run();
      await touch(env, id);
      return json(row, 201);
    }
  }

  if (a === 'ideas' && id) {
    const idea = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first();
    if (!idea) return json({ error: 'not found' }, 404);
    if (m === 'PATCH') {
      const b = await body(req);
      const starred = 'starred' in b ? (b.starred ? 1 : 0) : idea.starred;
      const text = 'body' in b ? str(b.body, 4000) : idea.body;
      const layer = LAYERS.includes(b.layer) ? b.layer : idea.layer;
      await env.DB.prepare('UPDATE ideas SET starred = ?, body = ?, layer = ? WHERE id = ?').bind(starred, text, layer, id).run();
      return json({ ...idea, starred, body: text, layer });
    }
    if (m === 'DELETE') {
      if (idea.audio_id) await env.AUDIO.delete(idea.audio_id);
      await env.DB.prepare('DELETE FROM ideas WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (a === 'audio') {
    if (m === 'POST' && !id) {
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return json({ error: 'empty' }, 400);
      if (buf.byteLength > MAX_AUDIO_BYTES) return json({ error: 'too large' }, 413);
      const aid = uid();
      const mime = (req.headers.get('Content-Type') || 'application/octet-stream').slice(0, 80);
      await env.AUDIO.put(aid, buf, { metadata: { mime } });
      return json({ id: aid, mime, size: buf.byteLength }, 201);
    }
    if (m === 'GET' && id) {
      const { value, metadata } = await env.AUDIO.getWithMetadata(id, { type: 'arrayBuffer', cacheTtl: 86400 });
      if (!value) return json({ error: 'not found' }, 404);
      return new Response(value, {
        headers: { 'Content-Type': metadata?.mime || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
      });
    }
  }

  return null;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return json({ ok: true, app: 'shajara' }, 200, h);

    const key = req.headers.get('X-Band-Key') || url.searchParams.get('k') || '';
    if (!env.BAND_KEY || key !== env.BAND_KEY) return json({ error: 'wrong passcode' }, 401, h);
    const member = str(req.headers.get('X-Member') || '', 40) || null;

    try {
      const res = await route(req, env, url, member);
      if (!res) return json({ error: 'not found' }, 404, h);
      for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, h);
    }
  },
};
