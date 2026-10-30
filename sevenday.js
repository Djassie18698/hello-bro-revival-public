// Seven-day goals (activity 17, ui_sevenDayView.lua; hidden by the v28 tables, re-enabled by the 28.0.4 hot update).
// Day d (by account age, like the login rewards) has 1-3 quests from sevendays_info; when they are all done the day's
// reward (3 drops) can be claimed on day d or d+1. rl_r_activity Cmd 9002 = state, rl_w_activity Cmd 9100 ActType 7 = claim.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS sevenday (uid INTEGER, server_id INTEGER, day INTEGER, PRIMARY KEY(uid, server_id, day))');
}
const loginDays = (pl) => Math.max(1, Math.floor((Date.now() - (pl.created || Date.now())) / 86400000) + 1);

// sevendays_quest row: [id, id, type, text, target]. Types the server tracks are checked; the rest count as done.
function questDone(db, pl, q) {
  const [, , type, , target] = q;
  const stats = () => game.teamStats(db, pl.uid, pl.server_id).total;
  const maxLevel = () => (db.prepare('SELECT MAX(c.level) n FROM team t JOIN cards c ON c.seq=t.seq WHERE t.uid=? AND t.server_id=?').get(pl.uid, pl.server_id).n) || 0;
  switch (type) {
    case 1: return pl.level >= target;
    case 2: return maxLevel() >= target;
    case 8: {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='arena'").get()) return false;
      const r = db.prepare('SELECT rank FROM arena WHERE uid=?').get(pl.uid);
      return !!r && r.rank <= target;
    }
    case 9: return stats().ah >= target;
    case 10: return stats().dh >= target;
    case 12: {
      db.exec('CREATE TABLE IF NOT EXISTS tear (server_id INTEGER, uid INTEGER, day TEXT, raids INTEGER DEFAULT 0, bank INTEGER DEFAULT 0, guard INTEGER DEFAULT 0, coin_his INTEGER DEFAULT 0, merit_his INTEGER DEFAULT 0, PRIMARY KEY(server_id, uid))');
      const t = db.prepare('SELECT coin_his FROM tear WHERE server_id=? AND uid=?').get(pl.server_id, pl.uid);
      return !!t && t.coin_his / 3000 >= target;
    }
    default: return true;
  }
}
const info = () => game.table('sevendays_info').rows;
const quests = (day) => { const r = info().find((x) => x[1] === day); return r ? [r[3], r[4], r[5]].filter((id) => id > 0) : []; };
const questRow = (id) => game.table('sevendays_quest').rows.find((x) => x[0] === id);

function stateXml(db, pl) {
  ensure(db);
  const got = new Set(db.prepare('SELECT day FROM sevenday WHERE uid=? AND server_id=?').all(pl.uid, pl.server_id).map((r) => r.day));
  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const t = quests(d).map((id) => '<t>' + el('id', id) + el('st', questDone(db, pl, questRow(id)) ? 1 : 0) + '</t>').join('');
    return '<item>' + el('day', d) + el('reward', got.has(d) ? 1 : 0) + `<tlist>${t}</tlist></item>`;
  }).join('');
  return `<seven_target>${days}</seven_target>`;
}
function claim(db, pl, day) {
  ensure(db);
  const row = info().find((x) => x[1] === day);
  if (!row) return { error: 'bad day' };
  const now = loginDays(pl);
  if (now < day) return { error: 'not unlocked yet' };
  if (now > day + 1) return { error: 'this reward has expired' };
  if (!quests(day).every((id) => questDone(db, pl, questRow(id)))) return { error: 'finish all goals first' };
  if (!db.prepare('INSERT OR IGNORE INTO sevenday VALUES(?,?,?)').run(pl.uid, pl.server_id, day).changes) return { error: 'already claimed' };
  // row: [id, day, ?, q1, q2, q3, drop1, pic1, num1, drop2, pic2, num2, drop3, pic3, num3]; each drop already holds its amount.
  const awards = [row[6], row[9], row[12]].filter((d) => d > 0).map((d) => game.grantDrop(db, pl, d)).filter(Boolean);
  return { xml: game.mergeAwards(awards) };
}

module.exports = { stateXml, claim, loginDays };
