// Game-state helpers: cards (characters), teams, starter grants. Data tables live in ./data/*.json
const fs = require('fs');
const path = require('path');

const table = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name + '.json'), 'utf8'));
let ninjaById = null;
const ninjas = () => {
  if (!ninjaById) {
    ninjaById = new Map();
    for (const r of table('ninjainfo').rows) ninjaById.set(r[0], r);
  }
  return ninjaById;
};

let ready = new WeakSet();
function ensure(db) {
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      uid INTEGER NOT NULL, server_id INTEGER NOT NULL,
      type INTEGER NOT NULL DEFAULT 1, ninja_id INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1, exp INTEGER NOT NULL DEFAULT 0, starlevel INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS team (
      uid INTEGER NOT NULL, server_id INTEGER NOT NULL, slot INTEGER NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY (uid, server_id, slot)
    );
    CREATE TABLE IF NOT EXISTS progress (
      uid INTEGER NOT NULL, server_id INTEGER NOT NULL, chap INTEGER NOT NULL, stage INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (uid, server_id, chap)
    );
    CREATE TABLE IF NOT EXISTS equipped (
      uid INTEGER NOT NULL, server_id INTEGER NOT NULL, slot INTEGER NOT NULL, kind INTEGER NOT NULL, seq INTEGER NOT NULL,
      PRIMARY KEY (uid, server_id, slot, kind)
    );
    CREATE INDEX IF NOT EXISTS cards_owner ON cards(uid, server_id);
  `);
  try { db.exec('ALTER TABLE players ADD COLUMN vip INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE players ADD COLUMN vipexp INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE cards ADD COLUMN newlife INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already there */ }
  for (const c of ['pot_att', 'pot_def', 'pot_ckr', 'pend_att', 'pend_def', 'pend_ckr', 'breaklvl', 'attri']) { try { db.exec(`ALTER TABLE cards ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`); } catch (e) { /* already there */ } }
  ready.add(db);
}

// Starter characters: the one picked at character creation first, then the rest of Team 7-ish.
const STARTERS = { 1: 57, 2: 56, 3: 55 }; // Shikamaru, Sakura, Neji (the 3 choices on the create screen)
const BASE_TEAM = [5, 35, 9]; // Naruto, Kakashi, Sasuke

function giveCard(db, uid, sid, ninjaId, type = 1) {
  const r = db.prepare('INSERT INTO cards(uid,server_id,type,ninja_id) VALUES(?,?,?,?)').run(uid, sid, type, ninjaId);
  return Number(r.lastInsertRowid);
}

function ensureStarterTeam(db, uid, sid, pick) {
  ensure(db);
  const have = db.prepare('SELECT COUNT(*) n FROM cards WHERE uid=? AND server_id=?').get(uid, sid).n;
  if (have > 0) return;
  const ids = [STARTERS[pick] || 57, ...BASE_TEAM];
  ids.forEach((nid, i) => {
    const seq = giveCard(db, uid, sid, nid);
    db.prepare('INSERT OR REPLACE INTO team(uid,server_id,slot,seq) VALUES(?,?,?,?)').run(uid, sid, i, seq);
  });
}

// ---- Equipment (cards of type 2 weapon / 3 armor / 4 accessory; id = equipmentinfo id) -------
const equipRows = () => table('equipmentinfo').rows;
const SLOT_TYPE = { 0: 2, 1: 3, 2: 4 }; // equipmentinfo col3 slot -> card type
function giveEquip(db, uid, sid, equipId) {
  const e = equipRows().find((r) => r[0] === equipId);
  if (!e) return 0;
  return giveCard(db, uid, sid, equipId, SLOT_TYPE[e[3]] || 2);
}
function randomEquip(slot, minStar = 3) {
  const pool = equipRows().filter((r) => r[3] === slot && r[5] === 1 && r[6] >= minStar);
  return pool[Math.floor(Math.random() * pool.length)][0];
}

const el = (n, v) => `<${n}>${v}</${n}>`;
function cardXml(c) {
  const f = {
    type: c.type, id: c.ninja_id, exp: c.exp, seq: c.seq, level: c.level, attri: 0, starlevel: c.starlevel,
    newlife: c.newlife || 0, tupo_level: 0, cha_tupo: 0, defence_tupo: 0, attack_tupo: 0, attackadd: 0, defenseadd: 0,
    attack_add: c.pot_att || 0, defence_add: c.pot_def || 0, cha_add: c.pot_ckr || 0, status: 0,
  };
  return '<card>' + Object.entries(f).map(([k, v]) => el(k, v)).join('') + '</card>';
}

// One team slot as CTeamCard::firefly_InitFromXml reads it (ninjaid = the card's seq).
function slotXml(seq, slot, eq = {}, st = {}) {
  const f = { seq: slot + 1, ninjaid: seq, weaponid: eq[1] || 0, armorid: eq[2] || 0, decoratorid: eq[3] || 0, markid: eq[4] || 0,
    ninjintsu1seq: eq[5] || 0, ninjintsu2seq: eq[6] || 0, ninjintsu3seq: eq[7] || 0, ninjintsu4seq: eq[8] || 0,
    attacklow: st.al || 10, attackhigh: st.ah || 20, defenselow: st.dl || 5, defensehigh: st.dh || 10, chakralow: st.cl || 10, chakrahigh: st.ch || 20, skillsuit: 0 };
  return '<ninja>' + Object.entries(f).map(([k, v]) => el(k, v)).join('') +
    '<combinlist></combinlist><readycombinlist></readycombinlist></ninja>';
}

// Equip (kind 1 weapon, 2 armor, 3 trinket, 4 seal, 5-8 ninjutsu slots) a card onto the ninja in team slot (1-based).
function equip(db, pl, slot, kind, newSeq) {
  ensure(db);
  db.prepare('DELETE FROM equipped WHERE uid=? AND server_id=? AND kind=? AND seq=?').run(pl.uid, pl.server_id, kind, newSeq);
  if (!newSeq) db.prepare('DELETE FROM equipped WHERE uid=? AND server_id=? AND slot=? AND kind=?').run(pl.uid, pl.server_id, slot, kind);
  else db.prepare('INSERT OR REPLACE INTO equipped(uid,server_id,slot,kind,seq) VALUES(?,?,?,?,?)').run(pl.uid, pl.server_id, slot, kind, newSeq);
}

function stateXml(db, uid, sid) {
  ensure(db);
  const cards = db.prepare('SELECT * FROM cards WHERE uid=? AND server_id=? ORDER BY seq').all(uid, sid);
  let team = db.prepare('SELECT seq FROM team WHERE uid=? AND server_id=? ORDER BY slot').all(uid, sid);
  if (process.env.HB_TEAM_SLOTS !== undefined) team = team.slice(0, Number(process.env.HB_TEAM_SLOTS)); // debugging aid
  const ts = teamStats(db, uid, sid);
  const eqRows = db.prepare('SELECT slot, kind, seq FROM equipped WHERE uid=? AND server_id=?').all(uid, sid);
  const eqOf = (slot) => Object.fromEntries(eqRows.filter((r) => r.slot === slot).map((r) => [r.kind, r.seq]));
  return {
    suitlist: '<suitlist>' + ts.suits.map((r) => `<item id="${r[0]}" type="${r[2]}"/>`).join('') + '</suitlist>',
    totals: ts.total,
    cards: cards.map(cardXml).join(''),
    ninjalist: '<ninjalist>' + team.map((t, i) => slotXml(t.seq, i, eqOf(i + 1), (ts.slots[i] || {}))).join('') + '</ninjalist>',
  };
}

// ---- Gacha ("recruit") -----------------------------------------------------------------
// Pull types follow recruitinfo.dbf rows: 1 = premium (300 gold), 2 = standard (150 gold), 3 = free.
// Star weights are a hobby-server design choice (the original rates lived on the old server).
const RATES = {
  1: { 6: 2, 5: 12, 4: 36, 3: 50 },
  2: { 5: 4, 4: 20, 3: 46, 2: 30 },
  3: { 4: 5, 3: 25, 2: 40, 1: 30 },
};
const COST = { 1: 300, 2: 150, 3: 0 };
const TEN_COST = { 1: 2800, 2: 1400, 3: 0 };
let byStar = null;
function pools() {
  if (!byStar) {
    byStar = {};
    for (const r of ninjas().values()) if (r[4] === 1 && r[6] === 0) (byStar[r[11]] = byStar[r[11]] || []).push(r[0]);
  }
  return byStar;
}
function rollOne(type) {
  try { const f = Number(fs.readFileSync(path.join(__dirname, 'force_ninja.txt'), 'utf8')); if (f) return f; } catch {} // debugging aid
  const rates = RATES[type] || RATES[2];
  const total = Object.values(rates).reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  let star = Number(Object.keys(rates)[0]);
  for (const [s, w] of Object.entries(rates)) { if ((x -= w) < 0) { star = Number(s); break; } }
  const pool = pools()[star] || pools()[3];
  return pool[Math.floor(Math.random() * pool.length)];
}
function pull(db, pl, type, count, free) {
  const cost = free ? 0 : count === 10 ? (TEN_COST[type] ?? 1400) : (COST[type] ?? 150) * count; // ten-pull prices are the ones the client shows
  if (pl.gold < cost) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  const got = [];
  for (let i = 0; i < count; i++) {
    const nid = process.env.HB_FORCE ? Number(process.env.HB_FORCE) : rollOne(type);
    got.push({ ninja: nid, seq: giveCard(db, pl.uid, pl.server_id, nid) });
  }
  return { cost, got };
}
function awardXml(c) {
  return '<award dropid="1"><cardlist><card>' + el('id', c.ninja) + el('type', 1) + el('num', 1) + el('attri', 0) + el('bagIndex', c.seq) + el('level', 1) + el('newlife', 0) + el('starlevel', 0) +
    '</card></cardlist><proplist></proplist><chipbag></chipbag><coin>0</coin><cash>0</cash><exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award>';
}
// ---- Real game drops (dropinfo.dbf): [3] ninja, [4] equipment, [5] ninjutsu, [6] mark, [7] prop, [8] equip piece,
// [10] gold, [11] silver, [12] drop type (1 = random pack), [13] count. Grants the reward and returns a full <award>.
// Random packs (type 1, no fixed item) are resolved from their description: shinobi packs roll a ninja,
// equipment packs a piece of gear, gift packs a card or gold.
function rollPack(r) {
  const t = String(r[2]);
  const star = /Five-Star Shinobi Card|Sage of the Six/.test(t) ? (Math.random() < 0.35 ? 5 : 4) : /Pack III/.test(t) ? (Math.random() < 0.2 ? 5 : 4) : /Pack II/.test(t) ? (Math.random() < 0.15 ? 4 : 3) : (Math.random() < 0.08 ? 5 : 3);
  if (/Equipment/.test(t)) return { equip: randomEquip(1 + Math.floor(Math.random() * 3), star) };
  if (/Gold/.test(t) && Math.random() < 0.3) return { cash: Number((t.match(/(\d+) Gold/) || [0, 300])[1]) };
  if (/Ninjutsu/.test(t)) return { coin: 30000 };
  const pool = pools()[star] || pools()[4];
  return { ninja: pool[Math.floor(Math.random() * pool.length)] };
}
// Shinobi card fragments (piece_info ids) are kept as props CHIP_BASE + pieceId; the login sends them as <chipbag><chipitem/>.
const CHIP_BASE = 30000;
function chipCount(db, uid, sid, pieceId) { return propCounts(db, uid, sid)[CHIP_BASE + pieceId] || 0; }
function chipbagXml(db, uid, sid) {
  return '<chipbag>' + Object.entries(propCounts(db, uid, sid)).filter(([id, n]) => id > CHIP_BASE && id < CHIP_BASE + 10000 && n > 0)
    .map(([id, n]) => `<chipitem id="${id - CHIP_BASE}" num="${n}"/>`).join('') + '</chipbag>';
}
// Backpack > fragments > Merge (rl_w_comm Cmd 10, ChipBagID = piece_info id): piece [7] fragments become drop [8].
function mergeChips(db, pl, pieceId) {
  const r = table('piece_info').rows.find((x) => x[0] === pieceId);
  if (!r) return { error: 'no such fragment' };
  if (chipCount(db, pl.uid, pl.server_id, pieceId) < r[7]) return { error: 'not enough fragments' };
  propAdd(db, pl.uid, pl.server_id, CHIP_BASE + pieceId, -r[7]);
  return { xml: grantDrop(db, pl, r[8]) };
}
function grantDrop(db, pl, dropId) {
  const r = table('dropinfo').rows.find((x) => x[0] === dropId);
  if (!r) return null;
  const n = r[13] || 1;
  const cards = [], props = [];
  let coin = 0, cash = 0, soul = 0, chips = 0;
  const pack = r[12] === 1 && !(r[3] > 0) && !(r[7] > 0) ? rollPack(r) : null;
  const ninja = pack ? pack.ninja : r[3], equip = pack ? pack.equip : (r[3] > 0 ? 0 : r[4]);
  if (ninja > 0) for (let i = 0; i < n; i++) cards.push({ type: 1, id: ninja, seq: giveCard(db, pl.uid, pl.server_id, ninja) });
  else if (equip > 0) for (let i = 0; i < n; i++) { const seq = giveEquip(db, pl.uid, pl.server_id, equip); if (seq) cards.push({ type: db.prepare('SELECT type FROM cards WHERE seq=?').get(seq).type, id: equip, seq }); }
  else if (pack) { cash = pack.cash || 0; coin = pack.coin || 0; }
  else if (r[7] > 0) { propAdd(db, pl.uid, pl.server_id, r[7], n); props.push({ id: r[7], num: n }); }
  else if (r[10] > 0) cash = r[10] * n;
  else if (r[11] > 0) coin = r[11] * n;
  else if (r[8] > 0) { propAdd(db, pl.uid, pl.server_id, CHIP_BASE + r[8], n); chips = n; }
  else if (r[9] > 0) { soul = r[9] * n; propAdd(db, pl.uid, pl.server_id, SOUL, soul); }
  else if (r[14] > 0) for (let i = 0; i < n; i++) require('./pet').addPet(db, pl.uid, pl.server_id, r[14]); // pet (shown in the pet screens)
  else if (r[5] > 0 || r[6] > 0) coin = 20000 * n; // ninjutsu / seal cards are not modelled yet
  if (coin || cash) db.prepare('UPDATE players SET coin=coin+?, gold=gold+? WHERE uid=? AND server_id=?').run(coin, cash, pl.uid, pl.server_id);
  const cardXml = cards.map((c) => '<card>' + el('id', c.id) + el('type', c.type) + el('num', 1) + el('attri', 0) + el('bagIndex', c.seq) + el('level', 1) + el('newlife', 0) + el('starlevel', 0) + '</card>').join('');
  const propXml = props.map((x) => '<prop>' + el('id', x.id) + el('num', x.num) + '</prop>').join('');
  // Lua award screens count one fragment per <chipitem>, so repeat it n times with num="1".
  const chipXml = `<chipitem id="${r[8]}" num="1"/>`.repeat(chips);
  return `<award dropid="${dropId}" coin="${coin}"><cardlist>${cardXml}</cardlist><proplist>${propXml}</proplist><chipbag>${chipXml}</chipbag>` +
    `${el('coin', coin)}${el('cash', cash)}<exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action>${el('soul', soul)}</award>`;
}
// One <award> holding several grantDrop results (Lua screens read only the first <award>).
function mergeAwards(list) {
  const pick = (re) => list.map((a) => (a.match(re) || ['', ''])[1]).join('');
  const sum = (tag) => list.reduce((s, a) => s + Number((a.match(new RegExp(`<${tag}>(\\d+)</${tag}>`)) || [0, 0])[1]), 0);
  const coin = sum('coin');
  return `<award dropid="${list.length ? (list[0].match(/dropid="(\d+)"/) || [0, 1])[1] : 1}" coin="${coin}"><cardlist>${pick(/<cardlist>(.*?)<\/cardlist>/)}</cardlist>` +
    `<proplist>${pick(/<proplist>(.*?)<\/proplist>/)}</proplist><chipbag>${pick(/<chipbag>(.*?)<\/chipbag>/)}</chipbag>${el('coin', coin)}${el('cash', sum('cash'))}` +
    '<exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award>';
}
// Cmd 1900 (one pull): <recruit .../> attributes + <award>. Cmd 1901 (ten pulls): <recruit_list> of exactly 10 <item><award>.
function pullXml(res, count) {
  if (count === 1) {
    const c = res.got[0];
    return `<recruit ninjaid="${c.ninja}" cost="${res.cost}" bagid="${c.seq}" attr="0" costprop="0"/>` + awardXml(c); // <award> is a SIBLING of <recruit> (children of the root)
  }
  return '<recruit_list>' + res.got.map((c) => '<item>' + awardXml(c) + '</item>').join('') + '</recruit_list>';
}


// ---- Training battles -----------------------------------------------------------------------
// The client replays whatever fight we describe: <fight><preview/><guard>(enemies)<killer>(my team)<roundlist>.
function ninjaXml(n) {
  const f = { id: n.id, bagid: n.bagid, low: n.low, high: n.high, end: n.end, level: n.level, attri: 0, starlevel: n.star, newlife: 0 };
  return '<ninja>' + Object.entries(f).map(([k, v]) => el(k, v)).join('') + '</ninja>';
}
function battleXml(db, pl, chap, stage, opt = {}) {
  const team = db.prepare('SELECT t.slot, c.seq, c.ninja_id, c.level, c.starlevel FROM team t JOIN cards c ON c.seq=t.seq WHERE t.uid=? AND t.server_id=? ORDER BY t.slot').all(pl.uid, pl.server_id);
  const ts = teamStats(db, pl.uid, pl.server_id);
  const mine = team.map((t, i) => { const q = ts.slots[i] || {}; return { id: t.ninja_id, bagid: t.seq, low: q.al || 40, high: q.ah || 60, end: Math.round(((q.dl || 0) + (q.dh || 0)) * 2 + 300), level: t.level, star: t.starlevel }; });
  const foes = (opt.enemyIds || [21, 22, 23]).map((id, i) => ({ id, bagid: 1000 + i, low: 10, high: 20, end: 60 + stage * 10, level: opt.enemyLevel || 1, star: 0 }));
  const rounds = [];
  foes.forEach((foe, i) => {
    const me = mine[i % mine.length];
    rounds.push({ AttackNinja: me.bagid, Attack: me.high, AttackAttri: 0, DefenseNinja: foe.bagid, Defense: 0, DefenseAttri: 0,
      CauseLimit: 0, LimitVal: 0, FinalAttack: me.high, FinalDefense: 0, AttPetAttack: 0, AttPetDefense: 0, DefPetAttack: 0, DefPetDefense: 0,
      AttPetSkillHurt: 0, DefpetSkillHurt: 0, AttGateAttack: 0, AttGateDefense: 0, DefGateAttack: 0, DefGateDefense: 0 });
  });
  const roundXml = rounds.map((r) => '<round>' + Object.entries(r).map(([k, v]) => el(k, v)).join('') + '<skills></skills><defense_skills></defense_skills></round>').join('');
  const win = opt.win === false ? 0 : 1;
  const nick = (opt.enemyName || 'Enemy').replace(/[<>&"]/g, '');
  return `<fight><preview type="0" result="${win}" defensenick="${nick}" defenseuid="${opt.enemyUid || 0}" defensecountry="1" defenselevel="${opt.enemyLevel || 1}" defenseviplevel="0"/>` +
    '<guard><ninjalist>' + foes.map(ninjaXml).join('') + '</ninjalist></guard>' +
    '<killer><ninjalist>' + mine.map(ninjaXml).join('') + '</ninjalist>' +
    `<master_pet>${el('pet_id', require('./pet').masterPetId(db, pl.uid, pl.server_id))}</master_pet></killer>` +
    '<roundlist>' + roundXml + '</roundlist></fight>';
}

// Spar fight against rival ToUid (a real player or a bot). Strength = level + stars of the team; a little luck.
function sparFight(db, pl, toUid) {
  const rv = rivals(db, pl, 12).find((r) => r.id === toUid) || { id: toUid, level: pl.level, nick: 'Rival', ninja: 5 };
  const botAtk = (lv, star) => 150 + lv * 55 + star * 60;
  const ts = teamStats(db, pl.uid, pl.server_id);
  const mine = (ts.total.al + ts.total.ah) / 2 / Math.max(1, ts.slots.length);
  let theirs;
  if (rv.id < 9000000) { const o = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(rv.id, pl.server_id); const t2 = o ? teamStats(db, o.uid, o.server_id) : null; theirs = t2 ? (t2.total.al + t2.total.ah) / 2 / Math.max(1, t2.slots.length) : botAtk(rv.level, 3); }
  else theirs = botAtk(rv.level, rv.star || 3);
  const win = mine * (0.7 + Math.random() * 0.6) >= theirs;
  const xml = battleXml(db, pl, 0, 1, { enemyIds: [rv.ninja, rv.ninja, rv.ninja], enemyName: rv.nick, enemyUid: rv.id, enemyLevel: rv.level, win });
  const coin = win ? 3 + rv.level : 0, exp = win ? 14 : 2;
  return { win, xml, coin, exp };
}

// Player exp -> level (playerlevel.dbf col 2 = exp needed to leave that level).
function addExp(db, pl, exp) {
  const rows = table('playerlevel').rows;
  let level = pl.level, cur = (pl.exp || 0) + exp;
  for (;;) {
    const r = rows.find((x) => x[1] === level);
    if (!r || cur < r[2]) break;
    cur -= r[2]; level++;
  }
  db.prepare('UPDATE players SET level=?, exp=? WHERE uid=? AND server_id=?').run(level, cur, pl.uid, pl.server_id);
  return level;
}

// ---- Daily tasks -----------------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
const DAILY_AWARDS = [ // id, points needed, reward
  { id: 1, cost: 20, coin: 5000, cash: 0 }, { id: 2, cost: 40, coin: 0, cash: 20 }, { id: 3, cost: 60, coin: 10000, cash: 0 },
  { id: 4, cost: 80, coin: 0, cash: 50 }, { id: 5, cost: 100, coin: 0, cash: 100 },
];
function dailyEnsure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS dailytask (uid INTEGER, server_id INTEGER, day TEXT, task_id INTEGER, process INTEGER DEFAULT 0, PRIMARY KEY(uid,server_id,day,task_id));
    CREATE TABLE IF NOT EXISTS dailyaward (uid INTEGER, server_id INTEGER, day TEXT, award_id INTEGER, PRIMARY KEY(uid,server_id,day,award_id));`);
}
const dailyRows = () => table('dailytask_info').rows.filter((r) => r[7] === 1 && r[0] <= 21);
function bumpTask(db, uid, sid, taskId, n = 1) {
  dailyEnsure(db);
  db.prepare('INSERT INTO dailytask(uid,server_id,day,task_id,process) VALUES(?,?,?,?,?) ON CONFLICT(uid,server_id,day,task_id) DO UPDATE SET process=process+excluded.process').run(uid, sid, today(), taskId, n);
}
function dailyXml(db, uid, sid) {
  dailyEnsure(db);
  const done = Object.fromEntries(db.prepare('SELECT task_id, process FROM dailytask WHERE uid=? AND server_id=? AND day=?').all(uid, sid, today()).map((r) => [r.task_id, r.process]));
  const claimed = new Set(db.prepare('SELECT award_id FROM dailyaward WHERE uid=? AND server_id=? AND day=?').all(uid, sid, today()).map((r) => r.award_id));
  let score = 0;
  const tasks = dailyRows().map((r) => {
    const p = Math.min(done[r[0]] || 0, r[5]);
    if (p >= r[5]) score += r[6];
    return `<task id="${r[0]}" process="${p}"/>`;
  }).join('');
  score = Math.min(score, 100);
  const awards = DAILY_AWARDS.map((a) => `<award id="${a.id}" status="${claimed.has(a.id) ? 2 : score >= a.cost ? 1 : 0}" cost="${a.cost}"><drop_list></drop_list></award>`).join('');
  return `<player><total>100</total><current>${score}</current></player><task_list>${tasks}</task_list><award_list>${awards}</award_list>`;
}
function dailyClaim(db, pl, awardId) {
  dailyEnsure(db);
  const a = DAILY_AWARDS.find((x) => x.id === awardId);
  if (!a) return null;
  db.prepare('INSERT OR IGNORE INTO dailyaward(uid,server_id,day,award_id) VALUES(?,?,?,?)').run(pl.uid, pl.server_id, today(), awardId);
  db.prepare('UPDATE players SET coin=coin+?, gold=gold+? WHERE uid=? AND server_id=?').run(a.coin, a.cash, pl.uid, pl.server_id);
  return a;
}
// Complete <award> element (Lua requires every child to exist).
function awardFull({ coin = 0, cash = 0, exp = 0 } = {}) {
  return `<award dropid="0" coin="${coin}"><coin>${coin}</coin><cash>${cash}</cash><exp>${exp}</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award>`;
}

