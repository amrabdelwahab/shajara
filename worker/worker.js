const LAYERS = ['substrate', 'ground', 'bark', 'bloom'];
const IDEA_LANES = [...LAYERS, 'transition'];
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
const intIn = (v, lo, hi, d) => { const n = Math.round(Number(v)); return n >= lo && n <= hi ? n : d; };

async function loadTrack(env, id) {
  const track = await env.DB.prepare('SELECT * FROM tracks WHERE id = ?').bind(id).first();
  if (!track) return null;
  const [sections, holders, beats, ideas] = await Promise.all([
    env.DB.prepare('SELECT * FROM sections WHERE track_id = ? ORDER BY position, created_at').bind(id).all(),
    env.DB.prepare('SELECT h.* FROM holders h JOIN sections s ON s.id = h.section_id WHERE s.track_id = ?').bind(id).all(),
    env.DB.prepare('SELECT b.* FROM beats b JOIN sections s ON s.id = b.section_id WHERE s.track_id = ?').bind(id).all(),
    env.DB.prepare('SELECT * FROM ideas WHERE track_id = ? ORDER BY created_at DESC').bind(id).all(),
  ]);
  return { ...track, sections: sections.results, holders: holders.results, beats: beats.results, ideas: ideas.results };
}

async function touch(env, trackId) {
  await env.DB.prepare('UPDATE tracks SET updated_at = ? WHERE id = ?').bind(now(), trackId).run();
}

async function sectionTrack(env, sid) {
  const s = await env.DB.prepare('SELECT track_id FROM sections WHERE id = ?').bind(sid).first();
  return s && s.track_id;
}

