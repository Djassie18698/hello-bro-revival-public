// Country war (War > War tab, CWarInfoView). On this server the war is always open: your country fights the other
// two. Every attack is a fight against a member (or a guard bot) of an enemy country; wins earn merit score and kills.
// Each player has "alive" points (lives) that refill daily.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const day = () => new Date().toISOString().slice(0, 10);
const MAX_ALIVE = 10;

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS war (server_id INTEGER, day TEXT, uid INTEGER, country INTEGER, alive INTEGER DEFAULT ${MAX_ALIVE},
    score INTEGER DEFAULT 0, kills INTEGER DEFAULT 0, beattack INTEGER DEFAULT 0, PRIMARY KEY(server_id, day, uid));
    CREATE TABLE IF NOT EXISTS war_log (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER, uid INTEGER, tuid INTEGER, fromnick TEXT, tonick TEXT,
      fromcountry INTEGER, tocountry INTEGER, win INTEGER, score INTEGER)`);
}
function me(db, pl) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO war(server_id,day,uid,country) VALUES(?,?,?,?)').run(pl.server_id, day(), pl.uid, pl.country);
  return db.prepare('SELECT * FROM war WHERE server_id=? AND day=? AND uid=?').get(pl.server_id, day(), pl.uid);
}
const enemies = (c) => [1, 2, 3].filter((x) => x !== c);
function countryKills(db, sid, c) {
  return (db.prepare('SELECT SUM(kills) n FROM war WHERE server_id=? AND day=? AND country=?').get(sid, day(), c).n) || 0;
}
function power(db, uid, sid) { const t = game.teamStats(db, uid, sid).total; return Math.round((t.al + t.ah + t.dl + t.dh) / 2); }

function infoXml(db, pl) {
  const m = me(db, pl), pw = power(db, pl.uid, pl.server_id);
  const rank = db.prepare('SELECT COUNT(*)+1 n FROM war WHERE server_id=? AND day=? AND score>?').get(pl.server_id, day(), m.score).n;
  const midnight = 86400 - (Math.floor(Date.now() / 1000) % 86400);
  const opp = enemies(pl.country);
  const allies = `<allicountry><allicountryid>${pl.country}</allicountryid></allicountry>`;
  const opps = `<oppecountry>${opp.map((c) => `<oppecountryid>${c}</oppecountryid>`).join('')}</oppecountry>`;
  return `<preview resttime="0" open="1" myCountryID="${pl.country}" fightlefttime="0" curintercost="10">${allies}${opps}</preview>` + allies + opps +
    '<user>' + el('maxalive', MAX_ALIVE) + el('restalive', m.alive) + el('totlepower', pw) + el('curpower', pw) + el('thistimepowe', pw) +
    el('score', m.score) + el('scorerank', rank) + el('killnum', m.kills) + el('rank', rank) + el('beattack', m.beattack) + el('beattackrank', 0) +
    el('beattackmerit', 0) + el('autowar', 0) + '</user>' +
    `<country><my killnum="${countryKills(db, pl.server_id, pl.country)}"/><he killnum="${opp.reduce((a, c) => a + countryKills(db, pl.server_id, c), 0)}"/></country>` +
    '<autoinfo>' + el('auto_cost1', 10) + el('auto_cost2', 50) + el('auto_cost3', 100) + el('auto_times2', 5) + el('auto_times3', 10) + '</autoinfo>';
}
function attack(db, pl) {
  const m = me(db, pl);
  if (m.alive <= 0) return { error: 'no lives left, revive or wait until tomorrow' };
  const opp = enemies(pl.country);
  const foe = db.prepare(`SELECT * FROM players WHERE server_id=? AND country IN (${opp.join(',')}) ORDER BY RANDOM() LIMIT 1`).get(pl.server_id);
  const mine = power(db, pl.uid, pl.server_id);
  const theirs = foe ? power(db, foe.uid, pl.server_id) : Math.round(mine * (0.6 + Math.random() * 0.6)); // guard bot when nobody is there
  const win = mine * (0.8 + Math.random() * 0.4) >= theirs;
  const score = win ? 20 : 5;
  game.propAdd(db, pl.uid, pl.server_id, 9994, win ? 10 : 2); // war exploit for the Reward shop
  db.prepare('UPDATE war SET score=score+?, kills=kills+?, alive=alive-? WHERE server_id=? AND day=? AND uid=?')
    .run(score, win ? 1 : 0, win ? 0 : 1, pl.server_id, day(), pl.uid);
  if (foe && win) { me(db, foe); db.prepare('UPDATE war SET beattack=beattack+1 WHERE server_id=? AND day=? AND uid=?').run(pl.server_id, day(), foe.uid); }
  db.prepare('INSERT INTO war_log(server_id,uid,tuid,fromnick,tonick,fromcountry,tocountry,win,score) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(pl.server_id, pl.uid, foe ? foe.uid : 0, pl.nick, foe ? foe.nick : 'Country Guard', pl.country, foe ? foe.country : opp[0], win ? 1 : 0, score);
  const coin = win ? 3000 : 500;
  db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, pl.server_id);
  const fight = game.battleXml(db, pl, 1, 1, { win, enemyName: foe ? foe.nick : 'Country Guard', enemyUid: foe ? foe.uid : 0, enemyLevel: foe ? foe.level : pl.level });
  // CWarInfoView reads only batter= from <CountryWar>; InitFromXML takes the ROOT, so userinfo/fight/award are root children.
  return { xml: `<CountryWar batter="${win ? 1 : 0}"/><userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>${fight}${game.awardFull({ coin })}` };
}
function revive(db, pl, cost = 20) {
  if (pl.gold < cost) return { error: 'not enough gold' };
  me(db, pl);
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  db.prepare('UPDATE war SET alive=? WHERE server_id=? AND day=? AND uid=?').run(MAX_ALIVE, pl.server_id, day(), pl.uid);
  return { xml: '' };
}

function resultXml(db, pl) {
  // <lastres><open>1</open> would pop yesterday's result dialog; there is no nightly war here, so keep it closed.
  const opp = enemies(pl.country);
  return '<winpace>' + el('canrequire', 0) + '</winpace><lastres>' + el('open', 0) + el('mycountrykill', countryKills(db, pl.server_id, pl.country)) +
    el('oppecountrykill', opp.reduce((a, c) => a + countryKills(db, pl.server_id, c), 0)) + '</lastres>' +
    `<allicountry><allicountryid>${pl.country}</allicountryid></allicountry><oppecountry>${opp.map((c) => `<oppecountryid>${c}</oppecountryid>`).join('')}</oppecountry>`;
}

// Scrolling war news (Cmd 7700, everyone) and my own fights (Cmd 7701). Children are text elements.
function msgXml(db, pl, mine) {
  ensure(db);
  const rows = mine
    ? db.prepare('SELECT * FROM war_log WHERE server_id=? AND (uid=? OR tuid=?) ORDER BY id DESC LIMIT 20').all(pl.server_id, pl.uid, pl.uid)
    : db.prepare('SELECT * FROM war_log WHERE server_id=? ORDER BY id DESC LIMIT 20').all(pl.server_id);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = rows.map((r) => '<warmsg>' + el('id', r.id) + el('fromnick', esc(r.fromnick)) + el('tonick', esc(r.tonick)) + el('fromcountry', r.fromcountry) +
    el('tocountry', r.tocountry) + el('killnum', r.win) + el('fromofficer', 0) + el('toofficer', 0) + el('msgtype', 1) + el('iswin', r.win) +
    el('score', r.score) + el('powernum', 0) + '</warmsg>').join('');
  return mine ? `<usermsglist>${items}</usermsglist>` : `<warmsglist>${items}</warmsglist>`;
}

// War exploit shop (Reward tab): warconfig rows of type 2 = [id, id, name, 2, slot, cost, dropid]. Exploit = players.meritscore (prop 9994).
function exchange(db, pl, packId) {
  const row = game.table('warconfig').rows.find((r) => r[0] === packId && r[3] === 2);
  if (!row) return { error: 'bad pack' };
  const have = game.propCounts(db, pl.uid, pl.server_id)[9994] || 0;
  if (have < row[5]) return { error: 'not enough exploit' };
  game.propAdd(db, pl.uid, pl.server_id, 9994, -row[5]);
  return { xml: game.grantDrop(db, pl, row[6]) };
}

module.exports = { exchange, msgXml, resultXml, infoXml, attack, revive };