// ---- Spar / rivals --------------------------------------------------------------------------
const BOT_NAMES = ['Iron Fist Lee', 'Shadow Hana', 'Rogue Kaito', 'Silent Ren', 'Blaze Mika', 'Sand Gaku', 'Mist Yuna', 'Thunder Ryo', 'Frost Aoi', 'Wind Sora'];
// Rival list: other real players first (friends on the same server), then bots near the player's level.
function rivals(db, pl, count = 8) {
  const real = db.prepare('SELECT * FROM players WHERE server_id=? AND uid!=? ORDER BY ABS(level-?) LIMIT ?').all(pl.server_id, pl.uid, pl.level, count);
  const out = real.map((r) => ({ id: r.uid, level: r.level, nick: r.nick, country: r.country, ninja: firstNinja(db, r) }));
  const pool = Array.from(ninjas().values()).filter((r) => r[4] === 1);
  for (let i = 0; out.length < count; i++) {
    const n = pool[(pl.level * 7 + i * 13) % pool.length];
    out.push({ id: 9000001 + i, level: Math.max(1, pl.level + (i % 5) - 2), nick: BOT_NAMES[i % BOT_NAMES.length], country: 1 + (i % 3), ninja: n[0], star: n[11] });
  }
  return out;
}
function firstNinja(db, p) {
  const c = db.prepare('SELECT ninja_id FROM cards WHERE uid=? AND server_id=? ORDER BY starlevel DESC, seq LIMIT 1').get(p.uid, p.server_id);
  return c ? c.ninja_id : 5;
}
function rivalsXml(db, pl) {
  const f = (r) => {
    const lv = r.level, a = 20 + lv * 12;
    const o = { id: r.id, level: lv, nick: r.nick, attacklow: a, attackhigh: a + 20, defenselow: Math.floor(a / 2), defenseHigh: Math.floor(a / 2) + 10,
      chakralow: a, chakrahigh: a + 20, firstninja: r.ninja, firstninjastar: r.star || 3, newlife: 0, country: r.country, coin: 100 + lv * 20 };
    return '<user>' + Object.entries(o).map(([k, v]) => el(k, v)).join('') + '</user>';
  };
  return '<userlist page="1" addrate="0" resttime="0">' + rivals(db, pl).map(f).join('') + '</userlist>';
}

