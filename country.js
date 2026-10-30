// Country officials (War building > Country tab): 7 seats per country (1 Hokage, 2-3 Custodians, 4-7 Elders).
// An empty seat is taken directly; an occupied seat is a fight against its holder (team power + luck).
// A player holds at most one seat. Officials get a daily salary (rl_w_countrynew reward).
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SALARY = { 1: 3000, 2: 1500, 3: 1500, 4: 800, 5: 800, 6: 800, 7: 800 }; // gold per day
const day = () => new Date().toISOString().slice(0, 10);

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS officials (server_id INTEGER, country INTEGER, seat INTEGER, uid INTEGER, PRIMARY KEY(server_id, country, seat));
    CREATE TABLE IF NOT EXISTS salary (uid INTEGER, server_id INTEGER, day TEXT, PRIMARY KEY(uid, server_id, day))`);
}
function seats(db, pl) {
  ensure(db);
  return db.prepare('SELECT o.seat, o.uid, p.nick FROM officials o JOIN players p ON p.uid=o.uid AND p.server_id=o.server_id WHERE o.server_id=? AND o.country=?').all(pl.server_id, pl.country);
}
function mySeat(db, pl) {
  ensure(db);
  const r = db.prepare('SELECT seat FROM officials WHERE server_id=? AND country=? AND uid=?').get(pl.server_id, pl.country, pl.uid);
  return r ? r.seat : 0;
}
function infoXml(db, pl) {
  const list = seats(db, pl).map((s) => `<offical>${el('id', s.seat)}${el('nick', esc(s.nick))}${el('uid', s.uid)}</offical>`).join('');
  const seat = mySeat(db, pl);
  const got = db.prepare('SELECT 1 FROM salary WHERE uid=? AND server_id=? AND day=?').get(pl.uid, pl.server_id, day());
  const midnight = 86400 - (Math.floor(Date.now() / 1000) % 86400);
  return `<display>0</display><pack>${el('canget', seat && !got ? 1 : 0)}${el('resttime', seat && !got ? 0 : midnight)}</pack>${el('resttime', midnight)}` +
    `<officallist>${list}</officallist><decllist><has_decl>0</has_decl><allicountry></allicountry><oppecountry></oppecountry></decllist>` +
    '<timeinfo><begin>0</begin><end>0</end></timeinfo>';
}
const power = (db, uid, sid) => { const t = game.teamStats(db, uid, sid).total; return (t.al + t.ah + t.dl + t.dh) / 2; };

function take(db, pl, seat) {
  ensure(db);
  if (!(seat >= 1 && seat <= 7)) return { error: 'bad seat' };
  const holder = db.prepare('SELECT uid FROM officials WHERE server_id=? AND country=? AND seat=?').get(pl.server_id, pl.country, seat);
  if (holder && holder.uid === pl.uid) return { error: 'you already hold this seat' };
  const free = () => db.prepare('DELETE FROM officials WHERE server_id=? AND uid=?').run(pl.server_id, pl.uid);
  const sit = () => db.prepare('INSERT OR REPLACE INTO officials VALUES(?,?,?,?)').run(pl.server_id, pl.country, seat, pl.uid);
  if (!holder) { free(); sit(); return { xml: '<officaltake direct="1"></officaltake>' }; }
  const enemy = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(holder.uid, pl.server_id);
  const win = power(db, pl.uid, pl.server_id) * (0.8 + Math.random() * 0.4) >= power(db, holder.uid, pl.server_id);
  if (win) {
    const old = mySeat(db, pl);
    free(); sit();
    if (old) db.prepare('INSERT OR REPLACE INTO officials VALUES(?,?,?,?)').run(pl.server_id, pl.country, old, holder.uid); // swap seats
  }
  const fight = game.battleXml(db, pl, 1, 1, { win, enemyName: enemy ? enemy.nick : 'Official', enemyUid: holder.uid, enemyLevel: enemy ? enemy.level : 1 });
  return { xml: '<officaltake direct="0">' + fight.replace(/^<fight>/, '').replace(/<\/fight>$/, '') + '</officaltake>' };
}
function salary(db, pl) {
  const seat = mySeat(db, pl);
  if (!seat) return { error: 'only officials get a salary' };
  const ok = db.prepare('INSERT OR IGNORE INTO salary VALUES(?,?,?)').run(pl.uid, pl.server_id, day()).changes;
  if (!ok) return { error: 'already collected today' };
  // Like the original: a reward box. Hokage: 5-star card / 4-star card / 500 gold, with a small chance at Sage of the Six Paths.
  const pool = seat === 1 ? [11, 11, 371, 371, 352, 374] : seat <= 3 ? [371, 372, 352] : [372, 372, 107];
  const drop = seat === 1 && Math.random() < 0.05 ? 0 : pool[Math.floor(Math.random() * pool.length)];
  if (!drop) { const seq = game.giveCard(db, pl.uid, pl.server_id, 1); return { xml: game.awardXml({ ninja: 1, seq }) }; }
  return { xml: game.grantDrop(db, pl, drop) };
}

// War > Ranking: Individuals (power ranking, all countries or one) and Nations (wins/losses, king = Hokage nick).
function rankXml(db, pl, cmd, countryFilter) {
  ensure(db);
  if (cmd !== 4200) {
    const rows = db.prepare('SELECT uid, nick, country FROM players WHERE server_id=?' + (countryFilter ? ' AND country=?' : ''))
      .all(...[pl.server_id].concat(countryFilter ? [countryFilter] : [])).map((r) => ({ ...r, power: Math.round(power(db, r.uid, pl.server_id)) }))
      .sort((a, b) => b.power - a.power).slice(0, 50);
    const me = rows.findIndex((r) => r.uid === pl.uid) + 1;
    const users = rows.map((r, i) => `<user>${el('rank', i + 1)}${el('uid', r.uid)}${el('nick', esc(r.nick))}${el('power', r.power)}${el('countryid', r.country)}</user>`).join('');
    return `<userrank myrank="${me}" curpage="1"><userlist>${users}</userlist></userrank>`;
  }
  const countries = [1, 2, 3].map((c) => {
    const king = db.prepare('SELECT p.nick FROM officials o JOIN players p ON p.uid=o.uid AND p.server_id=o.server_id WHERE o.server_id=? AND o.country=? AND o.seat=1').get(pl.server_id, c);
    return `<country>${el('id', c)}${el('king', esc(king ? king.nick : ''))}${el('winnum', 0)}${el('falinum', 0)}</country>`;
  }).join('');
  return `<countryrank>${countries}</countryrank>`;
}

module.exports = { rankXml, infoXml, take, salary, mySeat };