async function addSection(env, trackId, name, copyFrom) {
  const last = await env.DB.prepare('SELECT MAX(position) AS p FROM sections WHERE track_id = ?').bind(trackId).first();
  const src = copyFrom ? await env.DB.prepare('SELECT * FROM sections WHERE id = ? AND track_id = ?').bind(copyFrom, trackId).first() : null;
  const sid = uid();
  const stmts = [
    env.DB.prepare('INSERT INTO sections (id, track_id, name, position, meter_n, meter_sub, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sid, trackId, name, (last && last.p != null ? last.p : -1) + 1, src ? src.meter_n : 4, src ? src.meter_sub : 1, '', now()),
  ];
  if (src) {
    stmts.push(
      env.DB.prepare('INSERT INTO holders (section_id, layer, member_id, instrument) SELECT ?, layer, member_id, instrument FROM holders WHERE section_id = ?').bind(sid, src.id),
      env.DB.prepare('INSERT INTO beats (section_id, layer, name, pattern, sub, bar) SELECT ?, layer, name, pattern, sub, bar FROM beats WHERE section_id = ?').bind(sid, src.id),
    );
  }
  await env.DB.batch(stmts);
  return sid;
}

async function deleteIdeas(env, where, arg) {
  const audio = await env.DB.prepare(`SELECT audio_id FROM ideas WHERE ${where} AND audio_id IS NOT NULL`).bind(arg).all();
  await Promise.all(audio.results.map(r => env.AUDIO.delete(r.audio_id)));
  await env.DB.prepare(`DELETE FROM ideas WHERE ${where}`).bind(arg).run();
}

async function route(req, env, url, member) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const m = req.method;
  const [a, id, sub, subId] = parts;

  if (a === 'state' && m === 'GET') {
    const [members, tracks, sections, holders, beats, counts] = await Promise.all([
      env.DB.prepare('SELECT * FROM members ORDER BY created_at').all(),
      env.DB.prepare('SELECT id, title, maqam, tonic, tempo, updated_at, created_at FROM tracks ORDER BY updated_at DESC').all(),
      env.DB.prepare('SELECT id, track_id, name, position, meter_n, meter_sub FROM sections ORDER BY position, created_at').all(),
      env.DB.prepare('SELECT h.*, s.track_id FROM holders h JOIN sections s ON s.id = h.section_id').all(),
      env.DB.prepare('SELECT b.section_id, b.layer, b.name, s.track_id FROM beats b JOIN sections s ON s.id = b.section_id').all(),
      env.DB.prepare('SELECT track_id, COUNT(*) AS n FROM ideas GROUP BY track_id').all(),
    ]);
    const byTrack = {};
    for (const t of tracks.results) byTrack[t.id] = { ...t, sections: [], holders: [], beats: [], ideas: 0 };
    for (const s of sections.results) byTrack[s.track_id]?.sections.push(s);
    for (const h of holders.results) byTrack[h.track_id]?.holders.push(h);
    for (const b of beats.results) byTrack[b.track_id]?.beats.push(b);
    for (const c of counts.results) if (byTrack[c.track_id]) byTrack[c.track_id].ideas = c.n;
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
        'INSERT INTO tracks (id, title, maqam, tonic, tempo, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(tid, title, str(b.maqam, 60), str(b.tonic, 20), intIn(b.tempo, 20, 400, null), str(b.notes, 4000), member, t, t).run();
      await addSection(env, tid, str(b.section, 60) || 'Main');
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
      const tempo = 'tempo' in b ? intIn(b.tempo, 20, 400, null) : cur.tempo;
      await env.DB.prepare('UPDATE tracks SET title = ?, maqam = ?, tonic = ?, tempo = ?, notes = ?, updated_at = ? WHERE id = ?')
        .bind(pick('title', 120) || cur.title, pick('maqam', 60), pick('tonic', 20), tempo, pick('notes', 4000), now(), id).run();
      return json(await loadTrack(env, id));
    }
    if (m === 'DELETE' && !sub) {
      await deleteIdeas(env, 'track_id = ?', id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM holders WHERE section_id IN (SELECT id FROM sections WHERE track_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM beats WHERE section_id IN (SELECT id FROM sections WHERE track_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM sections WHERE track_id = ?').bind(id),
        env.DB.prepare('DELETE FROM tracks WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
    if (sub === 'sections' && m === 'POST') {
      const b = await body(req);
      const name = str(b.name, 60);
      if (!name) return json({ error: 'name required' }, 400);
      const sid = await addSection(env, id, name, str(b.copy_from, 40) || null);
      await touch(env, id);
      return json({ ...(await loadTrack(env, id)), new_section: sid }, 201);
    }
  }

  if (a === 'sections' && id) {
    const trackId = await sectionTrack(env, id);
    if (!trackId) return json({ error: 'not found' }, 404);

    if (m === 'PATCH' && !sub) {
      const b = await body(req);
      const cur = await env.DB.prepare('SELECT * FROM sections WHERE id = ?').bind(id).first();
      await env.DB.prepare('UPDATE sections SET name = ?, notes = ?, meter_n = ?, meter_sub = ?, position = ? WHERE id = ?').bind(
        str(b.name, 60) || cur.name,
        'notes' in b ? str(b.notes, 4000) : cur.notes,
        intIn(b.meter_n, 1, 32, cur.meter_n),
        [1, 2, 4].includes(Number(b.meter_sub)) ? Number(b.meter_sub) : cur.meter_sub,
        Number.isFinite(Number(b.position)) && 'position' in b ? Number(b.position) : cur.position,
        id,
      ).run();
      await touch(env, trackId);
      return json(await loadTrack(env, trackId));
    }
    if (m === 'DELETE' && !sub) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM sections WHERE track_id = ?').bind(trackId).first();
      if (n.n <= 1) return json({ error: 'a track needs at least one section' }, 400);
      await deleteIdeas(env, 'section_id = ?', id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM holders WHERE section_id = ?').bind(id),
        env.DB.prepare('DELETE FROM beats WHERE section_id = ?').bind(id),
        env.DB.prepare('DELETE FROM sections WHERE id = ?').bind(id),
      ]);
      await touch(env, trackId);
      return json(await loadTrack(env, trackId));
    }
    if (sub === 'layers' && m === 'PUT' && LAYERS.includes(subId)) {
      const b = await body(req);
      const list = Array.isArray(b.holders) ? b.holders.slice(0, 12) : [];
      await env.DB.batch([
        env.DB.prepare('DELETE FROM holders WHERE section_id = ? AND layer = ?').bind(id, subId),
        ...list
          .filter(h => h && typeof h.member_id === 'string')
          .map(h => env.DB.prepare('INSERT OR REPLACE INTO holders (section_id, layer, member_id, instrument) VALUES (?, ?, ?, ?)')
            .bind(id, subId, h.member_id, str(h.instrument, 60))),
      ]);
      await touch(env, trackId);
      return json(await loadTrack(env, trackId));
    }
    if (sub === 'beats' && m === 'PUT' && LAYERS.includes(subId)) {
      const b = await body(req);
      const pattern = typeof b.pattern === 'string' ? b.pattern.toUpperCase() : '';
      const name = str(b.name, 60);
      if (!name && !/[DTK]/.test(pattern)) {
        await env.DB.prepare('DELETE FROM beats WHERE section_id = ? AND layer = ?').bind(id, subId).run();
      } else {
        const sub = [1, 2, 3, 4, 6, 8].includes(Number(b.sub)) ? Number(b.sub) : 2;
        const bar = Number(b.bar) || pattern.length;
        if (!/^[DTK-]{2,128}$/.test(pattern) || !/[DTK]/.test(pattern) || bar < 1 || bar > 32 || pattern.length % bar) return json({ error: 'bad pattern' }, 400);
        await env.DB.prepare('INSERT OR REPLACE INTO beats (section_id, layer, name, pattern, sub, bar) VALUES (?, ?, ?, ?, ?, ?)').bind(id, subId, name, pattern, sub, bar).run();
      }
      await touch(env, trackId);
      return json(await loadTrack(env, trackId));
    }
    if (sub === 'ideas' && m === 'POST') {
      const b = await body(req);
      if (!IDEA_LANES.includes(b.layer)) return json({ error: 'bad layer' }, 400);
      const kind = ['audio', 'text', 'link', 'midi'].includes(b.kind) ? b.kind : 'text';
      const row = {
        id: uid(), track_id: trackId, section_id: id, layer: b.layer, author_id: member, kind,
        body: str(b.body, 4000), url: str(b.url, 1000),
        audio_id: kind === 'audio' ? str(b.audio_id, 40) || null : null,
        audio_mime: kind === 'audio' ? str(b.audio_mime, 80) || null : null,
        duration: Number(b.duration) || null, starred: 0,
        data: typeof b.data === 'string' ? b.data : '', created_at: now(),
      };
      if (kind === 'audio' && !row.audio_id) return json({ error: 'audio_id required' }, 400);
      if (kind === 'link' && !/^https?:\/\//i.test(row.url)) return json({ error: 'url must start with http' }, 400);
      if (kind === 'text' && !row.body) return json({ error: 'empty note' }, 400);
      if (row.data.length > 300000) return json({ error: 'take too long' }, 413);
      if (row.data) { try { JSON.parse(row.data); } catch { return json({ error: 'bad data' }, 400); } }
      if (kind === 'midi') { try { if (!Array.isArray(JSON.parse(row.data).notes)) throw 0; } catch { return json({ error: 'bad midi data' }, 400); } }
      await env.DB.prepare(
        'INSERT INTO ideas (id, track_id, section_id, layer, author_id, kind, body, url, audio_id, audio_mime, duration, starred, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(row.id, row.track_id, row.section_id, row.layer, row.author_id, row.kind, row.body, row.url, row.audio_id, row.audio_mime, row.duration, 0, row.data, row.created_at).run();
      await touch(env, trackId);
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
      const layer = IDEA_LANES.includes(b.layer) ? b.layer : idea.layer;
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
