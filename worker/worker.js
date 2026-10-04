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

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// A passcode opens exactly one space. The band's original passcode (BAND_KEY secret) opens 'abba' until that space sets its own.
const parseGenres = g => { try { const l = JSON.parse(g || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
const cleanGenres = l => Array.isArray(l) ? [...new Set(l.map(x => typeof x === 'string' ? x.trim().slice(0, 60) : '').filter(Boolean))].slice(0, 40) : null;
// Line-ups keep a comma-separated list of sound ids per person; this drops one id from every list.
const dropSoundFromLineups = (env, sid) => env.DB.prepare("UPDATE holders SET sound_ids = TRIM(REPLACE(',' || sound_ids || ',', ',' || ? || ',', ','), ',') WHERE ',' || sound_ids || ',' LIKE '%,' || ? || ',%'").bind(sid, sid);
const cleanSoundIds = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(x => /^[a-z0-9]{4,40}$/.test(x)))].slice(0, 12).join(',');
async function resolveSpace(env, key) {
  if (!key) return null;
  const row = await env.DB.prepare('SELECT * FROM spaces WHERE key_hash = ?').bind(await sha256(key)).first();
  if (row) return row;
  if (env.BAND_KEY && key === env.BAND_KEY) return env.DB.prepare("SELECT * FROM spaces WHERE id = 'abba' AND key_hash IS NULL").first();
  return null;
}
async function trackInSpace(env, tid, sp) {
  const t = await env.DB.prepare('SELECT space_id FROM tracks WHERE id = ?').bind(tid).first();
  return !!t && t.space_id === sp;
}

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
    env.DB.prepare('INSERT INTO sections (id, track_id, name, position, meter_n, meter_sub, maqam, tonic, tempo, energy, moves, chords, bars, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sid, trackId, name, (last && last.p != null ? last.p : -1) + 1, src ? src.meter_n : 4, src ? src.meter_sub : 1,
        src ? src.maqam : null, src ? src.tonic : null, src ? src.tempo : null, src ? src.energy : null, src ? src.moves : '', src ? src.chords : null, src ? src.bars : null, '', now()),
  ];
  if (src) {
    stmts.push(
      env.DB.prepare('INSERT INTO holders (section_id, layer, member_id, instrument, sound_ids) SELECT ?, layer, member_id, instrument, sound_ids FROM holders WHERE section_id = ?').bind(sid, src.id),
      env.DB.prepare('INSERT INTO beats (section_id, layer, name, pattern, sub, bar) SELECT ?, layer, name, pattern, sub, bar FROM beats WHERE section_id = ?').bind(sid, src.id),
    );
  }
  await env.DB.batch(stmts);
  return sid;
}

async function deleteIdeas(env, where, arg) {
  const audio = await env.DB.prepare(`SELECT DISTINCT audio_id FROM ideas WHERE ${where} AND audio_id IS NOT NULL`).bind(arg).all();
  await env.DB.prepare(`DELETE FROM ideas WHERE ${where}`).bind(arg).run();
  await dropUnusedAudio(env, audio.results.map(r => r.audio_id));
}
async function dropUnusedAudio(env, ids) {
  for (const aid of ids) {
    const still = await env.DB.prepare('SELECT 1 FROM ideas WHERE audio_id = ? UNION ALL SELECT 1 FROM sounds WHERE audio_id = ? LIMIT 1').bind(aid, aid).first();
    if (!still) await env.AUDIO.delete(aid);
  }
}

