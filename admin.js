// Admin panel: http://<server>:18080/admin  (offline hobby server: open to everyone who can reach it, no password unless ADMIN_PASSWORD is set)
// The page itself is admin.html (next to this file); this module serves it and answers its /admin/api/* calls.
const fs = require('fs');
const path = require('path');
const game = require('./game');
const vip = require('./vip');

// Delete one player's character and everything tied to it (the login account stays, so the same device just makes a
// new character). Shared tables that name the player another way are cleaned too. A save backup is written first.
function resetPlayer(db, uid) {
  try {
    const dir = path.join(__dirname, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    db.exec(`VACUUM INTO '${path.join(dir, `before-reset-${uid}-${Date.now()}.db`).replace(/'/g, "''")}'`);
  } catch (e) { /* backup is best effort */ }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of tables) {
    if (t === 'accounts' || t === 'sqlite_sequence') continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (cols.includes('uid')) db.prepare(`DELETE FROM ${t} WHERE uid=?`).run(uid);
  }
  if (tables.includes('mail')) db.prepare('DELETE FROM mail WHERE to_uid=?').run(uid);
  if (tables.includes('groups')) db.prepare('DELETE FROM groups WHERE leader_uid=?').run(uid);
}

const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

// Private play: no password. Public server: set ADMIN_PASSWORD; the browser then asks for it (user name is ignored).
function authorized(req) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const given = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  return given === pw;
}

// ---- Catalog: everything that can be given, in one list (category, id, name, stars) ----------------------------------
const SLOT = { 0: 'Weapon', 1: 'Armor', 2: 'Trinket' };
let catalogCache = null;
function catalog() {
  if (catalogCache) return catalogCache;
  const out = [];
  const seen = new Set();
  for (const r of game.ninjas().values()) {
    // playable shinobi cards only: col 4 = 1 (card), real stats in col 19; npcs (enemy-only rows) have no stats
    if (r[4] !== 1 || !(r[19] > 0)) continue;
    const key = r[2] + '|' + r[11] + '|' + r[6];
    if (seen.has(key)) continue; // the table repeats some cards with another element; keep one of each
    seen.add(key);
    out.push({ cat: 'ninja', id: r[0], name: r[2], stars: r[11] || 0, sub: r[6] ? 'variant' : '' });
  }
  for (const r of game.table('equipmentinfo').rows) out.push({ cat: 'equip', id: r[0], name: r[2], stars: r[6] || 0, sub: SLOT[r[3]] || '' });
  for (const r of game.table('ninjutsuinfo').rows) out.push({ cat: 'ninjutsu', id: r[0], name: r[2], stars: r[5] || 0, sub: '' });
  for (const r of game.table('markinfo').rows) out.push({ cat: 'seal', id: r[0], name: r[2], stars: r[6] || 0, sub: String(r[7] || '').trim() });
  for (const r of game.table('consumeinfo').rows) out.push({ cat: 'item', id: r[1], name: r[2], stars: 0, sub: '' });
  for (const r of game.table('piece_info').rows) out.push({ cat: 'fragment', id: r[0], name: r[2] + ' fragment', stars: r[5] || 0, sub: `${r[7]} make one` });
  for (const r of game.table('petinfo').rows) out.push({ cat: 'pet', id: r[0], name: r[2], stars: 0, sub: 'pet' });
  catalogCache = out;
  return out;
}

// Card level / rebirth limits: level 1-50 for every card kind (ninjaupgrade/equipupgrade/... have 50 rows), rebirth 0-8 for shinobi
// (game.NEWLIFE_MAX), 0-3 for equipment (equipnewlifeprop), none for ninjutsu and seals. Sage growth 0-15 for shinobi only (game.GROW_MAX).
const LIMITS = { ninja: { lv: 50, nl: 8, gr: game.GROW_MAX }, equip: { lv: 50, nl: 3, gr: 0 }, ninjutsu: { lv: 50, nl: 0, gr: 0 }, seal: { lv: 50, nl: 0, gr: 0 } };
const clamp = (v, lo, hi) => Math.min(Math.max(Math.trunc(v) || lo, lo), hi);
const clampCard = (cat, lv, nl, gr) => {
  const L = LIMITS[cat] || { lv: 1, nl: 0, gr: 0 };
  return { lv: clamp(lv, 1, L.lv), nl: clamp(nl, 0, L.nl), gr: L.gr ? clamp(gr, 0, L.gr) : null };
};
// gr null = leave the card's growth as it is (only shinobi have sage growth)
const setCard = (db, seq, c) => {
  if (seq) db.prepare('UPDATE cards SET level=?, newlife=?, starlevel=COALESCE(?, starlevel) WHERE seq=?').run(c.lv, c.nl, c.gr, seq);
  return seq;
};

