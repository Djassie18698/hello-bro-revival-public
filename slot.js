// Slot machine ("Super draw"): spend gold per spin, win gold on matching reels, earn points to exchange for packs.
const game = require('./game');
const COST = 10, BETS = [1, 2, 5, 10];
const PACKS = [
  { id: 1, score: 100, coin: 20000 }, { id: 2, score: 300, coin: 80000 }, { id: 3, score: 1000, cash: 500 },
];
const el = (n, v) => `<${n}>${v}</${n}>`;
function st(db, pl) {
  db.exec('CREATE TABLE IF NOT EXISTS slot (uid INTEGER, server_id INTEGER, score INTEGER DEFAULT 0, bet INTEGER DEFAULT 0, last INTEGER DEFAULT 0, got TEXT DEFAULT "", PRIMARY KEY(uid,server_id))');
  db.prepare('INSERT OR IGNORE INTO slot(uid,server_id) VALUES(?,?)').run(pl.uid, pl.server_id);
  return db.prepare('SELECT * FROM slot WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
}
const basic = (m, extra = '') => `<basic>${el('score', m.score)}${el('bet_cost', COST * BETS[m.bet])}${el('cost', COST)}${el('times', BETS[m.bet])}${el('remain', 86400)}${extra}</basic>`;
function info(db, pl) {
  const m = st(db, pl);
  const ninjas = [1, 2, 3, 4, 5].map((i) => `<ninja>${el('icon', 'npc0' + i + '_1')}${el('cash', 100 * i * 5)}</ninja>`).join('');
  return basic(m) + `<ninjas>${ninjas}</ninjas>`;
}
function bet(db, pl) {
  const m = st(db, pl), b = (m.bet + 1) % BETS.length;
  db.prepare('UPDATE slot SET bet=? WHERE uid=? AND server_id=?').run(b, pl.uid, pl.server_id);
  return el('times', BETS[b]) + el('bet_cost', COST * BETS[b]);
}
function spin(db, pl) {
  const m = st(db, pl), mult = BETS[m.bet], cost = COST * mult;
  if (pl.gold < cost) return { error: 'not enough gold' };
  const pos = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 5));
  const win = pos[0] === pos[1] && pos[1] === pos[2] ? 100 * pos[0] * 5 * mult : (pos[0] === pos[1] || pos[1] === pos[2] ? 10 * mult : 0);
  db.prepare('UPDATE players SET gold=gold-?+? WHERE uid=? AND server_id=?').run(cost, win, pl.uid, pl.server_id);
  db.prepare('UPDATE slot SET score=score+?, last=? WHERE uid=? AND server_id=?').run(mult, win, pl.uid, pl.server_id);
  const m2 = st(db, pl);
  return { xml: basic(m2).replace(/<remain>.*<\/remain>/, `<remain>86400</remain>${el('cash', win)}`) + `<slot>${el('pos1', pos[0])}${el('pos2', pos[1])}${el('pos3', pos[2])}</slot>` + game.awardFull({ cash: win }) };
}
function listXml(db, pl) {
  const m = st(db, pl);
  const got = new Set(m.got.split(',').filter(Boolean).map(Number));
  return basic(m) + PACKS.map((p) => `<package>${el('id', p.id)}${el('score', p.score)}${el('status', got.has(p.id) ? 2 : m.score >= p.score ? 1 : 0)}</package>`).join('');
}
function exchange(db, pl, id) {
  const m = st(db, pl), p = PACKS.find((x) => x.id === id);
  if (!p) return { error: 'bad pack' };
  const got = m.got.split(',').filter(Boolean).map(Number);
  if (got.includes(id) || m.score < p.score) return { error: 'not available' };
  db.prepare('UPDATE slot SET got=? WHERE uid=? AND server_id=?').run([...got, id].join(','), pl.uid, pl.server_id);
  if (p.coin) db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(p.coin, pl.uid, pl.server_id);
  if (p.cash) db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(p.cash, pl.uid, pl.server_id);
  return { xml: game.awardFull({ coin: p.coin || 0, cash: p.cash || 0 }) };
}
module.exports = { info, bet, spin, listXml, exchange };
