// Border war ("Boundary Monument", borderWar*.lua). Countries 0-4 (Wind, Thunder, Water, Fire, Earth) each have a
// monument. A player stations in an enemy country: Provoke (gold, attackType 1) or Wander (silver, attackType 2) for
// 30 minutes, which damages that monument. Defenders can "clear" stationed enemies with a fight. Damage done and
// enemies cleared become score for the daily attack/defence rankings; a finished station pays exp + merit.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = () => Math.floor(Date.now() / 1000);
const day = () => new Date().toISOString().slice(0, 10);
const STAY = 1800, TOTAL_HP = 2000000, PROVOKE_GOLD = 20, WANDER_SILVER = 20000, PROVOKE_HP = 60000, WANDER_HP = 20000;
const REWARD = { 1: { exp: 300, merit: 30 }, 2: { exp: 120, merit: 12 } };
const CLEARS_PER_DAY = 10;

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS border_mon (server_id INTEGER, day TEXT, country INTEGER, hp INTEGER, PRIMARY KEY(server_id, day, country));
    CREATE TABLE IF NOT EXISTS border_station (server_id INTEGER, uid INTEGER, country INTEGER, to_country INTEGER, type INTEGER, start INTEGER, claimed INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS border_score (server_id INTEGER, day TEXT, uid INTEGER, att INTEGER DEFAULT 0, def INTEGER DEFAULT 0, clears INTEGER DEFAULT 0,
      PRIMARY KEY(server_id, day, uid));
    CREATE TABLE IF NOT EXISTS border_log (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER, country INTEGER, enemy_country INTEGER, nick TEXT, type INTEGER, ts INTEGER, hurt INTEGER)`);
}
// The rest of the server uses countries 1-3; the border screen uses 0-4 where 1 = Thunder, 2 = Water, 3 = Fire.
const myCountry = (pl) => pl.country;
function hp(db, sid, c) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO border_mon VALUES(?,?,?,?)').run(sid, day(), c, TOTAL_HP);
  return db.prepare('SELECT hp FROM border_mon WHERE server_id=? AND day=? AND country=?').get(sid, day(), c).hp;
}
const active = (db, sid) => db.prepare('SELECT s.*, p.nick, p.level FROM border_station s JOIN players p ON p.uid=s.uid AND p.server_id=s.server_id WHERE s.server_id=? AND s.start>?').all(sid, now() - STAY);
function score(db, pl) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO border_score(server_id,day,uid) VALUES(?,?,?)').run(pl.server_id, day(), pl.uid);
  return db.prepare('SELECT * FROM border_score WHERE server_id=? AND day=? AND uid=?').get(pl.server_id, day(), pl.uid);
}

// Cmd 1: monument of country C + who is stationed there. Cmd 3: damage history of country C.
function infoXml(db, pl, c, cmd) {
  ensure(db);
  if (cmd === 3) {
    const rows = db.prepare('SELECT * FROM border_log WHERE server_id=? AND country=? ORDER BY id DESC LIMIT 30').all(pl.server_id, c);
    return '<hurt_record>' + rows.map((r) => `<item attack_starttime="${r.ts}" enemy_country="${r.enemy_country}" nick="${esc(r.nick)}" attack_lasttime="${STAY}" attack_type="${r.type}" attack_hurt="${r.hurt}"/>`).join('') + '</hurt_record>';
  }
  const st = active(db, pl.server_id).filter((s) => s.to_country === c);
  const count = (type) => [0, 1, 2, 3, 4].filter((x) => x !== c).map((x) => `<item id="${x}" num="${st.filter((s) => s.type === type && s.country === x).length}"/>`).join('');
  return '<monument_info>' + el('remaining_hp', hp(db, pl.server_id, c)) + el('total_hp', TOTAL_HP) + el('defiance_cash', PROVOKE_GOLD) +
    el('wander_coin', WANDER_SILVER) + el('cost_defiance_hp', PROVOKE_HP) + el('cost_wander_hp', WANDER_HP) + '</monument_info>' +
    `<wander_enemy>${count(2)}</wander_enemy><defiance_enemy>${count(1)}</defiance_enemy>`;
}
function myStation(db, pl) {
  return db.prepare('SELECT * FROM border_station WHERE server_id=? AND uid=? AND start>? ORDER BY start DESC LIMIT 1').get(pl.server_id, pl.uid, now() - STAY);
}
function userXml(db, pl) {
  const s = myStation(db, pl), sc = score(db, pl);
  const end = (t) => (s && s.type === t ? s.start + STAY : 0);
  return '<user_info>' + el('defiance_end_time', end(1)) + el('wander_end_time', end(2)) + el('defiance_exp', REWARD[1].exp) + el('defiance_exploit', REWARD[1].merit) +
    el('wander_ex', REWARD[2].exp) + el('wander_exploit', REWARD[2].merit) + el('cleartimes_lmt', CLEARS_PER_DAY) + el('cleartimes_left', Math.max(0, CLEARS_PER_DAY - sc.clears)) +
    el('nextlv_cleartimes_lmt', CLEARS_PER_DAY) + '</user_info>' +
    '<kill_enemy>' + el('kill_defiance', sc.clears) + el('kill_wander', sc.clears) + '</kill_enemy>' +
    '<user_status>' + el('status', s ? s.type : 0) + el('to_country', s ? s.to_country : -1) + el('remaining_time', s ? s.start + STAY - now() : 0) + '</user_status>' +
    '<clear_info>' + el('last_attack_country', -1) + el('last_clear_enemy_country', -1) + el('last_clear_enemy_uid', '') + '</clear_info>';
}
// Station in an enemy country (attackType 1 provoke = gold, 2 wander = silver). Damages the monument right away.
function attack(db, pl, type, to) {
  ensure(db);
  if (!Number.isInteger(to) || to === myCountry(pl) || to < 0 || to > 4 || (type !== 1 && type !== 2)) return { code: 5, msg: 'pick an enemy country' };
  if (myStation(db, pl)) return { code: 329018, xml: userXml(db, pl) };
  const cost = type === 1 ? PROVOKE_GOLD : WANDER_SILVER, col = type === 1 ? 'gold' : 'coin';
  if (pl[col] < cost) return { code: 5, msg: 'not enough ' + (type === 1 ? 'gold' : 'silver') };
  db.prepare(`UPDATE players SET ${col}=${col}-? WHERE uid=? AND server_id=?`).run(cost, pl.uid, pl.server_id);
  const dmg = type === 1 ? PROVOKE_HP : WANDER_HP;
  hp(db, pl.server_id, to);
  db.prepare('UPDATE border_mon SET hp=MAX(0,hp-?) WHERE server_id=? AND day=? AND country=?').run(dmg, pl.server_id, day(), to);
  db.prepare('INSERT INTO border_station(server_id,uid,country,to_country,type,start) VALUES(?,?,?,?,?,?)').run(pl.server_id, pl.uid, myCountry(pl), to, type, now());
  db.prepare('INSERT INTO border_log(server_id,country,enemy_country,nick,type,ts,hurt) VALUES(?,?,?,?,?,?,?)').run(pl.server_id, to, myCountry(pl), pl.nick, type, now(), dmg);
  score(db, pl);
  db.prepare('UPDATE border_score SET att=att+? WHERE server_id=? AND day=? AND uid=?').run(Math.round(dmg / 1000), pl.server_id, day(), pl.uid);
  return { code: 0, xml: '' };
}
// Enemies stationed in country C (Cmd 1 of rl_r_frontiers_war_enemy_info).
function enemyXml(db, pl, c) {
  const st = active(db, pl.server_id).filter((s) => s.to_country === c);
  return '<enemy_list>' + st.map((s) => `<item id="${s.uid}" nick="${esc(s.nick)}" country="${s.country}" level="${s.level}" remaining_time="${s.start + STAY - now()}"/>`).join('') + '</enemy_list>';
}
// Defender fights a stationed enemy. Win = the enemy is sent home and the defender scores.
function clear(db, pl, toUid) {
  const sc = score(db, pl);
  if (sc.clears >= CLEARS_PER_DAY) return { code: 5, msg: 'no clears left today' };
  const st = myStation(db, { server_id: pl.server_id, uid: toUid });
  const enemy = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(toUid, pl.server_id);
  if (!st || !enemy) return { code: 5, msg: 'that enemy already left' };
  const pw = (uid) => { const t = game.teamStats(db, uid, pl.server_id).total; return t.al + t.ah + t.dl + t.dh; };
  const win = pw(pl.uid) * (0.8 + Math.random() * 0.4) >= pw(toUid);
  let exp = 0, merit = 0;
  if (win) {
    db.prepare('UPDATE border_station SET start=0 WHERE rowid=(SELECT rowid FROM border_station WHERE server_id=? AND uid=? ORDER BY start DESC LIMIT 1)').run(pl.server_id, toUid);
    db.prepare('UPDATE border_score SET def=def+20, clears=clears+1 WHERE server_id=? AND day=? AND uid=?').run(pl.server_id, day(), pl.uid);
    exp = 100; merit = 10;
    game.addExp(db, pl, exp);
    game.propAdd(db, pl.uid, pl.server_id, 9994, merit);
  }
  const fight = game.battleXml(db, pl, 1, 1, { win, enemyName: enemy.nick, enemyUid: enemy.uid, enemyLevel: enemy.level });
  return { code: 0, xml: `<userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime>${el('Exp', exp)}${el('Merit', merit)}</userinfo>` + fight + game.awardFull({ exp }) };
}
// Reward for the last finished station (Cmd 2 info / recv).
function lastFinished(db, pl) {
  return db.prepare('SELECT * FROM border_station WHERE server_id=? AND uid=? AND start>0 AND start<=? AND claimed=0 ORDER BY start DESC LIMIT 1').get(pl.server_id, pl.uid, now() - STAY);
}
function awardInfoXml(db, pl) {
  const s = lastFinished(db, pl);
  if (!s) return '';
  const r = REWARD[s.type];
  return `<award alive_time="8" exp="${r.exp}" power="${r.merit}" destory_type="${s.type}" enemy_nick="" enemy_country="${s.to_country}"/>`;
}
function recv(db, pl, cmd) {
  if (cmd === 2) {
    const s = lastFinished(db, pl);
    if (!s) return { code: 329009 };
    db.prepare('UPDATE border_station SET claimed=1 WHERE server_id=? AND uid=? AND start=?').run(pl.server_id, pl.uid, s.start);
    const r = REWARD[s.type];
    game.addExp(db, pl, r.exp);
    game.propAdd(db, pl.uid, pl.server_id, 9994, r.merit);
    return { code: 0, xml: `<award>${el('exp', r.exp)}${el('merit', r.merit)}</award>` };
  }
  // 3 = defence rank award, 4 = attack rank award: once per day for anyone in the top 10
  const ok = db.prepare('CREATE TABLE IF NOT EXISTS rank_claims (uid INTEGER, server_id INTEGER, board TEXT, key TEXT, PRIMARY KEY(uid,server_id,board,key))').run() &&
    db.prepare('INSERT OR IGNORE INTO rank_claims VALUES(?,?,?,?)').run(pl.uid, pl.server_id, 'border' + cmd, day()).changes;
  if (!ok) return { code: 329009 };
  return { code: 0, xml: game.grantDrop(db, pl, 371) };
}
function rankXml(db, pl, type) {
  ensure(db);
  const col = type === 1 || type === 2 ? 'def' : 'att';
  const when = type === 2 || type === 4 ? '' : ' AND s.day=?';
  const args = [pl.server_id].concat(when ? [day()] : []);
  const rows = db.prepare(`SELECT s.uid, SUM(s.${col}) score, p.nick, p.level, p.country FROM border_score s JOIN players p ON p.uid=s.uid AND p.server_id=s.server_id
    WHERE s.server_id=?${when} GROUP BY s.uid HAVING score>0 ORDER BY score DESC LIMIT 50`).all(...args);
  const mine = rows.find((r) => r.uid === pl.uid);
  return el('score', mine ? mine.score : 0) + el('rank_award_desc', 'Top 10 get 500 gold') + el('min_award_score', 1) +
    '<rank_list>' + rows.map((r, i) => `<item rank="${i + 1}" nick="${esc(r.nick)}" country="${r.country}" level="${r.level}" score="${r.score}" award="371"/>`).join('') + '</rank_list>';
}

module.exports = { infoXml, userXml, attack, enemyXml, clear, awardInfoXml, recv, rankXml };