// Give one catalog entry n times (cards at the chosen level / rebirth). Returns how many really arrived.
function giveOne(db, pl, cat, id, n, opt = {}) {
  const uid = pl.uid, sid = pl.server_id, c = clampCard(cat, opt.level, opt.newlife, opt.growth);
  if (cat === 'ninja') { for (let i = 0; i < n; i++) setCard(db, game.giveCard(db, uid, sid, id), c); return n; }
  if (cat === 'equip') { let k = 0; for (let i = 0; i < n; i++) if (setCard(db, game.giveEquip(db, uid, sid, id), c)) k++; return k; }
  if (cat === 'ninjutsu') { for (let i = 0; i < n; i++) setCard(db, game.giveCard(db, uid, sid, id, 6), c); return n; }
  if (cat === 'seal') { for (let i = 0; i < n; i++) setCard(db, game.giveCard(db, uid, sid, id, 5), c); return n; }
  if (cat === 'item') { game.propAdd(db, uid, sid, id, n); return n; }
  if (cat === 'fragment') { game.propAdd(db, uid, sid, game.CHIP_BASE + id, n); return n; }
  if (cat === 'pet') { for (let i = 0; i < n; i++) require('./pet').addPet(db, uid, sid, id); return n; }
  return 0;
}

const CARD_TYPES = { 1: 'Shinobi', 2: 'Weapon', 3: 'Armor', 4: 'Trinket', 5: 'Seal', 6: 'Ninjutsu' };
function cardName(type, id) {
  if (type === 1) return (game.ninjas().get(id) || [])[2] || '#' + id;
  if (type >= 2 && type <= 4) return (game.table('equipmentinfo').rows.find((r) => r[0] === id) || [])[2] || '#' + id;
  if (type === 5) return (game.table('markinfo').rows.find((r) => r[0] === id) || [])[2] || '#' + id;
  if (type === 6) return (game.table('ninjutsuinfo').rows.find((r) => r[0] === id) || [])[2] || '#' + id;
  return '#' + id;
}

