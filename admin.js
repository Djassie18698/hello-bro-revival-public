// Admin panel: http://<server>:18080/admin  (offline hobby server: open to everyone who can reach it, no password unless ADMIN_PASSWORD is set)
// The page itself is admin.html (next to this file); this module serves it and answers its /admin/api/* calls.
const fs = require('fs');
const path = require('path');
const game = require('./game');
const vip = require('./vip');

// Delete one player's character and everything tied to it (the login account stays, so the same device just makes a
// new character). Shared tables that name the player another way are cleaned too. A save backup is written first.
function resetPlayer(db, uid, sid = 1) {
  try {
    const dir = path.join(__dirname, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    db.exec(`VACUUM INTO '${path.join(dir, `before-reset-${uid}-${Date.now()}.db`).replace(/'/g, "''")}'`);
  } catch (e) { /* backup is best effort */ }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of tables) {
    if (t === 'accounts' || t === 'sqlite_sequence') continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (cols.includes('uid')) { if (cols.includes('server_id')) db.prepare(`DELETE FROM ${t} WHERE uid=? AND server_id=?`).run(uid, sid); else if (sid === 1) db.prepare(`DELETE FROM ${t} WHERE uid=?`).run(uid); }
  }
  if (tables.includes('mail')) db.prepare('DELETE FROM mail WHERE to_uid=?').run(uid);
  if (tables.includes('groups')) db.prepare('DELETE FROM groups WHERE leader_uid=?').run(uid);
}