// Move a track to another space, re-pointing credits to the same-named person there (adding them as a guest if missing).
async function moveTrack(env, tid, from, to) {
  const used = new Set();
  const t = await env.DB.prepare('SELECT created_by FROM tracks WHERE id = ?').bind(tid).first();
  if (t.created_by) used.add(t.created_by);
  (await env.DB.prepare('SELECT DISTINCT author_id AS m FROM ideas WHERE track_id = ? AND author_id IS NOT NULL').bind(tid).all()).results.forEach(r => used.add(r.m));
  (await env.DB.prepare("SELECT DISTINCT h.member_id AS m FROM holders h JOIN sections s ON s.id = h.section_id WHERE s.track_id = ? AND h.member_id != 'production'").bind(tid).all()).results.forEach(r => used.add(r.m));
  const map = {};
  for (const mid of used) {
    const src = await env.DB.prepare('SELECT * FROM members WHERE id = ? AND space_id = ?').bind(mid, from).first();
    if (!src) continue;
    const dst = await env.DB.prepare('SELECT id FROM members WHERE space_id = ? AND lower(name) = lower(?)').bind(to.id, src.name).first();
    if (dst) { map[mid] = dst.id; continue; }
    const nid = uid();
    await env.DB.prepare('INSERT INTO members (id, name, instruments, created_at, space_id, guest) VALUES (?, ?, ?, ?, ?, 1)').bind(nid, src.name, src.instruments, now(), to.id).run();
    map[mid] = nid;
  }
  const stmts = [env.DB.prepare('UPDATE tracks SET space_id = ?, created_by = COALESCE(?, created_by), updated_at = ? WHERE id = ?').bind(to.id, map[t.created_by] || null, now(), tid)];
  for (const [a, b] of Object.entries(map)) {
    stmts.push(env.DB.prepare('UPDATE ideas SET author_id = ? WHERE track_id = ? AND author_id = ?').bind(b, tid, a));
    stmts.push(env.DB.prepare('UPDATE holders SET member_id = ? WHERE member_id = ? AND section_id IN (SELECT id FROM sections WHERE track_id = ?)').bind(b, a, tid));
  }
  await env.DB.batch(stmts);
}