let pageCache = null;
// ---- Team editor: the whole team (ninjas + their 8 gear slots) in one go ------------------------------------------------
// equipped.kind: 1 weapon (card type 2), 2 armor (3), 3 trinket (4), 4 seal (5), 5-8 ninjutsu (6). equipped.slot = team position + 1.
const KIND_TYPE = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 6, 7: 6, 8: 6 };
const TYPE_CAT = { 1: 'ninja', 2: 'equip', 3: 'equip', 4: 'equip', 5: 'seal', 6: 'ninjutsu' };
const cardInfo = (c) => c && { seq: c.seq, type: c.type, id: c.ninja_id, name: cardName(c.type, c.ninja_id), level: c.level, newlife: c.newlife || 0, growth: c.starlevel || 0 };
function teamView(db, pl) {
  game.ensure(db);
  const cards = db.prepare('SELECT * FROM cards WHERE uid=? AND server_id=? ORDER BY level DESC, seq').all(pl.uid, pl.server_id);
  const bySeq = new Map(cards.map((c) => [c.seq, c]));
  const team = db.prepare('SELECT seq FROM team WHERE uid=? AND server_id=? ORDER BY slot').all(pl.uid, pl.server_id);
  const eq = db.prepare('SELECT slot, kind, seq FROM equipped WHERE uid=? AND server_id=?').all(pl.uid, pl.server_id);
  const slots = team.map((t, i) => ({
    ninja: cardInfo(bySeq.get(t.seq)),
    equip: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((k) => { const e = eq.find((x) => x.slot === i + 1 && x.kind === k); return [k, e ? cardInfo(bySeq.get(e.seq)) : null]; })),
  }));
  const owned = {};
  for (const c of cards) (owned[c.type] = owned[c.type] || []).push(cardInfo(c));
  const t = game.teamStats(db, pl.uid, pl.server_id).total;
  return { max: game.maxTeam(db, pl), slots, owned, power: { attack: `${t.al}-${t.ah}`, defense: `${t.dl}-${t.dh}` } };
}
// slots: [{ ninja: { seq } | { give: id }, level, newlife, growth, equip: { kind: { seq } | { give: id }, level, newlife } | null }]
function applyTeam(db, pl, slots) {
  game.ensure(db);
  const max = game.maxTeam(db, pl);
  const list = (Array.isArray(slots) ? slots : []).filter((s) => s && s.ninja).slice(0, max);
  const own = (seq, type) => db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=? AND type=?').get(Number(seq), pl.uid, pl.server_id, type);
  const used = new Set();
  const resolve = (pick, type, kindForEquip) => {
    if (!pick) return 0;
    if (pick.seq) { const c = own(pick.seq, type); if (!c) throw new Error('a picked card is not owned any more'); if (used.has(c.seq)) throw new Error(cardName(c.type, c.ninja_id) + ' is picked twice'); return c.seq; }
    const id = Math.trunc(Number(pick.give));
    if (!id) return 0;
    const seq = type === 1 ? game.giveCard(db, pl.uid, pl.server_id, id) : type <= 4 ? game.giveEquip(db, pl.uid, pl.server_id, id) : game.giveCard(db, pl.uid, pl.server_id, id, type);
    if (!seq) throw new Error('could not create card #' + id);
    const got = db.prepare('SELECT type FROM cards WHERE seq=?').get(seq).type;
    if (got !== type) { db.prepare('DELETE FROM cards WHERE seq=?').run(seq); throw new Error('that item does not fit the ' + (['', '', 'weapon', 'armor', 'trinket'][type] || 'chosen') + ' slot'); }
    return seq;
  };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM team WHERE uid=? AND server_id=?').run(pl.uid, pl.server_id);
    db.prepare('DELETE FROM equipped WHERE uid=? AND server_id=?').run(pl.uid, pl.server_id);
    list.forEach((s, i) => {
      const seq = resolve(s.ninja, 1);
      used.add(seq);
      setCard(db, seq, clampCard('ninja', s.level, s.newlife, s.growth));
      db.prepare('INSERT INTO team(uid,server_id,slot,seq) VALUES(?,?,?,?)').run(pl.uid, pl.server_id, i, seq);
      for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const e = s.equip && s.equip[k];
        if (!e || (!e.seq && !e.give)) continue;
        const type = KIND_TYPE[k], eseq = resolve(e, type);
        if (!eseq) continue;
        used.add(eseq);
        setCard(db, eseq, clampCard(TYPE_CAT[type], e.level, e.newlife, 0));
        db.prepare('INSERT INTO equipped(uid,server_id,slot,kind,seq) VALUES(?,?,?,?,?)').run(pl.uid, pl.server_id, i + 1, k, eseq);
      }
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { ok: false, error: e.message };
  }
  return { ok: true, ...teamView(db, pl) };
}

// The control panel (panel.html): one page with tabs (Server / Players & items / Team builder) that embeds /manager and /admin.
function panel(res, start) {
  const page = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8').replace('<body>', `<body data-start="${start}">`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(page);
}

