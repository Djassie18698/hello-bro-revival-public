// God Recruit (Event menu id 46, business_proxy/godRecruit_business -> ui_godRecruitLayer, rl_x_small_activity):
// a slot machine of god cards. Cmd 17 info, 18 spin (costs gold, lands on a card), 19 keep the card, 20 return it for gold + energy,
// 21 ChangeId = trade energy for a card. Game texts: "1. Receive god card in draw. 2. Receive gold and energy as compensation for
// unnecessary cards in return. 3. God cards can be exchanged by energy."
// The photos show the holiday headliners and 300 gold per gold draw (FINDINGS.md "Holiday events"). Everything else is (ours): the card
// line-up (holiday god cards this game version has), the former price shown crossed out, the return gold, energy per return and trade costs.
const game = require('./game');
const settings = require('./settings');

const PRICE = { old: 500, now: 300 };
// [slot id, ninja id, dropinfo id that gives the card, gold back on return, energy needed to trade for it (0 = not tradeable)]
const CARDS = [
  [1, 5037, 1851, 150, 300], // Santa of the Six Paths (God)
  [2, 5040, 1868, 150, 300], // Kaguya for New Year (God)
  [3, 2017, 1094, 120, 200], // Killer B (Santa Claus)
  [4, 2022, 1099, 120, 200], // Goddess Tsunade
  [5, 2097, 1643, 100, 150], // Goddess Sakura (God)
  [6, 2094, 1640, 100, 150], // Uzumaki Kushina (God)
  [7, 2106, 1656, 100, 0],   // Kyuubi Naruto (God)
  [8, 2030, 1464, 100, 0],   // Sage Naruto (God)
];
const ENERGY_PER_RETURN = 20;
const RUN_DAYS = 14;

const ensure = (db) => db.exec('CREATE TABLE IF NOT EXISTS godrecruit (uid INTEGER, server_id INTEGER, score INTEGER DEFAULT 0, pending INTEGER DEFAULT 0, last INTEGER DEFAULT 0, PRIMARY KEY(uid, server_id))');
function me(db, pl) {
  ensure(db);
  let r = db.prepare('SELECT * FROM godrecruit WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (!r) { db.prepare('INSERT INTO godrecruit(uid, server_id) VALUES(?,?)').run(pl.uid, pl.server_id); r = { score: 0, pending: 0, last: 0 }; }
  return r;
}
const save = (db, pl, f) => db.prepare(`UPDATE godrecruit SET ${Object.keys(f).map((k) => k + '=?').join(',')} WHERE uid=? AND server_id=?`).run(...Object.values(f), pl.uid, pl.server_id);
const on = (db) => settings.eventOn(db, 'godrecruit');
function leftTime(db) {
  const start = settings.switchedOnAt(db, 'godrecruit') || Math.floor(Date.now() / 1000);
  return Math.max(3600, start + RUN_DAYS * 86400 - Math.floor(Date.now() / 1000)); // keeps a little time while the owner leaves it on
}

function infoXml(db, pl) {
  if (!on(db)) return null;
  const m = me(db, pl);
  const list = CARDS.map(([id, card, drop, gold, need]) => `<item id="${id}" card_id="${card}" drop_id="${drop}" card_drop_gold="${gold}" card_exchange_point="${need}"/>`).join('');
  return `<basic><left_time>${leftTime(db)}</left_time><score>${m.score}</score><super_id>${m.last}</super_id><oldCash>${PRICE.old}</oldCash><newCash>${PRICE.now}</newCash></basic>` +
    `<card_info_list>${list}</card_info_list>`;
}
function spin(db, pl) {
  if (!on(db)) return { error: 'the event is over' };
  const m = me(db, pl);
  if (m.pending) keep(db, pl); // the game was closed before keep/return: the earlier card is kept
  if (pl.gold < PRICE.now) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(PRICE.now, pl.uid, pl.server_id);
  const pick = CARDS[Math.floor(Math.random() * CARDS.length)][0];
  save(db, pl, { pending: pick, last: pick });
  return { xml: `<id>${pick}</id><castCash>${PRICE.now}</castCash>` };
}
function keep(db, pl) {
  const m = me(db, pl);
  const c = CARDS.find((x) => x[0] === m.pending);
  if (!c) return { error: 'nothing to keep' };
  save(db, pl, { pending: 0 });
  return { xml: game.grantDrop(db, pl, c[2]) || game.awardFull({}) };
}
function giveBack(db, pl) {
  const m = me(db, pl);
  const c = CARDS.find((x) => x[0] === m.pending);
  if (!c) return { error: 'nothing to return' };
  db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(c[3], pl.uid, pl.server_id);
  save(db, pl, { pending: 0, score: m.score + ENERGY_PER_RETURN });
  const gold = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id).gold;
  return { xml: `<add_cash>${c[3]}</add_cash><left_cash>${gold}</left_cash><left_score>${m.score + ENERGY_PER_RETURN}</left_score>` };
}
function trade(db, pl, id) {
  if (!on(db)) return { error: 'the event is over' };
  const m = me(db, pl);
  const c = CARDS.find((x) => x[0] === id);
  if (!c || !c[4]) return { error: 'this card cannot be traded' };
  if (m.score < c[4]) return { error: 'not enough energy' };
  save(db, pl, { score: m.score - c[4] });
  return { xml: (game.grantDrop(db, pl, c[2]) || game.awardFull({})) + `<leftScore>${m.score - c[4]}</leftScore>` };
}

module.exports = { CARDS, infoXml, spin, keep, giveBack, trade };
