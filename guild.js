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
function count(db, gid) { return db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id=?').get(gid).n; }
function leaderName(db, g) { const r = db.prepare('SELECT nick FROM players WHERE uid=? AND server_id=?').get(g.leader_uid, g.server_id); return r ? r.nick : '?'; }
function rank(db, g) { return db.prepare('SELECT COUNT(*)+1 n FROM groups WHERE server_id=? AND (score>? OR (score=? AND id<?))').get(g.server_id, g.score, g.score, g.id).n; }

function status(db, pl) { const g = myGroup(db, pl.uid, pl.server_id); return { g, member_status: g ? 2 : 0, groupid: g ? g.id : 0 }; }

function listXml(db, pl) {
  const s = status(db, pl);
  const rows = db.prepare('SELECT * FROM groups WHERE server_id=? ORDER BY score DESC, id').all(pl.server_id)
    .map((g) => `<group groupid="${g.id}" groupname="${esc(g.name)}" level="${g.level}" leader="${esc(leaderName(db, g))}" curcount="${count(db, g.id)}" totalcount="${20 + 5 * g.level}"/>`).join('');
  return `<member_status>${s.member_status}</member_status><grouplist>${rows}</grouplist>`;
}

function detailXml(db, pl, gid) {
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g) return null;
  const mine = myGroup(db, pl.uid, pl.server_id);
  const js = mine ? (mine.id === g.id ? 2 : 3) : 0;
  return '<group_info>' + el('name', esc(g.name)) + el('level', g.level) + el('curcount', count(db, g.id)) + el('totalcount', 20 + 5 * g.level) +
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

function adminXml(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id);
  if (!g) return null;
  const mem = db.prepare('SELECT m.*, p.nick, p.level lv FROM group_members m JOIN players p ON p.uid=m.uid AND p.server_id=m.server_id WHERE m.group_id=? ORDER BY m.pos DESC, m.score DESC').all(g.id);
  const rows = mem.map((m) => `<member name="${esc(m.nick)}" level="${m.lv}" postion="${m.pos}" score="${m.score}" last_login="${Math.floor(Date.now() / 1000)}" uid="${m.uid}"/>`).join('');
  const me = mem.find((m) => m.uid === pl.uid);
  return `<group_info>${el('name', esc(g.name))}${el('level', g.level)}${el('score', g.score)}${el('curcount', mem.length)}${el('totalcount', 20 + 5 * g.level)}</group_info>` +
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
  db.prepare('UPDATE group_members SET score=score+? WHERE uid=? AND server_id=?').run(t.member_score, pl.uid, pl.server_id);
  db.prepare('UPDATE groups SET score=score+? WHERE id=?').run(t.group_score, g.id);
  db.prepare('INSERT INTO group_checkin(group_id,name,taskname,ts,uid,day) VALUES(?,?,?,?,?,?)').run(g.id, pl.nick, 'Task ' + taskId, Math.floor(Date.now() / 1000), pl.uid, today());
  const p = db.prepare('SELECT gold, coin FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  return { xml: logXml(db, g.id) + el('cash', p.gold) + el('coin', p.coin) + el('score', memberScore(db, pl.uid, pl.server_id)) };
}
function shopXml() { return '<store_info>' + el('remain_time', 3600) + el('user_score', 0) + '</store_info><item_list></item_list>'; }


// Donations: gold only (ninja / equipment / ninjutsu donation tabs are listed but not built).
function contriXml(db, pl) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return null;
  const tier = (i) => `<item${i} contri_cash="10" group_score="1" user_score="1" group_score4="5" user_score4="5" group_score5="10" user_score5="10"/>`;
  return el('score', memberScore(db, pl.uid, pl.server_id)) + [1, 2, 3, 4].map(tier).join('');
}
function donate(db, pl, cash) {
  const g = myGroup(db, pl.uid, pl.server_id); if (!g) return { error: 'no group' };
  cash = Math.floor(Number(cash) || 0);
  if (cash < 10) return { error: 'minimum 10 gold' };
  if (pl.gold < cash) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cash, pl.uid, pl.server_id);
  db.prepare('UPDATE group_members SET score=score+? WHERE uid=? AND server_id=?').run(cash, pl.uid, pl.server_id);
  db.prepare('UPDATE groups SET score=score+? WHERE id=?').run(cash, g.id);
  return {};
}
module.exports = { contriXml, donate, rankXml, hallXml, checkin, shopXml, CREATE_COST, ensure, status, listXml, detailXml, create, join, quit, buildingsXml, adminXml, myGroup };