// Admin player key: "uid:server_id" (one login can own a character per server slot); a bare uid means server 1.
function findPlayer(db, key) {
  const [uid, sid] = String(key || '').split(':').map(Number);
  return uid ? db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(uid, sid || 1) : null;
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

// ---- Complete chains: read every chain of every ninja in the team and add what is missing ----------------------------------
// Partners join free team slots (the player's own card when they have one, else a new card: the highest-star version with that name);
// "Equip X" chains put that weapon / armor / trinket / ninjutsu on the ninja. Returns a setteam plan + a list of what changes.
function chainPlan(db, pl) {
  const view = teamView(db, pl);
  const slots = view.slots.map((s) => ({ ninja: { seq: s.ninja.seq }, id: s.ninja.id, level: s.ninja.level, newlife: s.ninja.newlife, growth: s.ninja.growth,
    equip: Object.fromEntries(Object.entries(s.equip).filter(([, e]) => e).map(([k, e]) => [k, { seq: e.seq, id: e.id, level: e.level, newlife: e.newlife }])) }));
  const owned = db.prepare('SELECT seq, type, ninja_id, level FROM cards WHERE uid=? AND server_id=? ORDER BY level DESC, seq').all(pl.uid, pl.server_id);
  const used = new Set(slots.flatMap((s) => [s.ninja.seq, ...Object.values(s.equip).map((e) => e.seq)]));
  const ownedFree = (type, id) => owned.find((c) => c.type === type && c.ninja_id === id && !used.has(c.seq));
  const cards = [...game.ninjas().values()].filter((n) => n[4] === 1 && n[19] > 0);
  const nameOf = (id) => (game.ninjas().get(id) || [])[2] || '#' + id;
  const changes = [];
  const teamIds = () => new Set(slots.map((s) => s.id));
  const pickFor = (part, listed) => { // the card to add for one partner name
    const fits = cards.filter((n) => (game.chainKnown(part) ? game.chainFits(part, n[0]) : listed.includes(n[0])));
    const mine = owned.find((c) => c.type === 1 && !used.has(c.seq) && fits.some((n) => n[0] === c.ninja_id));
    if (mine) return { pick: { seq: mine.seq }, id: mine.ninja_id, how: 'your own' };
    const best = fits.sort((x, y) => (y[11] || 0) - (x[11] || 0) || (/god/i.test(y[2]) ? 1 : 0) - (/god/i.test(x[2]) ? 1 : 0))[0];
    return best ? { pick: { give: best[0] }, id: best[0], how: 'new' } : null;
  };
  const satisfied = (part, listed) => [...teamIds()].some((id) => (game.chainKnown(part) ? game.chainFits(part, id) : listed.includes(id)));
  const first = slots.length; // only the ninjas that were in the team (partners added here do not pull in partners of their own)
  for (let i = 0; i < first; i++) {
    const s = slots[i];
    for (const r of game.matchRows(s.id)) {
      if (r[5] === 0) continue; // leader effect: always on
      const text = String(r[4]).trim();
      // equipment / ninjutsu chains
      for (const [col, isJutsu] of [[14, false], [15, true]]) {
        const want = r[col];
        if (!(want > 0)) continue;
        if (Object.values(s.equip).some((e) => e.id === want && (isJutsu ? e.type === 6 || true : true))) continue;
        let kind;
        if (isJutsu) kind = [5, 6, 7, 8].find((k) => !s.equip[k]);
        else { const er = game.table('equipmentinfo').rows.find((x) => x[0] === want); kind = er ? ({ 0: 1, 1: 2, 2: 3 }[er[3]]) : 0; }
        if (!kind) continue;
        const type = isJutsu ? 6 : { 1: 2, 2: 3, 3: 4 }[kind];
        const mine = ownedFree(type, want);
        const old = s.equip[kind];
        s.equip[kind] = mine ? { seq: mine.seq, id: want, level: mine.level } : { give: want, id: want, level: 50 };
        if (mine) used.add(mine.seq);
        const nm = isJutsu ? ((game.table('ninjutsuinfo').rows.find((x) => x[0] === want) || [])[2]) : ((game.table('equipmentinfo').rows.find((x) => x[0] === want) || [])[2]);
        changes.push(`${nameOf(s.id)}: equip ${mine ? 'your' : 'a new'} ${nm || '#' + want}${old ? ' (replaces what was there)' : ''}  [${text}]`);
      }
      // partner chains
      const p = game.chainPartsOf(r);
      const listed = r.slice(6, 14).filter((x) => x > 0);
      if (!p && !listed.length) continue;
      const parts = p ? p.parts : [null];
      const missing = parts.filter((part) => !(part ? satisfied(part, listed) : [...teamIds()].some((id) => listed.includes(id))));
      if (!missing.length || (p && p.any && missing.length < parts.length)) continue;
      const need = p && p.any ? missing.slice(0, 1) : missing;
      if (slots.length + need.length > view.max) { changes.push(`${nameOf(s.id)}: no free team slot for [${text}]`); continue; }
      for (const part of need) {
        const c = part ? pickFor(part, listed) : (() => { const mine = owned.find((o) => o.type === 1 && !used.has(o.seq) && listed.includes(o.ninja_id)); return mine ? { pick: { seq: mine.seq }, id: mine.ninja_id, how: 'your own' } : { pick: { give: listed[0] }, id: listed[0], how: 'new' }; })();
        if (!c) continue;
        if (c.pick.seq) used.add(c.pick.seq);
        slots.push({ ninja: c.pick, id: c.id, level: 50, newlife: 0, growth: 0, equip: {} });
        changes.push(`add ${c.how === 'new' ? 'a new' : 'your'} ${nameOf(c.id)} for ${nameOf(s.id)}  [${text}]`);
      }
    }
  }
  const plan = slots.map((s) => ({ ninja: s.ninja, level: s.level, newlife: s.newlife, growth: s.growth,
    equip: Object.fromEntries(Object.entries(s.equip).map(([k, e]) => [k, e.seq ? { seq: e.seq, level: e.level, newlife: e.newlife || 0 } : { give: e.give, level: e.level || 50, newlife: 0 }])) }));
  return { plan, changes };
}

// ---- Gear calculator: the strongest weapon / armor / trinket / seal / 4 ninjutsu for every ninja in the team ----------------------
// mode 'owned' = only cards the player has and nobody else in the team wears; 'best' = also new cards (level 50, rebirth 3 for equipment).
// A piece a chain of that ninja asks for ("Equip X") is kept or chosen first; otherwise the score is the slot's total stats
// (attack + defence + chakra, low and high) with the same gear math as the team screen (game.teamStats).
const STATK = ['al', 'ah', 'dl', 'dh', 'cl', 'ch'];
function slotScore(ninjaCard, gear) {
  let st = game.ninjaStats(ninjaCard);
  for (const g of gear) {
    if (!g) continue;
    if (g.type === 5) st = game.sealBonus(st, g.ninja_id);
    else if (g.type === 6) st = game.ninjutsuBonus(st, g.ninja_id);
    else st = game.addStats(st, game.equipStats(g));
  }
  return st;
}
const sum = (st) => STATK.reduce((t, k) => t + (st[k] || 0), 0);
function gearPlan(db, pl, mode) {
  const view = teamView(db, pl);
  const cards = new Map(db.prepare('SELECT * FROM cards WHERE uid=? AND server_id=?').all(pl.uid, pl.server_id).map((c) => [c.seq, c]));
  const inUse = new Set(view.slots.flatMap((s) => [s.ninja.seq, ...Object.values(s.equip).filter(Boolean).map((e) => e.seq)]));
  const freed = new Set(); // gear taken off a ninja here may go to another
  const taken = new Set();
  const equipRows = game.table('equipmentinfo').rows;
  const KTYPE = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 6, 7: 6, 8: 6 };
  const catalog = (type) => {
    if (type <= 4) return equipRows.filter((r) => r[5] === 1 && ({ 0: 2, 1: 3, 2: 4 }[r[3]]) === type).map((r) => r[0]);
    if (type === 5) return game.table('markinfo').rows.map((r) => r[0]);
    return game.table('ninjutsuinfo').rows.map((r) => r[0]);
  };
  const nameOf = (type, id) => (type === 1 ? (game.ninjas().get(id) || [])[2] : type <= 4 ? (equipRows.find((r) => r[0] === id) || [])[2]
    : type === 5 ? (game.table('markinfo').rows.find((r) => r[0] === id) || [])[2] : (game.table('ninjutsuinfo').rows.find((r) => r[0] === id) || [])[2]) || '#' + id;
  const changes = [], plan = [];
  for (const s of view.slots) {
    const ninja = cards.get(s.ninja.seq);
    const chainWants = new Set(game.matchRows(ninja.ninja_id).flatMap((r) => [r[14], r[15]]).filter((x) => x > 0));
    const cur = {};
    for (const [k, e] of Object.entries(s.equip)) if (e) cur[k] = cards.get(e.seq);
    const before = sum(slotScore(ninja, Object.values(cur)));
    const pick = { ...cur };
    const candidates = (type, exclude) => {
      const own = [...cards.values()].filter((c) => c.type === type && !taken.has(c.seq) && (!inUse.has(c.seq) || freed.has(c.seq) || Object.values(cur).some((x) => x && x.seq === c.seq)) && !exclude.has(c.ninja_id));
      const list = own.map((c) => ({ card: c, own: true }));
      if (mode === 'best') for (const id of catalog(type)) if (!exclude.has(id)) list.push({ card: { seq: 0, type, ninja_id: id, level: 50, newlife: type <= 4 ? 3 : 0 }, own: false });
      return list;
    };
    // ninjutsu all give the same stat boost here: the one with the higher power (ninjutsuinfo col 10, e.g. Six Paths Rinnegan 150, Shuriken 31) wins
    const jPower = (id) => (game.table('ninjutsuinfo').rows.find((r) => r[0] === id) || [])[10] || 0;
    const score = (k, c) => { if (c.type === 6) return (chainWants.has(c.ninja_id) ? 1e9 : 0) + jPower(c.ninja_id); const g = { ...pick, [k]: c }; return sum(slotScore(ninja, Object.values(g))) + (chainWants.has(c.ninja_id) ? 1e9 : 0) + (c.type === 6 ? jPower(c.ninja_id) : 0); };
    const choose = (k, exclude) => {
      const type = KTYPE[k], now = pick[k];
      if (now && chainWants.has(now.ninja_id)) return; // keep chain gear
      let best = now ? { card: now, own: true, v: score(k, now) } : null;
      for (const c of candidates(type, exclude)) { const v = score(k, c.card); if (!best || v > best.v + (c.own ? 0 : 0.5)) best = { ...c, v }; }
      if (best && (!now || best.card !== now)) pick[k] = best.card;
    };
    for (const k of [1, 2, 3, 4]) choose(k, new Set());
    for (const k of [5, 6, 7, 8]) choose(k, new Set([5, 6, 7, 8].filter((x) => x !== k && pick[x]).map((x) => pick[x].ninja_id))); // 4 different ninjutsu
    for (const k of Object.keys(pick)) {
      const c = pick[k], was = cur[k];
      if (c.seq) taken.add(c.seq);
      if (was && was !== c) freed.add(was.seq);
      if (!was || was.ninja_id !== c.ninja_id || was.seq !== c.seq) {
        const label = ['', 'weapon', 'armor', 'trinket', 'seal', 'ninjutsu', 'ninjutsu', 'ninjutsu', 'ninjutsu'][k];
        changes.push(`${nameOf(1, ninja.ninja_id)}: ${label} ${was ? nameOf(was.type, was.ninja_id) + ' -> ' : ''}${c.seq ? 'your' : 'a new'} ${nameOf(c.type, c.ninja_id)}`);
      }
    }
    const after = sum(slotScore(ninja, Object.values(pick)));
    if (after > before) changes.push(`   = ${nameOf(1, ninja.ninja_id)} total stats ${before.toLocaleString('en-US')} -> ${after.toLocaleString('en-US')} (+${Math.round((after / Math.max(1, before) - 1) * 100)}%)`);
    plan.push({ ninja: { seq: ninja.seq }, level: ninja.level, newlife: ninja.newlife || 0, growth: ninja.starlevel || 0,
      equip: Object.fromEntries(Object.entries(pick).map(([k, c]) => [k, c.seq ? { seq: c.seq, level: c.level, newlife: c.newlife || 0 } : { give: c.ninja_id, level: c.level, newlife: c.newlife }])) });
  }
  return { plan, changes };
}