// ---- Event packs (login days / level-up gifts) ------------------------------------------------
function actEnsure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS actclaim (uid INTEGER, server_id INTEGER, actid INTEGER, subid INTEGER, PRIMARY KEY(uid,server_id,actid,subid))');
}
function actClaimable(db, pl) {
  actEnsure(db);
  const P = table('activity_packs');
  const days = Math.max(1, Math.min(30, Math.floor((Date.now() - (pl.created || Date.now())) / 86400000) + 1));
  const done = (a) => new Set(db.prepare('SELECT subid FROM actclaim WHERE uid=? AND server_id=? AND actid=?').all(pl.uid, pl.server_id, a).map((r) => r.subid));
  const d1 = done(1), d2 = done(2);
  const login = [], up = [];
  for (let i = 1; i <= Math.min(days, P.login_q.length); i++) if (!d1.has(i)) login.push(i);
  P.upgrade_levels.forEach((l, k) => { if (pl.level >= l && !d2.has(k + 1)) up.push(k + 1); });
  return { days, login, up };
}
function actXml(db, pl) {
  const c = actClaimable(db, pl);
  const subs = (a) => a.map((i) => `<subitem subid="${i}"></subitem>`).join('');
  return `<activity type="1" loginallnum="${c.days}"><item actid="1">${subs(c.login)}</item></activity>` +
    `<activity type="2"><item actid="2">${subs(c.up)}</item></activity><activity type="3"><item actid="3" pos="-1"></item></activity><activity type="4"><item actid="4"></item></activity>` +
    '<conf><items>' + [[1, 1, 2], [2, 2, 2], [41, 3, 2], [20, 4, 1], [21, 5, 1], [12, 6, 2], [24, 7, 1], [47, 8, 2]].map(([id, pos, type]) => `<item><id>${id}</id><pos>${pos}</pos><status>1</status><onoff>1</onoff><type>${type}</type></item>`).join('') + '</items><xiaoopen>1</xiaoopen><gambletype>1</gambletype></conf>';
}
function actClaim(db, pl, actid, subid) {
  const c = actClaimable(db, pl);
  const ok = (actid === 1 ? c.login : actid === 2 ? c.up : []).includes(subid);
  if (!ok) return null;
  const P = table('activity_packs');
  db.prepare('INSERT OR IGNORE INTO actclaim(uid,server_id,actid,subid) VALUES(?,?,?,?)').run(pl.uid, pl.server_id, actid, subid);
  const coin = (actid === 1 ? P.login_q : P.upgrade_q)[subid - 1] || 1000, cash = 20 + subid * 5;
  db.prepare('UPDATE players SET coin=coin+?, gold=gold+? WHERE uid=? AND server_id=?').run(coin, cash, pl.uid, pl.server_id);
  return { coin, cash };
}