module.exports = async function admin(req, res, u, db, readBody) {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Hello Bro admin"' });
    return res.end('password required');
  }
  if ((u.pathname === '/admin' || u.pathname === '/admin/') && !u.query.embed) return panel(res, 'admin');
  if (u.pathname === '/admin' || u.pathname === '/admin/') {
    if (!pageCache || process.env.HB_DEBUG) pageCache = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(pageCache);
  }
  game.ensure(db);
  if (u.pathname === '/admin/api/players') {
    const rows = db.prepare(`SELECT p.uid,p.nick,p.level,p.gold,p.coin,p.energy,p.server_id,
      (SELECT COUNT(*) FROM cards c WHERE c.uid=p.uid AND c.server_id=p.server_id) cards FROM players p ORDER BY p.level DESC, p.uid`).all();
    return json(res, rows.map((p) => ({ ...p, vip: vip.level(db, p.uid, p.server_id) })));
  }
  if (u.pathname === '/admin/api/catalog') {
    const q = String(u.query.q || '').toLowerCase(), cat = String(u.query.cat || ''), stars = Number(u.query.stars) || 0;
    const list = catalog().filter((x) => (!cat || x.cat === cat) && (!stars || x.stars === stars) && (!q || x.name.toLowerCase().includes(q)));
    return json(res, { total: list.length, items: u.query.all ? list : list.slice(0, 300) });
  }
  if (u.pathname === '/admin/api/team') {
    const pl = db.prepare('SELECT * FROM players WHERE uid=?').get(Number(u.query.uid));
    return json(res, pl ? teamView(db, pl) : { max: 0, slots: [], owned: {} });
  }
  if (u.pathname === '/admin/api/inventory') {
    const pl = db.prepare('SELECT * FROM players WHERE uid=?').get(Number(u.query.uid));
    if (!pl) return json(res, { cards: [], props: [] });
    const cards = db.prepare('SELECT seq, type, ninja_id, level, newlife, starlevel FROM cards WHERE uid=? AND server_id=? ORDER BY type, seq DESC').all(pl.uid, pl.server_id)
      .map((c) => ({ seq: c.seq, kind: CARD_TYPES[c.type] || '?', name: cardName(c.type, c.ninja_id), level: c.level, newlife: c.newlife || 0, growth: c.starlevel || 0, cat: c.type === 1 ? 'ninja' : c.type <= 4 ? 'equip' : c.type === 5 ? 'seal' : 'ninjutsu' }));
    const items = new Map(game.table('consumeinfo').rows.map((r) => [r[1], r[2]]));
    const props = Object.entries(game.propCounts(db, pl.uid, pl.server_id)).filter(([, n]) => n > 0).map(([id, n]) => {
      id = Number(id);
      const name = id >= game.CHIP_BASE ? ((game.table('piece_info').rows.find((r) => r[0] === id - game.CHIP_BASE) || [])[2] || '#') + ' fragment'
        : items.get(id) || { 9999: 'Ninja souls', 9998: 'Gate souls', 9996: 'Arena reputation', 9995: 'Boss reputation', 9994: 'War merit' }[id] || 'Item #' + id;
      return { id, name, count: n };
    });
    return json(res, { cards, props });
  }
  if (req.method === 'POST') {
    let b;
    try { b = JSON.parse(await readBody(req)); } catch { return json(res, { ok: false, error: 'bad json' }); }
    const pl = db.prepare('SELECT * FROM players WHERE uid=?').get(b.uid);
    if (!pl) return json(res, { ok: false, error: 'no such player' });
    if (u.pathname === '/admin/api/give') {
      if (b.field === 'renown' || b.field === 'souls') { game.propAdd(db, pl.uid, pl.server_id, b.field === 'renown' ? 9996 : 9999, Math.trunc(Number(b.amount)) || 0); return json(res, { ok: true }); }
      if (b.field === 'vip') { vip.setLevel(db, pl.uid, pl.server_id, Number(b.amount)); return json(res, { ok: true }); }
      const col = { gold: 'gold', coin: 'coin', energy: 'energy', level: 'level' }[b.field];
      if (!col) return json(res, { ok: false, error: 'bad field' });
      const amt = Math.trunc(Number(b.amount));
      if (!Number.isFinite(amt)) return json(res, { ok: false, error: 'bad amount' });
      const sql = col === 'level' ? 'UPDATE players SET level=? WHERE uid=?' : `UPDATE players SET ${col}=MAX(0,${col}+?) WHERE uid=?`;
      db.prepare(sql).run(amt, b.uid);
      return json(res, { ok: true });
    }
    if (u.pathname === '/admin/api/givething') { // one catalog entry
      const n = Math.min(Math.max(Math.trunc(b.count) || 1, 1), 999);
      const entry = catalog().find((x) => x.cat === b.cat && x.id === Number(b.id));
      if (!entry) return json(res, { ok: false, error: 'unknown thing' });
      const got = giveOne(db, pl, entry.cat, entry.id, n, { level: b.level, newlife: b.newlife, growth: b.growth });
      return json(res, { ok: got > 0, given: got, name: entry.name, error: got ? '' : 'nothing could be given' });
    }
    if (u.pathname === '/admin/api/bulk') { // every entry of a category (optionally one star level), count each
      const n = Math.min(Math.max(Math.trunc(b.count) || 1, 1), 99);
      const list = catalog().filter((x) => x.cat === b.cat && (!b.stars || x.stars === Number(b.stars)));
      if (!list.length) return json(res, { ok: false, error: 'nothing in that group' });
      if (list.length * n > 5000) return json(res, { ok: false, error: `that is ${list.length * n} things; pick a star level or a smaller count` });
      let got = 0;
      for (const x of list) got += giveOne(db, pl, x.cat, x.id, n, { level: b.level, newlife: b.newlife, growth: b.growth });
      return json(res, { ok: true, given: got, kinds: list.length });
    }
    if (u.pathname === '/admin/api/setcard') { // change level / rebirth of a card the player already owns
      const card = db.prepare('SELECT * FROM cards WHERE uid=? AND server_id=? AND seq=?').get(pl.uid, pl.server_id, b.seq);
      if (!card) return json(res, { ok: false, error: 'no such card' });
      const cat = card.type === 1 ? 'ninja' : card.type <= 4 ? 'equip' : card.type === 5 ? 'seal' : 'ninjutsu';
      const c = clampCard(cat, b.level, b.newlife, b.growth);
      setCard(db, card.seq, c);
      return json(res, { ok: true, level: c.lv, newlife: c.nl, growth: c.gr });
    }
    if (u.pathname === '/admin/api/setteam') return json(res, applyTeam(db, pl, b.slots));
    if (u.pathname === '/admin/api/setprop') { // set the exact amount of one item / fragment / souls
      const id = Math.trunc(Number(b.id)), n = Math.max(0, Math.min(Math.trunc(Number(b.count)) || 0, 999999999));
      if (!id) return json(res, { ok: false, error: 'bad item' });
      const have = game.propCounts(db, pl.uid, pl.server_id)[id] || 0;
      game.propAdd(db, pl.uid, pl.server_id, id, n - have);
      return json(res, { ok: true, count: n });
    }
    if (u.pathname === '/admin/api/delcard') {
      const inTeam = db.prepare('SELECT 1 FROM team WHERE uid=? AND server_id=? AND seq=?').get(pl.uid, pl.server_id, b.seq);
      if (inTeam) return json(res, { ok: false, error: 'that card is in the team; take it out first' });
      db.prepare('DELETE FROM equipped WHERE uid=? AND server_id=? AND seq=?').run(pl.uid, pl.server_id, b.seq);
      db.prepare('DELETE FROM cards WHERE uid=? AND server_id=? AND seq=?').run(pl.uid, pl.server_id, b.seq);
      return json(res, { ok: true });
    }
    if (u.pathname === '/admin/api/reset') {
      resetPlayer(db, pl.uid);
      return json(res, { ok: true });
    }
    if (u.pathname === '/admin/api/givecard') { // old page / scripts
      if (!game.ninjas().has(b.ninja)) return json(res, { ok: false, error: 'unknown character' });
      const n = Math.min(Math.max(Math.trunc(b.count) || 1, 1), 100);
      for (let i = 0; i < n; i++) game.giveCard(db, pl.uid, pl.server_id, b.ninja);
      return json(res, { ok: true });
    }
  }
  res.writeHead(404); res.end('not found');
};

module.exports.authorized = authorized;
module.exports.panel = panel;
