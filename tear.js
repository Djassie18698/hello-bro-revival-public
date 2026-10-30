// National treasure raids (CCountryTreasure, "tear"). Raid another country (rl_w_tearcountry ToCountry): if it has a
// guard you fight them, otherwise you grab a treasure directly. Treasures are turned in (rl_w_tear) for 5000 silver
// each. Any player can stand guard for their own country (rl_w_tearguard). 5 raids a day.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = () => new Date().toISOString().slice(0, 10);
const RAIDS = 5, SILVER_EACH = 5000;

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tear (server_id INTEGER, uid INTEGER, day TEXT, raids INTEGER DEFAULT 0, bank INTEGER DEFAULT 0,
      guard INTEGER DEFAULT 0, coin_his INTEGER DEFAULT 0, merit_his INTEGER DEFAULT 0, PRIMARY KEY(server_id, uid));
    CREATE TABLE IF NOT EXISTS tear_win (server_id INTEGER, day TEXT, from_country INTEGER, to_country INTEGER, n INTEGER DEFAULT 0, PRIMARY KEY(server_id, day, from_country, to_country))`);
}
function me(db, pl) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO tear(server_id,uid,day) VALUES(?,?,?)').run(pl.server_id, pl.uid, day());
  const t = db.prepare('SELECT * FROM tear WHERE server_id=? AND uid=?').get(pl.server_id, pl.uid);
  if (t.day !== day()) { db.prepare('UPDATE tear SET day=?, raids=0 WHERE server_id=? AND uid=?').run(day(), pl.server_id, pl.uid); t.raids = 0; t.day = day(); }
  return t;
}
const others = (c) => [1, 2, 3].filter((x) => x !== c);
function wins(db, sid, from, to) {
  const r = db.prepare('SELECT n FROM tear_win WHERE server_id=? AND day=? AND from_country=? AND to_country=?').get(sid, day(), from, to);
  return r ? r.n : 0;
}
function bankXml(db, pl) {
  const t = me(db, pl);
  const victory = others(pl.country).map((c) => `<country id="${c}" attack="${wins(db, pl.server_id, pl.country, c)}" defnese="${wins(db, pl.server_id, c, pl.country)}"/>`).join('');
  return '<trea><attack>' + el('canattack', t.raids < RAIDS ? 1 : 0) + el('resttime', 0) + el('restattacknum', RAIDS - t.raids) + '</attack>' +
    `<victory>${victory}</victory><award num="${t.bank}"/><awardhis coin="${t.coin_his}" merit="${t.merit_his}"/>` +
    '<country>' + el('count', t.bank) + el('isguard', t.guard) + '</country></trea>';
}
function snatchXml(db, pl) {
  ensure(db);
  const rows = [1, 2, 3].map((c) => {
    const tear = (db.prepare('SELECT SUM(n) n FROM tear_win WHERE server_id=? AND day=? AND from_country=?').get(pl.server_id, day(), c).n) || 0;
    const grab = (db.prepare('SELECT SUM(n) n FROM tear_win WHERE server_id=? AND day=? AND to_country=?').get(pl.server_id, day(), c).n) || 0;
    return `<country id="${c}">${el('tearnum', tear)}${el('grabnum', grab)}</country>`;
  }).join('');
  return `<countrylist>${rows}</countrylist>`;
}
function raid(db, pl, to) {
  const t = me(db, pl);
  if (!others(pl.country).includes(to)) return { error: 'pick an enemy country' };
  if (t.raids >= RAIDS) return { error: 'no raids left today' };
  db.prepare('UPDATE tear SET raids=raids+1 WHERE server_id=? AND uid=?').run(pl.server_id, pl.uid);
  const guard = db.prepare(`SELECT p.* FROM tear t JOIN players p ON p.uid=t.uid AND p.server_id=t.server_id
    WHERE t.server_id=? AND t.guard=1 AND p.country=? ORDER BY RANDOM() LIMIT 1`).get(pl.server_id, to);
  let win = true;
  let fight = '';
  if (guard) {
    const pw = (uid) => { const s = game.teamStats(db, uid, pl.server_id).total; return s.al + s.ah + s.dl + s.dh; };
    win = pw(pl.uid) * (0.8 + Math.random() * 0.4) >= pw(guard.uid);
    fight = game.battleXml(db, pl, 1, 1, { win, enemyName: guard.nick, enemyUid: guard.uid, enemyLevel: guard.level });
  }
  if (win) {
    db.prepare('UPDATE tear SET bank=bank+1 WHERE server_id=? AND uid=?').run(pl.server_id, pl.uid);
    db.prepare('INSERT INTO tear_win(server_id,day,from_country,to_country,n) VALUES(?,?,?,?,1) ON CONFLICT DO UPDATE SET n=n+1').run(pl.server_id, day(), pl.country, to);
  }
  return { xml: `<tear direct="${guard ? 0 : 1}"/><userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>${fight}${game.awardFull({})}` +
    `<oppe>${el('nick', esc(guard ? guard.nick : ''))}</oppe>` };
}
function handin(db, pl) {
  const t = me(db, pl);
  if (t.bank <= 0) return { error: 'no treasure to turn in' };
  const coin = t.bank * SILVER_EACH, merit = t.bank * 10;
  db.prepare('UPDATE tear SET bank=0, coin_his=coin_his+?, merit_his=merit_his+? WHERE server_id=? AND uid=?').run(coin, merit, pl.server_id, pl.uid);
  db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, pl.server_id);
  game.propAdd(db, pl.uid, pl.server_id, 9994, merit);
  return { xml: `<award coin="${coin}" merit="${merit}"/>` + snatchXml(db, pl) };
}
function toggleGuard(db, pl) {
  const t = me(db, pl);
  db.prepare('UPDATE tear SET guard=? WHERE server_id=? AND uid=?').run(t.guard ? 0 : 1, pl.server_id, pl.uid);
  return { xml: '<guard direct="1"/>' };
}

module.exports = { bankXml, snatchXml, raid, handin, toggleGuard };