// ---- Consumables / shop ---------------------------------------------------------------------
function propEnsure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS props (uid INTEGER, server_id INTEGER, prop_id INTEGER, count INTEGER DEFAULT 0, PRIMARY KEY(uid,server_id,prop_id))');
}
function propCounts(db, uid, sid) {
  propEnsure(db);
  return Object.fromEntries(db.prepare('SELECT prop_id, count FROM props WHERE uid=? AND server_id=?').all(uid, sid).map((r) => [r.prop_id, r.count]));
}
function propAdd(db, uid, sid, id, n) {
  propEnsure(db);
  db.prepare('INSERT INTO props(uid,server_id,prop_id,count) VALUES(?,?,?,?) ON CONFLICT(uid,server_id,prop_id) DO UPDATE SET count=MAX(0,count+excluded.count)').run(uid, sid, id, n);
}
// Buy: kind 'good' (consumeinfo) or 'pack' (giftinfo, opened immediately for coins/gold).
function shopBuy(db, pl, goodsId, count) {
  const row = table('consumeinfo').rows.find((r) => r[1] === goodsId);
  if (!row) return { error: 'no such item' };
  const costG = row[4] * count, costS = row[5] * count;
  if (pl.gold < costG || pl.coin < costS) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-?, coin=coin-? WHERE uid=? AND server_id=?').run(costG, costS, pl.uid, pl.server_id);
  propAdd(db, pl.uid, pl.server_id, goodsId, count);
  bumpTask(db, pl.uid, pl.server_id, 18);
  return { costG, costS };
}

