// Akatsuki (guild) system. Lua screens read rows as ATTRIBUTES (cell.name etc.) and single values as child text.
// Joining is instant (no approval queue): this is a small friends-only server. The first member is the leader (pos 3).
const CREATE_COST = 789; // matches the "Fund" the create dialog shows

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER, name TEXT, desc TEXT, leader_uid INTEGER, level INTEGER DEFAULT 1, score INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS group_members (uid INTEGER, server_id INTEGER, group_id INTEGER, pos INTEGER DEFAULT 0, score INTEGER DEFAULT 0, PRIMARY KEY(uid, server_id))`);
}
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const el = (n, v) => `<${n}>${v}</${n}>`;

function myGroup(db, uid, sid) {
  ensure(db);
  return db.prepare('SELECT g.* FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.uid=? AND m.server_id=?').get(uid, sid);
}
// ORIGINAL (Facebook photos 1769, 1786): Akatsuki Lv3 = 9 members, Lv8 = 14 -> 6 + level.
const maxMembers = (g) => 6 + Math.min(9, g.level || 1);
function count(db, gid) { return db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id=?').get(gid).n; }
function leaderName(db, g) { const r = db.prepare('SELECT nick FROM players WHERE uid=? AND server_id=?').get(g.leader_uid, g.server_id); return r ? r.nick : '?'; }
function rank(db, g) { return db.prepare('SELECT COUNT(*)+1 n FROM groups WHERE server_id=? AND (score>? OR (score=? AND id<?))').get(g.server_id, g.score, g.score, g.id).n; }

function status(db, pl) { const g = myGroup(db, pl.uid, pl.server_id); return { g, member_status: g ? 2 : 0, groupid: g ? g.id : 0 }; }

function listXml(db, pl) {
  const s = status(db, pl);
  const rows = db.prepare('SELECT * FROM groups WHERE server_id=? ORDER BY score DESC, id').all(pl.server_id)
    .map((g) => `<group groupid="${g.id}" groupname="${esc(g.name)}" level="${g.level}" leader="${esc(leaderName(db, g))}" curcount="${count(db, g.id)}" totalcount="${maxMembers(g)}"/>`).join('');
  return `<member_status>${s.member_status}</member_status><grouplist>${rows}</grouplist>`;
}

function detailXml(db, pl, gid) {
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g) return null;
  const mine = myGroup(db, pl.uid, pl.server_id);
  const js = mine ? (mine.id === g.id ? 2 : 3) : 0;
  return '<group_info>' + el('name', esc(g.name)) + el('level', g.level) + el('curcount', count(db, g.id)) + el('totalcount', maxMembers(g)) +
    el('leader', esc(leaderName(db, g))) + el('score', g.score) + el('rank', rank(db, g)) + el('desc', esc(g.desc)) + el('minlevel', 1) +
    el('minfightscore', 0) + el('join_status', js) + '</group_info>';
}

function create(db, pl, name, desc) {
  ensure(db);
  if (myGroup(db, pl.uid, pl.server_id)) return { error: 'already in a group' };
  name = String(name || '').trim().slice(0, 20);
  if (!name) return { error: 'name needed' };
  if (db.prepare('SELECT 1 FROM groups WHERE server_id=? AND name=?').get(pl.server_id, name)) return { error: 'name taken' };
  if (pl.gold < CREATE_COST) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(CREATE_COST, pl.uid, pl.server_id);
  const id = Number(db.prepare('INSERT INTO groups(server_id,name,desc,leader_uid) VALUES(?,?,?,?)').run(pl.server_id, name, String(desc || '').slice(0, 200), pl.uid).lastInsertRowid);
  db.prepare('INSERT INTO group_members(uid,server_id,group_id,pos) VALUES(?,?,?,3)').run(pl.uid, pl.server_id, id);
  return { id };
}

function join(db, pl, gid) {
  ensure(db);
  if (myGroup(db, pl.uid, pl.server_id)) return { error: 'already in a group' };
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g) return { error: 'no such group' };
  if (count(db, gid) >= maxMembers(g)) return { error: 'this Akatsuki is full' };
  db.prepare('INSERT INTO group_members(uid,server_id,group_id,pos) VALUES(?,?,?,0)').run(pl.uid, pl.server_id, gid);
  return { id: gid };
}

function quit(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id);
  if (!g) return;
  db.prepare('DELETE FROM group_members WHERE uid=? AND server_id=?').run(pl.uid, pl.server_id);
  const next = db.prepare('SELECT uid FROM group_members WHERE group_id=? ORDER BY pos DESC, rowid LIMIT 1').get(g.id);
  if (!next) db.prepare('DELETE FROM groups WHERE id=?').run(g.id);
  else if (g.leader_uid === pl.uid) {
    db.prepare('UPDATE groups SET leader_uid=? WHERE id=?').run(next.uid, g.id);
    db.prepare('UPDATE group_members SET pos=3 WHERE uid=? AND group_id=?').run(next.uid, g.id);
  }
}

function buildingsXml(g) {
  return [1, 2, 3, 4, 5].map((i) => `<item${i} level="${g.level}"/>`).join('');
}

// ---- Buildings (ui_orgUpgradeLayer: rl_w_group_admin Cmd 8 list, Cmd 9 upgrade ConstructID) ----------------------------------
// construct 1 Akatsuki (group level), 2 Mall, 3 Worship (donate), 4 Hall; paid with the group's fund (groups.score).
// ORIGINAL (Facebook photos 0567, 1198): max levels Akatsuki 9, the others 5. Akatsuki 8 -> 9 = 45 000 (member +1, needs Hall 4);
// Mall 4 -> 5 = 15 000 (needs Akatsuki 9); Worship 4 -> 5 = 13 000 ("20% donation profit" at 4); Hall 4 -> 5 = 20 000 ("140% mission
// profits" at 4, needs Mall 5). (ours): the costs of the lower levels, and that each level adds 5% donation / 10% mission profit.
const CONSTRUCT_MAX = { 1: 9, 2: 5, 3: 5, 4: 5 };
const CONSTRUCT_COST = { // cost to reach level n = [n]
  1: [0, 0, 1000, 2000, 4000, 7000, 12000, 20000, 30000, 45000],
  2: [0, 0, 3000, 6000, 10000, 15000],
  3: [0, 0, 2500, 5000, 8000, 13000],
  4: [0, 0, 4000, 8000, 13000, 20000],
};
const CONSTRUCT_NEED = { '1:9': [4, 4], '2:5': [1, 9], '4:5': [2, 5] }; // 'building:next level' -> [building needed, its level]
const CONSTRUCT_EFFECT = { 1: 'member +1', 2: 'more goods in the mall', 3: '+5% donation profit', 4: '+10% mission profits' };
function constructLevels(db, grp) {
  db.exec('CREATE TABLE IF NOT EXISTS group_construct (group_id INTEGER, cid INTEGER, level INTEGER, PRIMARY KEY(group_id, cid))');
  const lv = { 1: grp.level || 1, 2: 1, 3: 1, 4: 1 };
  for (const r of db.prepare('SELECT cid, level FROM group_construct WHERE group_id=?').all(grp.id)) lv[r.cid] = r.level;
  lv[1] = grp.level || 1;
  for (const c of [1, 2, 3, 4]) lv[c] = Math.min(lv[c], CONSTRUCT_MAX[c]);
  return lv;
}
function constructXml(db, grp) {
  const lv = constructLevels(db, grp);
  const rows = [1, 2, 3, 4].map((c) => {
    const max = lv[c] >= CONSTRUCT_MAX[c] ? 1 : 0;
    const need = CONSTRUCT_NEED[`${c}:${lv[c] + 1}`] || [0, 0];
    return `<construct construct_id="${c}" level="${lv[c]}" max_level_flag="${max}" consume_score="${max ? 0 : CONSTRUCT_COST[c][lv[c] + 1]}" effect_desc="${CONSTRUCT_EFFECT[c]}"` +
      ` require_construct_id="${need[0]}" require_construct_level="${need[1]}"/>`;
  }).join('');
  return `<group_info>${el('score', grp.score)}</group_info><construct_list>${rows}</construct_list>`;
}
function constructUp(db, pl, cid) {
  const grp = myGroup(db, pl.uid, pl.server_id);
  if (!grp) return { error: 'no group' };
  const lv = constructLevels(db, grp);
  if (!lv[cid]) return { error: 'no such building' };
  if (lv[cid] >= CONSTRUCT_MAX[cid]) return { error: 'level max' };
  const need = CONSTRUCT_NEED[`${cid}:${lv[cid] + 1}`];
  if (need && lv[need[0]] < need[1]) return { error: 'upgrade the other building first' };
  const cost = CONSTRUCT_COST[cid][lv[cid] + 1];
  if (grp.score < cost) return { error: 'not enough fund' };
  db.prepare('UPDATE groups SET score=score-? WHERE id=?').run(cost, grp.id);
  if (cid === 1) db.prepare('UPDATE groups SET level=level+1 WHERE id=?').run(grp.id);
  else db.prepare('INSERT INTO group_construct(group_id,cid,level) VALUES(?,?,?) ON CONFLICT(group_id,cid) DO UPDATE SET level=excluded.level').run(grp.id, cid, lv[cid] + 1);
  return { xml: constructXml(db, db.prepare('SELECT * FROM groups WHERE id=?').get(grp.id)) };
}

function adminXml(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id);
  if (!g) return null;
  const mem = db.prepare('SELECT m.*, p.nick, p.level lv FROM group_members m JOIN players p ON p.uid=m.uid AND p.server_id=m.server_id WHERE m.group_id=? ORDER BY m.pos DESC, m.score DESC').all(g.id);
  const rows = mem.map((m) => `<member name="${esc(m.nick)}" level="${m.lv}" postion="${m.pos}" score="${m.score}" last_login="${Math.floor(Date.now() / 1000)}" uid="${m.uid}"/>`).join('');
  const me = mem.find((m) => m.uid === pl.uid);
  return `<group_info>${el('name', esc(g.name))}${el('level', g.level)}${el('score', g.score)}${el('curcount', mem.length)}${el('totalcount', maxMembers(g))}</group_info>` +
    `<member_list>${rows}</member_list>${el('pos', me ? me.pos : 0)}`;
}


// ---- Rankings, hall (daily check-in), shop ---------------------------------------------------
function rankXml(db, pl) {
  const rows = db.prepare('SELECT * FROM groups WHERE server_id=? ORDER BY score DESC, id').all(pl.server_id);
  const mine = myGroup(db, pl.uid, pl.server_id);
  const list = rows.map((g, i) => `<group rank="${i + 1}" groupname="${esc(g.name)}" level="${g.level}" leadername="${esc(leaderName(db, g))}" curcount="${count(db, g.id)}"/>`).join('');
  const me = mine ? `<group groupid="${mine.id}" rank="${rows.findIndex((x) => x.id === mine.id) + 1}" groupname="${esc(mine.name)}" level="${mine.level}" leadername="${esc(leaderName(db, mine))}" curcount="${count(db, mine.id)}"/>` : '<group groupid="0" rank="0" groupname="" level="0" leadername="" curcount="0"/>';
  return `<ranklist>${list}</ranklist><myrank>${me}</myrank>`;
}

const TASKS = [
  { taskid: 1, group_score: 10, member_score: 10, consume: 1000, consume_type: 2 },
  { taskid: 2, group_score: 30, member_score: 30, consume: 20, consume_type: 1 },
  { taskid: 3, group_score: 100, member_score: 100, consume: 100, consume_type: 1 },
];
function ensureHall(db) {
  db.exec('CREATE TABLE IF NOT EXISTS group_checkin (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, name TEXT, taskname TEXT, ts INTEGER, uid INTEGER, day TEXT)');
}
const today = () => new Date().toISOString().slice(0, 10);
function logXml(db, gid) {
  const rows = db.prepare('SELECT * FROM group_checkin WHERE group_id=? ORDER BY id DESC LIMIT 20').all(gid);
  return '<checkin_log>' + rows.map((r) => `<log checkin_name="${esc(r.name)}" taskname="${esc(r.taskname)}" checkin_time="${r.ts}"/>`).join('') + '</checkin_log>';
}
function memberScore(db, uid, sid) { const m = db.prepare('SELECT score FROM group_members WHERE uid=? AND server_id=?').get(uid, sid); return m ? m.score : 0; }
function hallXml(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return null;
  ensureHall(db);
  const done = db.prepare('SELECT 1 FROM group_checkin WHERE uid=? AND day=?').get(pl.uid, today()) ? 1 : 0;
  const tasks = TASKS.map((t) => '<task>' + Object.entries(t).map(([k, v]) => `${k}="${v}"`).join(' ') + '</task>');
  const tl = '<task_list>' + TASKS.map((t) => '<task ' + Object.entries(t).map(([k, v]) => `${k}="${v}"`).join(' ') + '/>').join('') + '</task_list>';
  return `<my_checkin>${el('today_checkin', done)}${el('score', memberScore(db, pl.uid, pl.server_id))}</my_checkin>${tl}${logXml(db, g.id)}`;
}
function checkin(db, pl, taskId) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return { error: 'no group' };
  ensureHall(db);
  if (db.prepare('SELECT 1 FROM group_checkin WHERE uid=? AND day=?').get(pl.uid, today())) return { error: 'already checked in today' };
  const t = TASKS.find((x) => x.taskid === taskId); if (!t) return { error: 'bad task' };
  const col = t.consume_type === 1 ? 'gold' : 'coin';
  if (pl[col] < t.consume) return { error: 'not enough ' + col };
  db.prepare(`UPDATE players SET ${col}=${col}-? WHERE uid=? AND server_id=?`).run(t.consume, pl.uid, pl.server_id);
  const boost = 1 + 0.1 * constructLevels(db, g)[4]; // Hall: +10% mission profits a level (140% at Lv4, photo 0567)
  db.prepare('UPDATE group_members SET score=score+? WHERE uid=? AND server_id=?').run(Math.floor(t.member_score * boost), pl.uid, pl.server_id);
  db.prepare('UPDATE groups SET score=score+? WHERE id=?').run(Math.floor(t.group_score * boost), g.id);
  db.prepare('INSERT INTO group_checkin(group_id,name,taskname,ts,uid,day) VALUES(?,?,?,?,?,?)').run(g.id, pl.nick, 'Task ' + taskId, Math.floor(Date.now() / 1000), pl.uid, today());
  const p = db.prepare('SELECT gold, coin FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  return { xml: logXml(db, g.id) + el('cash', p.gold) + el('coin', p.coin) + el('score', memberScore(db, pl.uid, pl.server_id)) };
}
// Akatsuki mall (ui_orgShopLayer): rl_r_group_store Cmd 1 = list, Cmd 2 ItemIndex = buy with your contribution (and sometimes gold).
// ORIGINAL (Facebook photos 0655, 1864, 2303, 2330): new goods every 30 minutes; prices in contribution: 20 Sage Stone I 70, 100 Sage Stone I
// 280, 10 Sage Stone III 70, 20 Sage Stone III 140, 3 Reincarnation Pills 378, 4 for 504, 3 Development Dan 420, a 5-star weapon 2100,
// goods at 2100 + 900 gold and 3000 + 1800 gold, a green scroll 196 and a blue scroll 700; Mall Lv5 = "3 more spots".
// (ours): which card the 2100 + 900 / 3000 + 1800 / scroll goods are, 9 spots (the last 3 at Mall Lv5), one buy of each spot per refresh.
const MALL = [ // [dropinfo id, icon, contribution, gold]
  [214, 'props_034', 70, 0], [1510, 'props_034', 280, 0], [380, 'props_035', 70, 0], [239, 'props_035', 140, 0],
  [1545, 'props_033', 378, 0], [1546, 'props_033', 504, 0], [1529, 'props_229', 420, 0], [125, 'props_029', 2100, 0],
  [11, 'props_015', 2100, 900], [1800, 'props_015', 3000, 1800], [15, 'props_028', 196, 0], [14, 'props_028', 700, 0],
];
const MALL_SPOTS = 9, MALL_EVERY = 1800;
const mallWindow = () => Math.floor(Date.now() / 1000 / MALL_EVERY);
function mallGoods(g) { // the same 9 goods for the whole group during one 30-minute window
  let seed = (g.id * 7919 + mallWindow() * 104729) % 2147483647 || 1;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const pool = MALL.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, MALL_SPOTS);
}
function mallBought(db, pl) {
  db.exec('CREATE TABLE IF NOT EXISTS group_mall_buy (uid INTEGER, server_id INTEGER, win INTEGER, idx INTEGER, PRIMARY KEY(uid, server_id, win, idx))');
  return new Set(db.prepare('SELECT idx FROM group_mall_buy WHERE uid=? AND server_id=? AND win=?').all(pl.uid, pl.server_id, mallWindow()).map((r) => r.idx));
}
function shopXml(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return null;
  const mallLv = constructLevels(db, g)[2], bought = mallBought(db, pl);
  const items = mallGoods(g).map(([drop, icon, score, cash], i) => {
    const need = i < 6 ? 1 : 5;
    return `<item store_drop="${drop}" store_icon="${icon}" cost_score="${score}" cost_cash="${cash}" onoff="${mallLv >= need ? 1 : 0}" min_store_level="${need}" buyflag="${bought.has(i + 1) ? 1 : 0}"/>`;
  }).join('');
  const left = MALL_EVERY - (Math.floor(Date.now() / 1000) % MALL_EVERY);
  return '<store_info>' + el('remain_time', left) + el('user_score', memberScore(db, pl.uid, pl.server_id)) + `</store_info><item_list>${items}</item_list>`;
}
function shopBuy(db, pl, idx) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return { error: 'no group' };
  const it = mallGoods(g)[idx - 1]; if (!it) return { error: 'no such item' };
  if (constructLevels(db, g)[2] < (idx <= 6 ? 1 : 5)) return { error: 'upgrade the mall first' };
  if (mallBought(db, pl).has(idx)) return { error: 'already bought' };
  if (memberScore(db, pl.uid, pl.server_id) < it[2]) return { error: 'not enough contribution' };
  if (pl.gold < it[3]) return { code: 10006 };
  db.prepare('UPDATE group_members SET score=score-? WHERE uid=? AND server_id=?').run(it[2], pl.uid, pl.server_id);
  if (it[3]) db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(it[3], pl.uid, pl.server_id);
  db.prepare('INSERT INTO group_mall_buy VALUES (?,?,?,?)').run(pl.uid, pl.server_id, mallWindow(), idx);
  const award = require('./game').grantDrop(db, pl, it[0]);
  return { xml: award + shopXml(db, db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id)) };
}


// Donations (ui_orgDonateLayer): rl_r_group_contri Cmd 1 = the four tabs (item1 gold, item2 shinobi, item3 equipment, item4 ninjutsu),
// Cmd 2 Cash = give gold, Cmd 3 ContriType 3/4 = list your 4/5-star equipment / ninjutsu, Cmd 4 BagIndex=[json] ContriType = give cards.
// ORIGINAL (Facebook photos 1676-1680): 10 gold -> fund +12, contribution +12; each 4-star card -> fund +18, contribution +12; each 5-star
// -> fund +180, contribution +180. (ours): the gold rate grows with the Worship building, +5% a level ("20% donation profit" at Lv4 = 12).
const CARD_SCORE = { 4: [18, 12], 5: [180, 180] }; // stars -> [fund, contribution]
const goldRate = (db, g) => 1 + 0.05 * constructLevels(db, g)[3];
function contriXml(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return null;
  const gold = Math.floor(10 * goldRate(db, g));
  const tier = (i) => `<item${i} contri_cash="10" group_score="${gold}" user_score="${gold}" group_score4="${CARD_SCORE[4][0]}" user_score4="${CARD_SCORE[4][1]}"` +
    ` group_score5="${CARD_SCORE[5][0]}" user_score5="${CARD_SCORE[5][1]}"/>`;
  return el('score', memberScore(db, pl.uid, pl.server_id)) + [1, 2, 3, 4].map(tier).join('');
}
function donate(db, pl, cash) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return { error: 'no group' };
  cash = Math.floor(Number(cash) || 0);
  if (cash < 10) return { error: 'minimum 10 gold' };
  if (pl.gold < cash) return { error: 'not enough gold' };
  const gain = Math.floor(cash * goldRate(db, g));
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cash, pl.uid, pl.server_id);
  db.prepare('UPDATE group_members SET score=score+? WHERE uid=? AND server_id=?').run(gain, pl.uid, pl.server_id);
  db.prepare('UPDATE groups SET score=score+? WHERE id=?').run(gain, g.id);
  return {};
}
const KIND_TYPES = { 2: [1], 3: [2, 3, 4], 4: [6] }; // ContriType -> cards.type
function cardStar(c) {
  const game = require('./game');
  if (c.type === 1) return Math.min(5, (game.ninjas().get(c.ninja_id) || [])[11] || 0); // God cards count as 5-star
  if (c.type === 6) return (game.table('ninjutsuinfo').rows.find((r) => r[0] === c.ninja_id) || [])[5] || 0;
  return (game.table('equipmentinfo').rows.find((r) => r[0] === c.ninja_id) || [])[6] || 0;
}
// cards that can be given: 4 or 5 stars, not in the team, not worn
function donatable(db, pl, kind) {
  const types = KIND_TYPES[kind] || [0];
  return db.prepare(`SELECT * FROM cards WHERE uid=? AND server_id=? AND type IN (${types.join(',')})
    AND seq NOT IN (SELECT seq FROM team WHERE uid=? AND server_id=?) AND seq NOT IN (SELECT seq FROM equipped WHERE uid=? AND server_id=?)`)
    .all(pl.uid, pl.server_id, pl.uid, pl.server_id, pl.uid, pl.server_id).filter((c) => cardStar(c) >= 4);
}
function cardListXml(db, pl, kind) {
  const game = require('./game');
  const rows = donatable(db, pl, kind).map((c) => {
    const st = c.type === 6 ? {} : game.equipStats(c);
    const info = game.table(c.type === 6 ? 'ninjutsuinfo' : 'equipmentinfo').rows.find((r) => r[0] === c.ninja_id) || [];
    return `<item name="${esc(info[2])}" star_level="${cardStar(c)}" cardid="${c.ninja_id}" bagindex="${c.seq}" cardlevel="${c.level || 1}" newlife="${c.newlife || 0}"` +
      ` attacklow="${st.al || 0}" attackhigh="${st.ah || 0}" defenselow="${st.dl || 0}" defensehigh="${st.dh || 0}" chakralow="${st.cl || 0}" chakrahigh="${st.ch || 0}"/>`;
  }).join('');
  return `<item_list>${rows}</item_list>`;
}
function donateCards(db, pl, kind, bagJson) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return { error: 'no group' };
  let seqs = [];
  try { seqs = JSON.parse(bagJson).map(Number); } catch { return { error: 'bad card list' }; }
  const ok = new Map(donatable(db, pl, kind).map((c) => [c.seq, c]));
  let fund = 0, mine = 0;
  for (const seq of seqs) {
    const c = ok.get(seq); if (!c) continue;
    const [f, m] = CARD_SCORE[cardStar(c)];
    db.prepare('DELETE FROM cards WHERE seq=?').run(seq);
    ok.delete(seq); fund += f; mine += m;
  }
  if (!fund) return { error: 'choose 4 or 5-star cards' };
  db.prepare('UPDATE group_members SET score=score+? WHERE uid=? AND server_id=?').run(mine, pl.uid, pl.server_id);
  db.prepare('UPDATE groups SET score=score+? WHERE id=?').run(fund, g.id);
  return {};
}
module.exports = { constructXml, constructUp, contriXml, donate, cardListXml, donateCards, rankXml, hallXml, checkin, shopXml, shopBuy, CREATE_COST, ensure, status, listXml, detailXml, create, join, quit, buildingsXml, adminXml, myGroup };