async function route(req, env, url, member, space) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const m = req.method;
  const [a, id, sub, subId] = parts;
  const sp = space.id;
  const inSpace = `SELECT id FROM tracks WHERE space_id = '${sp.replace(/'/g, '')}'`;

  if (a === 'space') {
    if (id === 'logo' && m === 'PUT') {
      const buf = await req.arrayBuffer();
      const mime = (req.headers.get('Content-Type') || '').slice(0, 40);
      if (!/^image\/(png|jpeg|webp)$/.test(mime)) return json({ error: 'logo must be a PNG, JPEG or WebP image' }, 400);
      if (!buf.byteLength || buf.byteLength > 1024 * 1024) return json({ error: 'logo must be under 1 MB' }, 413);
      await env.AUDIO.put('logo:' + sp, buf, { metadata: { mime } });
      const v = now();
      await env.DB.prepare('UPDATE spaces SET logo_v = ? WHERE id = ?').bind(v, sp).run();
      return json({ id: sp, logo_v: v });
    }
    if (id === 'logo' && m === 'DELETE') {
      await env.AUDIO.delete('logo:' + sp);
      await env.DB.prepare('UPDATE spaces SET logo_v = NULL WHERE id = ?').bind(sp).run();
      return json({ id: sp, logo_v: null });
    }
    if (m === 'PATCH') {
      const b = await body(req);
      const name = str(b.name, 60);
      const key = typeof b.new_key === 'string' ? b.new_key.trim() : '';
      if (key) {
        if (key.length < 6) return json({ error: 'passcode must be at least 6 characters' }, 400);
        const h = await sha256(key);
        const clash = await env.DB.prepare('SELECT id FROM spaces WHERE key_hash = ? AND id != ?').bind(h, sp).first();
        if (clash || (env.BAND_KEY && key === env.BAND_KEY && sp !== 'abba')) return json({ error: 'pick a different passcode' }, 400);
        await env.DB.prepare('UPDATE spaces SET key_hash = ? WHERE id = ?').bind(h, sp).run();
      }
      if (name) await env.DB.prepare('UPDATE spaces SET name = ? WHERE id = ?').bind(name, sp).run();
      const genres = cleanGenres(b.genres);
      if (genres) await env.DB.prepare('UPDATE spaces SET genres = ? WHERE id = ?').bind(JSON.stringify(genres), sp).run();
      const row = await env.DB.prepare('SELECT id, name, genres FROM spaces WHERE id = ?').bind(sp).first();
      return json({ id: row.id, name: row.name, genres: parseGenres(row.genres) });
    }
  }

  if (a === 'state' && m === 'GET') {
    const [members, tracks, sections, holders, beats, counts, grooves] = await Promise.all([
      env.DB.prepare('SELECT * FROM members WHERE space_id = ? ORDER BY guest, created_at').bind(sp).all(),
      env.DB.prepare('SELECT id, title, maqam, tonic, tempo, genre, notes, created_by, updated_at, created_at FROM tracks WHERE space_id = ? ORDER BY updated_at DESC').bind(sp).all(),
      env.DB.prepare(`SELECT id, track_id, name, position, meter_n, meter_sub, energy, bars, maqam, tempo FROM sections WHERE track_id IN (${inSpace}) ORDER BY position, created_at`).all(),
      env.DB.prepare(`SELECT h.*, s.track_id FROM holders h JOIN sections s ON s.id = h.section_id WHERE s.track_id IN (${inSpace})`).all(),
      env.DB.prepare(`SELECT b.section_id, b.layer, b.name, s.track_id FROM beats b JOIN sections s ON s.id = b.section_id WHERE s.track_id IN (${inSpace})`).all(),
      env.DB.prepare(`SELECT track_id, kind, COUNT(*) AS n, MAX(created_at) AS last FROM ideas WHERE track_id IN (${inSpace}) GROUP BY track_id, kind`).all(),
      env.DB.prepare('SELECT * FROM grooves WHERE space_id = ? ORDER BY name').bind(sp).all(),
    ]);
    const mem = `SELECT id FROM members WHERE space_id = '${sp.replace(/'/g, '')}'`;
    let ins = await env.DB.prepare(`SELECT * FROM instruments WHERE member_id IN (${mem}) ORDER BY position, created_at`).all();
    const missing = members.results.filter(mm => mm.instruments && !ins.results.some(i => i.member_id === mm.id));
    if (missing.length) {
      const stmts = [];
      for (const mm of missing) mm.instruments.split(',').map(x => x.trim()).filter(Boolean).forEach((name, k) =>
        stmts.push(env.DB.prepare('INSERT INTO instruments (id, member_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid(), mm.id, name.slice(0, 60), k, now())));
      if (stmts.length) await env.DB.batch(stmts);
      ins = await env.DB.prepare(`SELECT * FROM instruments WHERE member_id IN (${mem}) ORDER BY position, created_at`).all();
    }
    const snd = await env.DB.prepare(`SELECT * FROM sounds WHERE instrument_id IN (SELECT id FROM instruments WHERE member_id IN (${mem})) ORDER BY position, created_at`).all();
    // Takes that name a sound, so the app can remember who uses what where.
    const takes = await env.DB.prepare(`SELECT track_id, section_id, layer, author_id, sound_id, created_at FROM ideas WHERE sound_id IS NOT NULL AND sound_id != '' AND track_id IN (${inSpace}) ORDER BY created_at DESC LIMIT 2000`).all();
    const byTrack = {};
    for (const t of tracks.results) byTrack[t.id] = { ...t, notes: (t.notes || '').slice(0, 280), sections: [], holders: [], beats: [], ideas: 0, kinds: {}, last: null };
    for (const s of sections.results) byTrack[s.track_id]?.sections.push(s);
    for (const h of holders.results) byTrack[h.track_id]?.holders.push(h);
    for (const b of beats.results) byTrack[b.track_id]?.beats.push(b);
    for (const c of counts.results) { const t = byTrack[c.track_id]; if (!t) continue; t.ideas += c.n; t.kinds[c.kind] = c.n; }
    const lasts = await env.DB.prepare(`SELECT i.track_id, i.author_id, i.kind, i.created_at FROM ideas i JOIN (SELECT track_id, MAX(created_at) AS m FROM ideas WHERE track_id IN (${inSpace}) GROUP BY track_id) x ON x.track_id = i.track_id AND x.m = i.created_at`).all();
    for (const l of lasts.results) if (byTrack[l.track_id]) byTrack[l.track_id].last = { by: l.author_id, kind: l.kind, at: l.created_at };
    return json({ space: { id: space.id, name: space.name, logo_v: space.logo_v || null, genres: parseGenres(space.genres) }, instruments: ins.results, sounds: snd.results, sound_takes: takes.results, members: members.results, tracks: tracks.results.map(t => byTrack[t.id]), grooves: grooves.results });
  }

  if (a === 'grooves') {
    if (m === 'POST' && !id) {
      const b = await body(req);
      const name = str(b.name, 60);
      const pattern = typeof b.pattern === 'string' ? b.pattern.toUpperCase() : '';
      const sub = [1, 2, 3, 4, 6, 8].includes(Number(b.sub)) ? Number(b.sub) : 2;
      const bar = Number(b.bar) || pattern.length;
      if (!name) return json({ error: 'name required' }, 400);
      if (!/^[DTK-]{2,128}$/.test(pattern) || !/[DTK]/.test(pattern) || bar < 1 || bar > 32 || pattern.length % bar) return json({ error: 'bad pattern' }, 400);
      const same = await env.DB.prepare('SELECT id FROM grooves WHERE space_id = ? AND lower(name) = lower(?)').bind(sp, name).first();
      const gid = same ? same.id : uid();
      await env.DB.prepare('INSERT OR REPLACE INTO grooves (id, name, pattern, sub, bar, created_by, created_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(gid, name, pattern, sub, bar, member, now(), sp).run();
      return json(await env.DB.prepare('SELECT * FROM grooves WHERE id = ?').bind(gid).first(), 201);
    }
    if (m === 'DELETE' && id) {
      await env.DB.prepare('DELETE FROM grooves WHERE id = ? AND space_id = ?').bind(id, sp).run();
      return json({ ok: true });
    }
  }

  const memberInSpace = async mid => !!(await env.DB.prepare('SELECT 1 FROM members WHERE id = ? AND space_id = ?').bind(mid, sp).first());
  const instInSpace = async iid => { const r = await env.DB.prepare('SELECT member_id FROM instruments WHERE id = ?').bind(iid).first(); return r && (await memberInSpace(r.member_id)) ? r : null; };
  if (a === 'instruments') {
    if (m === 'POST' && !id) {
      const b = await body(req); const name = str(b.name, 60);
      if (!name || !(await memberInSpace(str(b.member_id, 40)))) return json({ error: 'name and person required' }, 400);
      const last = await env.DB.prepare('SELECT MAX(position) AS p FROM instruments WHERE member_id = ?').bind(b.member_id).first();
      const row = { id: uid(), member_id: b.member_id, name, position: (last && last.p != null ? last.p : -1) + 1, created_at: now() };
      await env.DB.prepare('INSERT INTO instruments (id, member_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(row.id, row.member_id, row.name, row.position, row.created_at).run();
      return json(row, 201);
    }
    if (id && !(await instInSpace(id))) return json({ error: 'not found' }, 404);
    if (m === 'PATCH' && id) {
      const b = await body(req); const name = str(b.name, 60);
      if (name) await env.DB.prepare('UPDATE instruments SET name = ? WHERE id = ?').bind(name, id).run();
      return json(await env.DB.prepare('SELECT * FROM instruments WHERE id = ?').bind(id).first());
    }
    if (m === 'DELETE' && id) {
      const au = await env.DB.prepare('SELECT audio_id FROM sounds WHERE instrument_id = ? AND audio_id IS NOT NULL').bind(id).all();
      const sids = await env.DB.prepare('SELECT id FROM sounds WHERE instrument_id = ?').bind(id).all();
      await env.DB.batch([
        ...sids.results.map(r => dropSoundFromLineups(env, r.id)),
        env.DB.prepare('UPDATE ideas SET sound_id = NULL WHERE sound_id IN (SELECT id FROM sounds WHERE instrument_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM sounds WHERE instrument_id = ?').bind(id),
        env.DB.prepare('DELETE FROM instruments WHERE id = ?').bind(id),
      ]);
      await dropUnusedAudio(env, au.results.map(r => r.audio_id));
      return json({ ok: true });
    }
  }
  if (a === 'sounds') {
    if (m === 'POST' && !id) {
      const b = await body(req); const name = str(b.name, 60);
      if (!name || !(await instInSpace(str(b.instrument_id, 40)))) return json({ error: 'name and instrument required' }, 400);
      const last = await env.DB.prepare('SELECT MAX(position) AS p FROM sounds WHERE instrument_id = ?').bind(b.instrument_id).first();
      const row = { id: uid(), instrument_id: b.instrument_id, name, notes: str(b.notes, 500), audio_id: str(b.audio_id, 40) || null, audio_mime: str(b.audio_mime, 80) || null,
        duration: Number(b.duration) || null, position: (last && last.p != null ? last.p : -1) + 1, created_at: now() };
      await env.DB.prepare('INSERT INTO sounds (id, instrument_id, name, notes, audio_id, audio_mime, duration, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(row.id, row.instrument_id, row.name, row.notes, row.audio_id, row.audio_mime, row.duration, row.position, row.created_at).run();
      return json(row, 201);
    }
    const cur = id ? await env.DB.prepare('SELECT * FROM sounds WHERE id = ?').bind(id).first() : null;
    if (id && (!cur || !(await instInSpace(cur.instrument_id)))) return json({ error: 'not found' }, 404);
    if (m === 'PATCH' && id) {
      const b = await body(req);
      const audio = 'audio_id' in b ? (str(b.audio_id, 40) || null) : cur.audio_id;
      await env.DB.prepare('UPDATE sounds SET name = ?, notes = ?, audio_id = ?, audio_mime = ?, duration = ? WHERE id = ?').bind(
        str(b.name, 60) || cur.name, 'notes' in b ? str(b.notes, 500) : cur.notes, audio,
        'audio_id' in b ? (str(b.audio_mime, 80) || null) : cur.audio_mime, 'audio_id' in b ? (Number(b.duration) || null) : cur.duration, id).run();
      if (cur.audio_id && cur.audio_id !== audio) await dropUnusedAudio(env, [cur.audio_id]);
      return json(await env.DB.prepare('SELECT * FROM sounds WHERE id = ?').bind(id).first());
    }
    if (m === 'DELETE' && id) {
      await env.DB.batch([
        dropSoundFromLineups(env, id),
        env.DB.prepare('UPDATE ideas SET sound_id = NULL WHERE sound_id = ?').bind(id),
        env.DB.prepare('DELETE FROM sounds WHERE id = ?').bind(id),
      ]);
      if (cur.audio_id) await dropUnusedAudio(env, [cur.audio_id]);
      return json({ ok: true });
    }
  }

  if (a === 'members') {
    if (m === 'POST' && !id) {
      const b = await body(req);
      const name = str(b.name, 60);
      if (!name) return json({ error: 'name required' }, 400);
      const row = { id: uid(), name, instruments: str(b.instruments, 200), created_at: now(), space_id: sp, guest: b.guest ? 1 : 0 };
      await env.DB.prepare('INSERT INTO members (id, name, instruments, created_at, space_id, guest) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(row.id, row.name, row.instruments, row.created_at, sp, row.guest).run();
      return json(row, 201);
    }
    if (m === 'PATCH' && id) {
      const b = await body(req);
      const cur = await env.DB.prepare('SELECT * FROM members WHERE id = ? AND space_id = ?').bind(id, sp).first();
      if (!cur) return json({ error: 'not found' }, 404);
      await env.DB.prepare('UPDATE members SET name = COALESCE(NULLIF(?, \'\'), name), instruments = ?, guest = ?, ready = ? WHERE id = ?')
        .bind(str(b.name, 60), 'instruments' in b ? str(b.instruments, 200) : cur.instruments, 'guest' in b ? (b.guest ? 1 : 0) : cur.guest, 'ready' in b ? (b.ready ? 1 : 0) : cur.ready, id).run();
      return json(await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first());
    }
    if (m === 'DELETE' && id) {
      const cur = await env.DB.prepare('SELECT id FROM members WHERE id = ? AND space_id = ?').bind(id, sp).first();
      if (!cur) return json({ error: 'not found' }, 404);
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
        'INSERT INTO tracks (id, title, maqam, tonic, tempo, genre, chords, notes, created_by, created_at, updated_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(tid, title, str(b.maqam, 60), str(b.tonic, 20), intIn(b.tempo, 20, 400, null), str(b.genre, 60), str(b.chords, 1000), str(b.notes, 4000), member, t, t, sp).run();
      const plan = Array.isArray(b.sections) ? b.sections.filter(x => x && str(x.name, 60)).slice(0, 16) : [];
      if (!plan.length) plan.push({ name: str(b.section, 60) || 'Main' });
      for (const p of plan) {
        const sid = await addSection(env, tid, str(p.name, 60));
        await env.DB.prepare('UPDATE sections SET energy = ?, meter_n = ?, meter_sub = ?, maqam = ?, tonic = ?, tempo = ?, bars = ?, notes = ? WHERE id = ?').bind(
          intIn(p.energy, 1, 5, null), intIn(p.meter_n ?? b.meter_n, 1, 32, 4),
          [1, 2, 4].includes(Number(p.meter_sub ?? b.meter_sub)) ? Number(p.meter_sub ?? b.meter_sub) : 1,
          str(p.maqam, 60) || null, str(p.tonic, 20) || null, intIn(p.tempo, 20, 400, null), intIn(p.bars, 1, 256, null),
          str(p.notes, 4000), sid,
        ).run();
      }
      return json(await loadTrack(env, tid), 201);
    }
    if (!id) return null;
    if (!(await trackInSpace(env, id, sp))) return json({ error: 'not found' }, 404);
    if (sub === 'move' && m === 'POST') {
      const b = await body(req);
      const to = await resolveSpace(env, typeof b.target_key === 'string' ? b.target_key.trim() : '');
      if (!to) return json({ error: 'that passcode doesn’t open a space' }, 400);
      if (to.id === sp) return json({ error: 'it’s already in this space' }, 400);
      await moveTrack(env, id, sp, to);
      return json({ ok: true, space: { id: to.id, name: to.name } });
    }
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
      await env.DB.prepare('UPDATE tracks SET title = ?, maqam = ?, tonic = ?, tempo = ?, genre = ?, chords = ?, notes = ?, updated_at = ? WHERE id = ?')
        .bind(pick('title', 120) || cur.title, pick('maqam', 60), pick('tonic', 20), tempo, pick('genre', 60), pick('chords', 1000), pick('notes', 4000), now(), id).run();
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
    if (!trackId || !(await trackInSpace(env, trackId, sp))) return json({ error: 'not found' }, 404);

    if (m === 'PATCH' && !sub) {
      const b = await body(req);
      const cur = await env.DB.prepare('SELECT * FROM sections WHERE id = ?').bind(id).first();
      const opt = (k, max) => (k in b ? (str(b[k], max) || null) : cur[k]);
      let moves = cur.moves;
      if ('moves' in b) {
        moves = typeof b.moves === 'string' ? b.moves : JSON.stringify(b.moves || {});
        try { JSON.parse(moves || '{}'); } catch { return json({ error: 'bad moves' }, 400); }
        if (moves.length > 4000) return json({ error: 'moves too long' }, 400);
      }
      await env.DB.prepare('UPDATE sections SET name = ?, notes = ?, meter_n = ?, meter_sub = ?, position = ?, maqam = ?, tonic = ?, tempo = ?, energy = ?, moves = ?, chords = ?, bars = ? WHERE id = ?').bind(
        str(b.name, 60) || cur.name,
        'notes' in b ? str(b.notes, 4000) : cur.notes,
        intIn(b.meter_n, 1, 32, cur.meter_n),
        [1, 2, 4].includes(Number(b.meter_sub)) ? Number(b.meter_sub) : cur.meter_sub,
        Number.isFinite(Number(b.position)) && 'position' in b ? Number(b.position) : cur.position,
        opt('maqam', 60), opt('tonic', 20),
        'tempo' in b ? intIn(b.tempo, 20, 400, null) : cur.tempo,
        'energy' in b ? intIn(b.energy, 1, 5, null) : cur.energy,
        moves,
        opt('chords', 1000),
        'bars' in b ? intIn(b.bars, 1, 256, null) : cur.bars,
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
    if (sub === 'lineup' && m === 'PUT') {
      const b = await body(req);
      const seen = new Set();
      const list = (Array.isArray(b.holders) ? b.holders : [])
        .filter(h => h && typeof h.member_id === 'string' && LAYERS.includes(h.layer))
        .filter(h => h.member_id === 'production' || (!seen.has(h.member_id) && seen.add(h.member_id)))
        .slice(0, 24);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM holders WHERE section_id = ?').bind(id),
        ...list.map(h => env.DB.prepare('INSERT OR REPLACE INTO holders (section_id, layer, member_id, instrument, sound_ids) VALUES (?, ?, ?, ?, ?)')
          .bind(id, h.layer, str(h.member_id, 40), str(h.instrument, 60), cleanSoundIds(h.sound_ids))),
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
        data: typeof b.data === 'string' ? b.data : '', sound_id: str(b.sound_id, 40) || null, created_at: now(),
      };
      if (kind === 'audio' && !row.audio_id) return json({ error: 'audio_id required' }, 400);
      if (kind === 'link' && !/^https?:\/\//i.test(row.url)) return json({ error: 'url must start with http' }, 400);
      if (kind === 'text' && !row.body) return json({ error: 'empty note' }, 400);
      if (row.data.length > 300000) return json({ error: 'take too long' }, 413);
      if (row.data) { try { JSON.parse(row.data); } catch { return json({ error: 'bad data' }, 400); } }
      if (kind === 'midi') { try { if (!Array.isArray(JSON.parse(row.data).notes)) throw 0; } catch { return json({ error: 'bad midi data' }, 400); } }
      await env.DB.prepare(
        'INSERT INTO ideas (id, track_id, section_id, layer, author_id, kind, body, url, audio_id, audio_mime, duration, starred, data, sound_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(row.id, row.track_id, row.section_id, row.layer, row.author_id, row.kind, row.body, row.url, row.audio_id, row.audio_mime, row.duration, 0, row.data, row.sound_id, row.created_at).run();
      await touch(env, trackId);
      return json(row, 201);
    }
  }

  if (a === 'ideas' && id) {
    const idea = await env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first();
    if (!idea || !(await trackInSpace(env, idea.track_id, sp))) return json({ error: 'not found' }, 404);
    if (m === 'PATCH') {
      const b = await body(req);
      const starred = 'starred' in b ? (b.starred ? 1 : 0) : idea.starred;
      const text = 'body' in b ? str(b.body, 4000) : idea.body;
      const layer = IDEA_LANES.includes(b.layer) ? b.layer : idea.layer;
      let data = idea.data;
      if ('place' in b) {
        let d = {}; try { d = idea.data ? JSON.parse(idea.data) : {}; } catch {}
        const pl = b.place && typeof b.place === 'object' ? { mode: b.place.mode === 'once' ? 'once' : 'loop', bar: intIn(b.place.bar, 1, 256, 1) } : null;
        if (pl) d.place = pl; else delete d.place;
        data = JSON.stringify(d);
      }
      const soundId = 'sound_id' in b ? (str(b.sound_id, 40) || null) : idea.sound_id;
      await env.DB.prepare('UPDATE ideas SET starred = ?, body = ?, layer = ?, data = ?, sound_id = ? WHERE id = ?').bind(starred, text, layer, data, soundId, id).run();
      return json({ ...idea, starred, body: text, layer, data, sound_id: soundId });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM ideas WHERE id = ?').bind(id).run();
      if (idea.audio_id) await dropUnusedAudio(env, [idea.audio_id]);
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
      const owned = await env.DB.prepare(`SELECT 1 FROM ideas WHERE audio_id = ? AND track_id IN (${inSpace}) UNION ALL SELECT 1 FROM sounds s JOIN instruments i ON i.id = s.instrument_id JOIN members mm ON mm.id = i.member_id WHERE s.audio_id = ? AND mm.space_id = ? LIMIT 1`).bind(id, id, sp).first();
      if (!owned) return json({ error: 'not found' }, 404);
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

    if (url.pathname === '/api/spaces' && req.method === 'POST') {
      const b = await body(req);
      const name = str(b.name, 40), me = str(b.me, 60), key = typeof b.key === 'string' ? b.key.trim() : '';
      if (!name || !me) return json({ error: 'a space needs a name, and so do you' }, 400, h);
      if (key.length < 6) return json({ error: 'passcode must be at least 6 characters' }, 400, h);
      const kh = await sha256(key);
      if ((await env.DB.prepare('SELECT 1 FROM spaces WHERE key_hash = ?').bind(kh).first()) || (env.BAND_KEY && key === env.BAND_KEY)) return json({ error: 'pick a different passcode' }, 400, h);
      if (await env.DB.prepare('SELECT 1 FROM spaces WHERE lower(name) = lower(?)').bind(name).first()) return json({ error: 'a space with that name exists already' }, 400, h);
      const sid = uid(), mid = uid(), t = now();
      const people = (Array.isArray(b.people) ? b.people : []).slice(0, 40)
        .map(x => ({ name: str(x && x.name, 60), guest: x && x.guest ? 1 : 0 }))
        .filter((x, i, l) => x.name && x.name.toLowerCase() !== me.toLowerCase() && l.findIndex(y => y.name.toLowerCase() === x.name.toLowerCase()) === i);
      const ins = (Array.isArray(b.instruments) ? b.instruments : String(b.instruments || '').split(','))
        .map(x => str(x, 60)).filter(Boolean).slice(0, 12);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO spaces (id, name, key_hash, genres, created_at) VALUES (?, ?, ?, ?, ?)').bind(sid, name, kh, JSON.stringify(cleanGenres(b.genres) || []), t),
        env.DB.prepare('INSERT INTO members (id, name, instruments, created_at, space_id, guest, ready) VALUES (?, ?, ?, ?, ?, 0, 1)').bind(mid, me, ins.join(', '), t, sid),
        ...ins.map((x, i) => env.DB.prepare('INSERT INTO instruments (id, member_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(uid(), mid, x, i, t)),
        ...people.map((x, i) => env.DB.prepare('INSERT INTO members (id, name, instruments, created_at, space_id, guest) VALUES (?, ?, \'\', ?, ?, ?)').bind(uid(), x.name, t + 1 + i, sid, x.guest)),
      ]);
      return json({ space: { id: sid, name }, me: mid }, 201, h);
    }
    const lm = url.pathname.match(/^\/api\/spaces\/([a-z0-9]+)\/logo$/);
    if (lm && req.method === 'GET') {
      const { value, metadata } = await env.AUDIO.getWithMetadata('logo:' + lm[1], { type: 'arrayBuffer', cacheTtl: 86400 });
      if (!value) return json({ error: 'not found' }, 404, h);
      return new Response(value, { headers: { ...h, 'Content-Type': metadata?.mime || 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    if (url.pathname === '/api/spaces' && req.method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, name, logo_v FROM spaces ORDER BY created_at').all();
      return json({ spaces: rows.results, epoch: env.LOGOUT_EPOCH || '' }, 200, h);
    }
    const key = req.headers.get('X-Band-Key') || url.searchParams.get('k') || '';
    let space;
    try { space = await resolveSpace(env, key); } catch { space = null; }
    if (!space) return json({ error: 'wrong passcode' }, 401, h);
    const member = str(req.headers.get('X-Member') || '', 40) || null;

    try {
      const res = await route(req, env, url, member, space);
      if (!res) return json({ error: 'not found' }, 404, h);
      for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, h);
    }
  },
};