// Use a consumable. Effects: type 3 = silver, type 1 = energy; other types are only consumed.
function propUse(db, pl, goodsId) {
  const row = table('consumeinfo').rows.find((r) => r[1] === goodsId);
  const have = propCounts(db, pl.uid, pl.server_id)[goodsId] || 0;
  if (!row || have < 1) return { error: 'none left' };
  propAdd(db, pl.uid, pl.server_id, goodsId, -1);
  let coin = 0, ap = 0;
  if (row[7] === 3) { coin = Math.round(row[8]); db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, pl.server_id); }
  if (row[7] === 1) { ap = Math.round(row[8]); db.prepare('UPDATE players SET energy=energy+? WHERE uid=? AND server_id=?').run(ap, pl.uid, pl.server_id); }
  const now = db.prepare('SELECT energy, coin FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  return { ap, coin, left: have - 1 }; // deltas: the client adds them to its own totals
}

// Gift packs: only packs whose drop row gives ninja cards work (equipment/ninjutsu cards are not implemented yet).
function packBuy(db, pl, packId) {
  const g = table('giftinfo').rows.find((r) => r[0] === packId);
  if (!g) return { error: 'no such pack' };
  const drop = table('dropinfo').rows.find((r) => r[0] === Math.round(g[8]));
  if (!drop) return { error: 'this pack is not available on the revival server yet' };
  const name = String(g[2]).toLowerCase();
  const costG = g[4], costS = g[5];
  if (pl.gold < costG || pl.coin < costS) return { error: 'not enough gold' };
  let give; // () => [type, id, seq]
  if (drop[3] && ninjas().has(drop[3])) give = () => [1, drop[3], giveCard(db, pl.uid, pl.server_id, drop[3])];
  else if (drop[4] && equipRows().some((r) => r[0] === drop[4] && r[5] === 3)) give = () => [2, drop[4], giveEquip(db, pl.uid, pl.server_id, drop[4])];
  else if (/weapon|armor|trinket/.test(name)) {
    const slot = /weapon/.test(name) ? 0 : /armor/.test(name) ? 1 : 2;
    const minStar = /4☆/.test(name) ? 3 : 2;
    give = () => { const id = randomEquip(slot, minStar); return [SLOT_TYPE[slot], id, giveEquip(db, pl.uid, pl.server_id, id)]; };
  } else return { error: 'this pack is not available on the revival server yet' };
  db.prepare('UPDATE players SET gold=gold-?, coin=coin-? WHERE uid=? AND server_id=?').run(costG, costS, pl.uid, pl.server_id);
  const n = Math.max(1, drop[13] || 1);
  let first = null; const seqs = [];
  for (let i = 0; i < n; i++) { const r = give(); if (!first) first = r; seqs.push(r[2]); }
  return { costG, costS, type: first[0], ninja: first[1], n, seq: seqs.join('|'), attrs: seqs.map(() => 0).join('|') };
}