// ---- Fight benchmark: the player's real team against enemy teams with a fixed total defence, played many times with the
// server's fight rule (each ninja rolls its attack low..high, worn ninjutsu fire with their chance and add damage, attack is spent on
// enemy defence in order: game.battleXml). Shows the win chance, how many ninjas a win needs and where that defence sits in the story.
function benchmark(db, pl, targets, runs = 300) {
  const ts = game.teamStats(db, pl.uid, pl.server_id);
  const team = db.prepare('SELECT t.slot, c.* FROM team t JOIN cards c ON c.seq=t.seq WHERE t.uid=? AND t.server_id=? ORDER BY t.slot').all(pl.uid, pl.server_id);
  const jRows = db.prepare('SELECT e.slot, c.ninja_id, c.level FROM equipped e JOIN cards c ON c.seq=e.seq WHERE e.uid=? AND e.server_id=? AND e.kind BETWEEN 5 AND 8').all(pl.uid, pl.server_id);
  const jt = game.table('ninjutsuinfo').rows;
  const mine = team.map((t, i) => {
    const q = ts.fight[i] || {}, chakra = Math.round(((q.cl || 0) + (q.ch || 0)) / 2);
    const jutsu = jRows.filter((r) => r.slot === i + 1).map((r) => { const n = jt.find((x) => x[0] === r.ninja_id) || []; return { rate: Number(n[4]) || 0, dmg: (n[10] || 0) + (n[18] || 0) * Math.max(0, (r.level || 1) - 1) + Math.round(chakra * 0.2) }; });
    return { name: cardName(1, t.ninja_id), low: q.al || 0, high: q.ah || 0, jutsu };
  });
  const roll = (m) => { let a = m.low + Math.random() * (m.high - m.low); let n = 0; for (const j of m.jutsu) if (n < 2 && Math.random() < j.rate) { a += j.dmg; n++; } return a; };
  const minAtk = mine.reduce((t, m) => t + m.low, 0), maxAtk = mine.reduce((t, m) => t + m.high, 0);
  const results = targets.map((def) => {
    let wins = 0, used = 0;
    for (let r = 0; r < runs; r++) {
      let left = def, k = 0;
      while (k < mine.length && left > 0) { left -= roll(mine[k]); k++; }
      if (left < 0) { wins++; used += k; }
    }
    const st = game.stageForDefence(def);
    return { def, win: Math.round((wins / runs) * 100), ninjas: wins ? Math.round((used / wins) * 10) / 10 : 0,
      where: st ? `story ${st.chap}-${st.stage}` : 'stronger than the last story boss' };
  });
  return { team: mine.map((m) => ({ name: m.name, low: m.low, high: m.high, jutsu: m.jutsu.length })), minAtk, maxAtk, results };
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
    return json(res, rows.map((p) => ({ ...p, key: p.uid + ':' + p.server_id, vip: vip.level(db, p.uid, p.server_id) })));
  }
  if (u.pathname === '/admin/api/catalog') {
    const q = String(u.query.q || '').toLowerCase(), cat = String(u.query.cat || ''), stars = Number(u.query.stars) || 0;
    const list = catalog().filter((x) => (!cat || x.cat === cat) && (!stars || x.stars === stars) && (!q || x.name.toLowerCase().includes(q)));
    return json(res, { total: list.length, items: u.query.all ? list : list.slice(0, 300) });
  }
  if (u.pathname === '/admin/api/team') {
    const pl = findPlayer(db, u.query.uid);
    return json(res, pl ? teamView(db, pl) : { max: 0, slots: [], owned: {} });
  }
  if (u.pathname === '/admin/api/inventory') {
    const pl = findPlayer(db, u.query.uid);
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
    const pl = findPlayer(db, b.uid);
    if (!pl) return json(res, { ok: false, error: 'no such player' });
    if (u.pathname === '/admin/api/give') {
      if (b.field === 'renown' || b.field === 'souls') { game.propAdd(db, pl.uid, pl.server_id, b.field === 'renown' ? 9996 : 9999, Math.trunc(Number(b.amount)) || 0); return json(res, { ok: true }); }
      if (b.field === 'vip') { vip.setLevel(db, pl.uid, pl.server_id, Number(b.amount)); return json(res, { ok: true }); }
      const col = { gold: 'gold', coin: 'coin', energy: 'energy', level: 'level' }[b.field];
      if (!col) return json(res, { ok: false, error: 'bad field' });
      const amt = Math.trunc(Number(b.amount));
      if (!Number.isFinite(amt)) return json(res, { ok: false, error: 'bad amount' });
      const sql = col === 'level' ? 'UPDATE players SET level=? WHERE uid=? AND server_id=?' : `UPDATE players SET ${col}=MAX(0,${col}+?) WHERE uid=? AND server_id=?`;
      db.prepare(sql).run(amt, pl.uid, pl.server_id);
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
    if (u.pathname === '/admin/api/unlockall') return json(res, { ok: true, ...game.unlockAll(db, pl) });
    if (u.pathname === '/admin/api/bench') {
      const t = (Array.isArray(b.targets) ? b.targets : []).map(Number).filter((x) => x > 0).slice(0, 12);
      return json(res, { ok: true, ...benchmark(db, pl, t.length ? t : [100000, 500000, 1000000, 2000000, 4000000, 8000000]) });
    }
    if (u.pathname === '/admin/api/gearplan') return json(res, { ok: true, ...gearPlan(db, pl, b.mode === 'best' ? 'best' : 'owned') });
    if (u.pathname === '/admin/api/chainplan') return json(res, { ok: true, ...chainPlan(db, pl) });
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
      resetPlayer(db, pl.uid, pl.server_id);
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