// Card level-up: eat material cards (75 exp each), cost 2 silver per exp. Level thresholds = ninjaupgrade col 2.
function strengthen(db, pl, srcSeq, eatSeqs) {
  const src = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=?').get(srcSeq, pl.uid, pl.server_id);
  if (!src) return { error: 'card not found' };
  const eat = eatSeqs.filter((q) => q !== srcSeq && !db.prepare('SELECT 1 FROM team WHERE seq=?').get(q))
    .map((q) => db.prepare('SELECT seq FROM cards WHERE seq=? AND uid=? AND server_id=?').get(q, pl.uid, pl.server_id)).filter(Boolean);
  const exp = eat.length * 75, cost = exp * 2;
  if (pl.coin < cost) return { error: 'not enough silver' };
  const rows = table('ninjaupgrade').rows;
  let level = src.level, cur = src.exp + exp;
  for (;;) { const r = rows.find((x) => x[1] === level); if (!r || level >= Math.min(pl.level * 2 + 10, 99) || cur < r[2]) break; cur -= r[2]; level++; }
  db.prepare('UPDATE players SET coin=coin-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  db.prepare('UPDATE cards SET level=?, exp=? WHERE seq=?').run(level, cur, srcSeq);
  for (const e of eat) db.prepare('DELETE FROM cards WHERE seq=?').run(e.seq);
  bumpTask(db, pl.uid, pl.server_id, 20);
  return { exp, cost };
}

// ---- Reincarnation / equipment advance (rl_w_newlife Cmd 7): ReadyCard gains +1 grade, EatCard (same item id) is consumed.
const NEWLIFE_MAX = (type) => (type === 1 ? 6 : table('equipnewlifeprop').rows.length);
const NEWLIFE_COST = (grade) => 5000 * grade;
function newlife(db, pl, readySeq, eatSeq, grade) {
  ensure(db);
  const a = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=?').get(readySeq, pl.uid, pl.server_id);
  const b = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=?').get(eatSeq, pl.uid, pl.server_id);
  if (!a) return { error: 'cards missing' };
  // The material is either another copy of the same card (consumed) or a reincarnation pill (free on this server).
  if (b) {
    if (a.seq === b.seq || a.type !== b.type || a.ninja_id !== b.ninja_id) return { error: 'cards must match' };
    if (db.prepare('SELECT 1 FROM team WHERE seq=?').get(b.seq) || db.prepare('SELECT 1 FROM equipped WHERE seq=?').get(b.seq)) return { error: 'material card is in use' };
  }
  const next = Math.min(NEWLIFE_MAX(a.type), (a.newlife || 0) + 1);
  const cost = NEWLIFE_COST(next);
  if (pl.coin < cost) return { error: 'not enough silver' };
  db.prepare('UPDATE players SET coin=coin-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  db.prepare('UPDATE cards SET newlife=?, level=1, exp=0 WHERE seq=?').run(next, a.seq);
  if (b) db.prepare('DELETE FROM cards WHERE seq=?').run(b.seq);
  else if (propCounts(db, pl.uid, pl.server_id)[11] > 0) propAdd(db, pl.uid, pl.server_id, 11, -Math.min(80, propCounts(db, pl.uid, pl.server_id)[11]));
  const gain = Math.round(((ninjaStats({ ...a, newlife: next }).ah) - ninjaStats(a).ah) / 2) || 0;
  return { grade: next, cost, gain };
}

// ---- Potential training ("Train" screen, rl_x_develop): roll gains, then save them. Free here (no pills needed).
const potLimit = (c) => 100 + 40 * (c.starlevel || 0) + 10 * (c.level || 1) + 100 * (c.newlife || 0);
function potentialXml(db, pl, seq) {
  const c = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=?').get(seq, pl.uid, pl.server_id);
  if (!c) return null;
  const lim = potLimit(c);
  return `<attack limit_att="${lim}" add_att="${c.pot_att}"/><defense limit_def="${lim}" add_def="${c.pot_def}"/><chakra limit_ckr="${lim}" add_ckr="${c.pot_ckr}"/>` +
    '<cost_list><cost cost_id="1" name="Training pill" type="1" need_miyao="0" need_golden="0"/><cost cost_id="2" name="Gold training" type="2" need_miyao="0" need_golden="0"/></cost_list>';
}
function potentialRoll(db, pl, seq, costId) {
  const c = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=?').get(seq, pl.uid, pl.server_id);
  if (!c) return { error: 'no such card' };
  const lim = potLimit(c), hi = costId === 2 ? 14 : 8, lo = costId === 2 ? 3 : -2;
  const roll = () => Math.floor(Math.random() * (hi - lo + 1)) + lo;
  const d = { att: roll(), def: roll(), ckr: roll() };
  // never push a stat outside 0..limit
  d.att = Math.max(-c.pot_att, Math.min(lim - c.pot_att, d.att)); d.def = Math.max(-c.pot_def, Math.min(lim - c.pot_def, d.def)); d.ckr = Math.max(-c.pot_ckr, Math.min(lim - c.pot_ckr, d.ckr));
  db.prepare('UPDATE cards SET pend_att=?, pend_def=?, pend_ckr=? WHERE seq=?').run(d.att, d.def, d.ckr, seq);
  return d;
}
function potentialSave(db, pl, seq) {
  const c = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=?').get(seq, pl.uid, pl.server_id);
  if (!c) return false;
  db.prepare('UPDATE cards SET pot_att=pot_att+pend_att, pot_def=pot_def+pend_def, pot_ckr=pot_ckr+pend_ckr, pend_att=0, pend_def=0, pend_ckr=0 WHERE seq=?').run(seq);
  return true;
}

// ---- Secret (soul) shop ----------------------------------------------------------------------
const SOUL = 9999; // props id used for ninja souls
function soulOf(db, pl) {
  const c = propCounts(db, pl.uid, pl.server_id);
  if (c[SOUL] === undefined) { propAdd(db, pl.uid, pl.server_id, SOUL, 30000); return 30000; } // starter souls for the offline server
  return c[SOUL];
}
// Mystery shop (secret_shop rows: [id, id, name, type, subtype, itemid, num, costtype, cost, weight, dropid]): 6 rows a day
// picked by weight from everything the original sold - ninjas, ninja fragments, pet fragments, grain, nostrum, sage stones,
// reincarnation pills. Each row can be bought once per day.
function secretPicks(pl) {
  // rows 233-241 are untranslated duplicates from the Chinese server
  const rows = table('secret_shop').rows.filter((r) => r[9] > 0 && r[10] > 0 && /^[ -~]*$/.test(r[2]));
  const day = Math.floor(Date.now() / 86400000), picks = [];
  let seed = (pl.uid * 31 + day + (pl.shopseed || 0)) >>> 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const total = rows.reduce((a, r) => a + r[9], 0);
  for (let guard = 0; picks.length < 6 && guard < 500; guard++) {
    let x = rnd() * total;
    const r = rows.find((q) => (x -= q[9]) < 0) || rows[rows.length - 1];
    if (!picks.includes(r)) picks.push(r);
  }
  return picks;
}
function secretBought(db, pl) {
  db.exec('CREATE TABLE IF NOT EXISTS secret_bought (uid INTEGER, server_id INTEGER, day INTEGER, row INTEGER, PRIMARY KEY(uid, server_id, day, row))');
  const day = Math.floor(Date.now() / 86400000);
  return new Set(db.prepare('SELECT row FROM secret_bought WHERE uid=? AND server_id=? AND day=?').all(pl.uid, pl.server_id, day).map((r) => r.row));
}
function secretXml(db, pl) {
  const soul = soulOf(db, pl), bought = secretBought(db, pl);
  const esc = (t) => String(t).replace(/[<>&]/g, '');
  const cards = secretPicks(pl).map((r) => `<item><card>${el('id', r[0])}${el('type', r[3])}${el('subtype', r[4])}${el('name', esc(r[2]))}${el('icon', r[5])}${el('num', r[6])}${el('cost', r[8])}${el('costtype', r[7])}${el('status', bought.has(r[0]) ? 1 : 0)}${el('itemid', r[5])}${el('attacktype', 0)}</card></item>`).join('');
  return `<user>${el('cursoul', soul)}${el('updatenum', 99)}${el('gold', pl.gold)}${el('refreshcost', 0)}${el('totalrefresh', 99)}${el('dayrefreshleft', 99)}${el('lefttime', 86400 - Math.floor(Date.now() / 1000) % 86400)}</user><cardlist>${cards}</cardlist>`;
}
function secretBuy(db, pl, rowId) {
  const r = secretPicks(pl).find((x) => x[0] === rowId);
  if (!r) return { error: 'not in shop' };
  if (secretBought(db, pl).has(r[0])) return { error: 'already bought today' };
  if (r[7] === 1) { if (soulOf(db, pl) < r[8]) return { error: 'not enough souls' }; propAdd(db, pl.uid, pl.server_id, SOUL, -r[8]); }
  else { if (pl.gold < r[8]) return { error: 'not enough gold' }; db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(r[8], pl.uid, pl.server_id); }
  db.prepare('INSERT INTO secret_bought VALUES(?,?,?,?)').run(pl.uid, pl.server_id, Math.floor(Date.now() / 86400000), r[0]);
  return { xml: grantDrop(db, pl, r[10]) };
}

// ---- Stats: ninja level growth + gear + set bonuses ------------------------------------------
// ninjainfo cols 19-24 = base atk lo/hi, def lo/hi, chakra lo/hi; 25-30 = growth per level. equipmentinfo: 7-12 base, 13-18 growth.
const KEYS = ['al', 'ah', 'dl', 'dh', 'cl', 'ch'];
function ninjaStats(card) {
  const n = ninjas().get(card.ninja_id);
  const o = {};
  const mult = 1 + 0.05 * (card.starlevel || 0) + 0.1 * (card.newlife || 0); // sage growth +5% per level, reincarnation +10% per grade
  // god breakthrough: +4% per level, only on the stats of the card's element (ui_tupo_desc): fire ATK+chakra, water chakra,
  // wind DEF+chakra, earth DEF, thunder ATK. Element = cards.attri (1 water, 2 fire, 3 wind, 4 earth, 5 thunder; 0 shows as water).
  const BREAK = { 1: 'c', 2: 'ac', 3: 'dc', 4: 'd', 5: 'a' }[card.attri || 1] || 'c';
  const bk = (k) => (BREAK.includes(k[0]) ? 0.04 * (card.breaklvl || 0) : 0);
  KEYS.forEach((k, i) => { o[k] = n ? Math.round(((n[19 + i] || 0) + (n[25 + i] || 0) * (card.level - 1)) * (mult + bk(k))) : 0; });
  const pot = [card.pot_att, card.pot_att, card.pot_def, card.pot_def, card.pot_ckr, card.pot_ckr];
  KEYS.forEach((k, i) => { o[k] += pot[i] || 0; });
  return o;
}
function equipStats(card) {
  const e = equipRows().find((r) => r[0] === card.ninja_id);
  const o = {};
  const row = table('equipnewlifeprop').rows.find((r) => r[0] === (card.newlife || 0));
  const mult = 1 + (row ? row[4] : 0); // reincarnation grade grows the whole stat block
  KEYS.forEach((k, i) => { o[k] = e ? Math.round(((e[7 + i] || 0) + (e[13 + i] || 0) * (card.level - 1)) * mult) : 0; });
  return o;
}
const addStats = (a, b) => { const o = {}; KEYS.forEach((k) => { o[k] = (a[k] || 0) + (b[k] || 0); }); return o; };
// Set bonuses: type 1 = N cards of >= X stars, type 2 = N cards of level >= X (counted over all owned ninja cards).
function activeSuits(db, uid, sid) {
  const cards = db.prepare('SELECT ninja_id, level FROM cards WHERE uid=? AND server_id=? AND type=1').all(uid, sid);
  const best = {};
  for (const r of table('suit_info').rows) {
    const [, , type, need, count] = r;
    const have = cards.filter((c) => (type === 1 ? ((ninjas().get(c.ninja_id) || [])[11] || 0) >= need : c.level >= need)).length;
    if (have >= count && (!best[type] || count > best[type][4])) best[type] = r;
  }
  return Object.values(best);
}
// Seal (markinfo col 7, e.g. "ATK +35%"): multiplies that stat of the ninja wearing it.
function sealBonus(st, markId) {
  const m = table('markinfo').rows.find((r) => r[0] === markId);
  const mm = m && /(ATK|DEF|CHA\w*)\s*\+(\d+)%/i.exec(String(m[7]));
  if (!mm) return st;
  const pct = Number(mm[2]) / 100, keys = /ATK/i.test(mm[1]) ? ['al', 'ah'] : /DEF/i.test(mm[1]) ? ['dl', 'dh'] : ['cl', 'ch'];
  const o = { ...st };
  for (const k of keys) o[k] = Math.round(o[k] * (1 + pct));
  return o;
}
function teamStats(db, uid, sid) {
  ensure(db);
  const team = db.prepare('SELECT t.slot, c.* FROM team t JOIN cards c ON c.seq=t.seq WHERE t.uid=? AND t.server_id=? ORDER BY t.slot').all(uid, sid);
  const eqRows = db.prepare('SELECT e.slot, e.kind, c.* FROM equipped e JOIN cards c ON c.seq=e.seq WHERE e.uid=? AND e.server_id=?').all(uid, sid);
  const slots = team.map((c, i) => {
    let st = ninjaStats(c);
    for (const e of eqRows.filter((x) => x.slot === i + 1)) {
      if (e.type === 5) { st = sealBonus(st, e.ninja_id); continue; } // tailed-beast seal: percentage bonus
      st = addStats(st, equipStats(e));
    }
    return { seq: c.seq, ninja_id: c.ninja_id, level: c.level, ...st };
  });
  let tot = slots.reduce((a, s) => addStats(a, s), {});
  const suits = activeSuits(db, uid, sid);
  let bonus = {};
  for (const r of suits) {
    bonus = addStats(bonus, { al: r[5], ah: r[5], dl: r[7], dh: r[7], cl: r[9], ch: r[9] });
    const pct = { al: r[6], ah: r[6], dl: r[8], dh: r[8], cl: r[10], ch: r[10] };
    KEYS.forEach((k) => { bonus[k] += Math.round((tot[k] || 0) * pct[k]); });
  }
  tot = addStats(tot, bonus);
  const gb = gateBonus(gateLevel(db, uid, sid));
  if (gb.flat) { const g = {}; KEYS.forEach((k) => { g[k] = gb.flat + Math.round((tot[k] || 0) * gb.pct); }); tot = addStats(tot, g); }
  const pb = require('./pet').teamBonus(db, uid, sid); // master + helper pets (required here: pet.js requires this file)
  tot = addStats(tot, { al: pb.attack, ah: pb.attack, dl: pb.defense, dh: pb.defense, cl: pb.chakala, ch: pb.chakala });
  return { slots, total: tot, suits, bonus };
}

// Sage growth (rl_w_star Cmd 1): spend sage stones on a card for a chance at +1 sage level (stored in cards.starlevel).
function sageGrow(db, pl, seq, stoneId, stoneNum) {
  const card = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=? AND type=1').get(seq, pl.uid, pl.server_id);
  if (!card) return { error: 'card not found' };
  const have = propCounts(db, pl.uid, pl.server_id)[stoneId] || 0;
  stoneNum = Math.max(1, stoneNum);
  if (have < stoneNum) return { error: 'not enough stones' };
  const cost = 50 * (card.starlevel + 1);
  if (pl.coin < cost) return { error: 'not enough silver' };
  propAdd(db, pl.uid, pl.server_id, stoneId, -stoneNum);
  db.prepare('UPDATE players SET coin=coin-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  const chance = Math.min(100, Math.max(30, 100 - card.starlevel * 4) + (stoneId === 8 ? 10 : 0) + (stoneNum - 1) * 5);
  const win = Math.random() * 100 < chance;
  let lv = card.starlevel, drop = 0;
  if (win) lv++;
  else if (lv > 0) { const floor = Math.floor(lv / 3) * 3; if (lv > floor) { lv = Math.max(floor, lv - 1); drop = 1; } }
  db.prepare('UPDATE cards SET starlevel=? WHERE seq=?').run(lv, seq);
  bumpTask(db, pl.uid, pl.server_id, 5);
  return { win, drop, lv, left: have - stoneNum };
}

// Friends: on this offline server every other registered player is automatically your friend.
function friendsXml(db, pl, nick) {
  const real = nick
    ? db.prepare('SELECT * FROM players WHERE server_id=? AND uid!=? AND nick LIKE ? ORDER BY level DESC').all(pl.server_id, pl.uid, '%' + nick + '%')
    : db.prepare('SELECT * FROM players WHERE server_id=? AND uid!=? ORDER BY level DESC').all(pl.server_id, pl.uid);
  const f = (r) => {
    const t = teamStats(db, r.uid, r.server_id);
    const o = { id: r.uid, level: r.level, nick: String(r.nick).replace(/[<>&"]/g, ''), attacklow: t.total.al, attackhigh: t.total.ah, defenselow: t.total.dl, defenseHigh: t.total.dh,
      firstninja: firstNinja(db, r), country: r.country, firstninjastar: 5, newlife: 0 };
    return '<user>' + Object.entries(o).map(([k, v]) => el(k, v)).join('') + '</user>';
  };
  return '<userlist page="1">' + real.map(f).join('') + '</userlist>';
}

// ---- Eight Inner Gates (Dun) -----------------------------------------------------------------
// gate level 0-8 per player; each gate costs souls (prop 9998) + silver; bonus = flat + percent on the team total.
const GATE_SOUL = 9998;
function gateLevel(db, uid, sid) { return Math.min(8, propCounts(db, uid, sid)[9997] || 0); }
function gateBonus(lv) { return { flat: 120 * lv, pct: 0.02 * lv }; }
function gateXml(db, pl) {
  const c = propCounts(db, pl.uid, pl.server_id);
  if (c[GATE_SOUL] === undefined) { propAdd(db, pl.uid, pl.server_id, GATE_SOUL, 5000); c[GATE_SOUL] = 5000; }
  const lv = gateLevel(db, pl.uid, pl.server_id), b = gateBonus(lv), nx = gateBonus(Math.min(8, lv + 1));
  const kinds = [1, 2, 3].map((t) => `<gate type="${t}" value="${nx.flat - b.flat}"/>`).join('');
  return `<basic>${el('soul', c[GATE_SOUL])}${el('gate_level', lv)}${el('cost_soul', 100 * (lv + 1))}${el('cost_coin', 1000 * (lv + 1))}<gate_id id="${Math.min(8, lv + 1)}">${kinds}</gate_id></basic>` +
    `<attribute>${el('add_attack', b.flat)}${el('add_defense', b.flat)}${el('add_chakala', b.flat)}${el('add_attack_per', Math.round(b.pct * 100))}${el('add_defense_per', Math.round(b.pct * 100))}${el('add_chakala_per', Math.round(b.pct * 100))}</attribute>`;
}
function gateOpen(db, pl) {
  const lv = gateLevel(db, pl.uid, pl.server_id);
  if (lv >= 8) return { error: 'all gates open' };
  const c = propCounts(db, pl.uid, pl.server_id), soul = c[GATE_SOUL] === undefined ? 5000 : c[GATE_SOUL];
  if (soul < 100 * (lv + 1)) return { error: 'not enough souls', code: 400006 };
  if (pl.coin < 1000 * (lv + 1)) return { error: 'not enough silver' };
  db.prepare('UPDATE players SET coin=coin-? WHERE uid=? AND server_id=?').run(1000 * (lv + 1), pl.uid, pl.server_id);
  propAdd(db, pl.uid, pl.server_id, GATE_SOUL, c[GATE_SOUL] === undefined ? 5000 - 100 * (lv + 1) : -100 * (lv + 1));
  propAdd(db, pl.uid, pl.server_id, 9997, 1);
  return {};
}

// ---- Arena (ranked ladder) --------------------------------------------------------------------
// Ladder = persistent order of "slots": real players (uid) and bots (ids 9100001+). Rank 1 is best. A win over a higher rank swaps places.
const ARENA_BOTS = 20;
function arenaEnsure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS arena (rank INTEGER PRIMARY KEY, uid INTEGER NOT NULL UNIQUE)');
  if (!db.prepare('SELECT COUNT(*) n FROM arena').get().n) {
    const ins = db.prepare('INSERT INTO arena(rank,uid) VALUES(?,?)');
    for (let i = 1; i <= ARENA_BOTS; i++) ins.run(i, 9100000 + i);
  }
}
function arenaJoin(db, pl) {
  arenaEnsure(db);
  if (!db.prepare('SELECT 1 FROM arena WHERE uid=?').get(pl.uid)) {
    const n = db.prepare('SELECT COUNT(*) n FROM arena').get().n;
    db.prepare('INSERT INTO arena(rank,uid) VALUES(?,?)').run(n + 1, pl.uid);
  }
  return db.prepare('SELECT rank FROM arena WHERE uid=?').get(pl.uid).rank;
}
function arenaInfo(db, uid) {
  if (uid >= 9100001 && uid <= 9100000 + ARENA_BOTS) {
    const i = uid - 9100000, pool = Array.from(ninjas().values()).filter((r) => r[4] === 1 && r[11] >= 4);
    const n = pool[(i * 37) % pool.length];
    return { uid, nick: BOT_NAMES[i % BOT_NAMES.length] + ' ' + i, level: 20 + i * 3, ninja: n[0], star: n[11], country: 1 + (i % 3), power: 1500 - i * 60 };
  }
  const p = db.prepare('SELECT * FROM players WHERE uid=?').get(uid);
  if (!p) return null;
  const t = teamStats(db, p.uid, p.server_id);
  return { uid, nick: p.nick, level: p.level, ninja: firstNinja(db, p), star: 5, country: p.country, power: (t.total.al + t.total.ah) / 2 / Math.max(1, t.slots.length) };
}
const arenaReward = (rank) => ({ coin: Math.max(500, 6000 - rank * 100), renown: Math.max(10, 200 - rank * 5) });
function arenaListXml(db, pl) {
  const my = arenaJoin(db, pl);
  const rows = db.prepare('SELECT rank, uid FROM arena ORDER BY rank').all();
  const idx = rows.findIndex((r) => r.uid === pl.uid);
  const targets = rows.slice(Math.max(0, idx - 6), idx).concat(rows.slice(idx + 1, idx + 4)).filter((r) => r.uid !== pl.uid);
  const esc = (t) => String(t).replace(/[<>&"]/g, '');
  const opp = targets.map((r) => {
    const o = arenaInfo(db, r.uid), rw = arenaReward(r.rank);
    return `<user>${el('id', r.uid)}${el('rank', r.rank)}${el('nick', esc(o.nick))}${el('level', o.level)}${el('ninja', o.ninja)}${el('country', o.country)}${el('firstninjastar', o.star)}${el('newlife', 0)}${el('winexp', 20)}${el('wincoin', 300)}${el('rewardcoin', rw.coin)}${el('rewardrenown', rw.renown)}${el('failexp', 5)}${el('failcoin', 50)}${el('host', 0)}<teammate></teammate></user>`;
  }).join('');
  const renown = propCounts(db, pl.uid, pl.server_id)[9996] || 0;
  return `<sport><my>${el('rank', my)}${el('renown', renown)}${el('rewardtimeleft', 3600)}${el('timeleft', 3600)}${el('dayrewardstat', 0)}${el('todayresttime', 99)}${el('todayall', 99)}${el('resttime', 0)}${el('restbatter', 99)}${el('restpack', 0)}</my></sport><oppe>${opp}</oppe>`;
}
function arenaRankXml(db) {
  const rows = db.prepare('SELECT rank, uid FROM arena ORDER BY rank LIMIT 50').all();
  const items = rows.map((r) => { const o = arenaInfo(db, r.uid), rw = arenaReward(r.rank); return `<item>${el('nick', String(o.nick).replace(/[<>&"]/g, ''))}${el('rank', r.rank)}${el('level', o.level)}${el('host', 0)}${el('rewardcoin', rw.coin)}${el('rewardrenown', rw.renown)}${el('firstninjastar', o.star)}<teammate></teammate></item>`; }).join('');
  return `<sportrank>${items}</sportrank>`;
}
function arenaFight(db, pl, toRank) {
  const my = arenaJoin(db, pl);
  const t = db.prepare('SELECT * FROM arena WHERE rank=?').get(toRank);
  if (!t || t.uid === pl.uid) return { error: 'bad target' };
  const o = arenaInfo(db, t.uid);
  const ts = teamStats(db, pl.uid, pl.server_id);
  const mine = (ts.total.al + ts.total.ah) / 2 / Math.max(1, ts.slots.length);
  const win = mine * (0.75 + Math.random() * 0.5) >= o.power;
  const xml = battleXml(db, pl, 0, 1, { enemyIds: [o.ninja, o.ninja, o.ninja], enemyName: o.nick, enemyUid: o.uid, enemyLevel: o.level, win });
  let from = my, to = my, renown = 0;
  if (win) {
    if (toRank < my) { db.prepare('UPDATE arena SET uid=-1 WHERE rank=?').run(my); db.prepare('UPDATE arena SET uid=? WHERE rank=?').run(my === 0 ? 0 : pl.uid, toRank); db.prepare('UPDATE arena SET uid=? WHERE rank=?').run(t.uid, my); to = toRank; }
    renown = arenaReward(to).renown;
    propAdd(db, pl.uid, pl.server_id, 9996, renown);
    db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(300, pl.uid, pl.server_id);
  }
  bumpTask(db, pl.uid, pl.server_id, 4);
  return { win, xml, from, to, renown };
}

function getStage(db, uid, sid, chap) {
  ensure(db);
  const r = db.prepare('SELECT stage FROM progress WHERE uid=? AND server_id=? AND chap=?').get(uid, sid, chap);
  return r ? r.stage : 1;
}
function setStage(db, uid, sid, chap, stage) {
  ensure(db);
  db.prepare('INSERT INTO progress(uid,server_id,chap,stage) VALUES(?,?,?,?) ON CONFLICT(uid,server_id,chap) DO UPDATE SET stage=MAX(stage,excluded.stage)').run(uid, sid, chap, stage);
}


// ---- God-card synthesis ("evolve"): two matching cards -> the 6-star version of that character (same npc icon family).
function godOf(ninjaId) {
  const n = ninjas().get(ninjaId); if (!n) return null;
  const fam = String(n[3]);
  const cand = [...ninjas().values()].find((r) => r[4] === 1 && r[11] === 6 && String(r[3]) === fam && r[0] !== ninjaId);
  if (cand) return cand[0];
  const gods = [...ninjas().values()].filter((r) => r[4] === 1 && r[6] === 0 && r[11] === 6 && /God/.test(r[2]));
  return gods.length ? gods[ninjaId % gods.length][0] : null; // no same-character god card: pick a god card deterministically
}
function godSynth(db, pl, attSeq, defSeq) {
  ensure(db);
  const a = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=? AND type=1').get(attSeq, pl.uid, pl.server_id);
  const b = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=? AND type=1').get(defSeq, pl.uid, pl.server_id);
  if (!a || !b || a.seq === b.seq) return { error: 'cards missing' };
  const god = godOf(b.ninja_id) || godOf(a.ninja_id); if (!god) return { error: 'no evolution for this card' };
  for (const c of [a, b]) if (db.prepare('SELECT 1 FROM team WHERE seq=?').get(c.seq)) return { error: 'remove cards from the team first' };
  db.prepare('DELETE FROM cards WHERE seq IN (?,?)').run(a.seq, b.seq);
  return { ninja: god, seq: giveCard(db, pl.uid, pl.server_id, god) };
}

module.exports = { grantDrop, mergeChips, mergeAwards, ninjaStats, CHIP_BASE, chipCount, chipbagXml, godSynth, potentialXml, potentialRoll, potentialSave, newlife, NEWLIFE_MAX, NEWLIFE_COST, arenaListXml, arenaRankXml, arenaFight, gateXml, gateOpen, gateLevel, gateBonus, friendsXml, sageGrow, giveEquip, teamStats, awardXml, secretXml, secretBuy, soulOf, equip, strengthen, packBuy, propUse, propCounts, propAdd, shopBuy, actXml, actClaim, sparFight, rivalsXml, rivals, bumpTask, dailyXml, dailyClaim, awardFull, addExp, battleXml, getStage, setStage, pull, pullXml, table, ninjas, ensure, giveCard, ensureStarterTeam, stateXml, cardXml };
