// Scratch card ("Lottery" tab in the Event menu, activity 7 = ScratchCardActivity.lua -> ui_scratchCardLayer) on rl_w_guaguale.
// Cmd 1700 = info: <root free="N" usercash="gold">. Cmd 1701 = buy one card (20 gold, the client's own price, or a free chance):
// <root usercash="gold left"><win cash="prize"/><cards><card><id/><cash/><icon/></card> x9</cards></root>; the client pays out
// every amount that shows 3 or more times and checks that it equals <win cash>.
// ORIGINAL (Facebook photos 0425, 1658, 1729, 2313): 3x3 cards with ninja faces, "Scratch out 3 identical cards to get great
// rewards", prizes 5 / 20 / 50 / 150 / 500 / 800 gold, "Free chances". The odds and 1 free card a day are (ours).
const game = require('./game');

const COST = 20, FREE_A_DAY = 1;
const PRIZES = [[800, 0.5], [500, 1], [150, 2.5], [50, 8], [20, 18], [5, 22]]; // [gold, % chance]; else no prize (ours)
const AMOUNTS = PRIZES.map((p) => p[0]);
const el = (k, v) => `<${k}>${v}</${k}>`;

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS scratch (uid INTEGER, server_id INTEGER, day TEXT, used_free INTEGER, PRIMARY KEY(uid, server_id))');
}
const today = () => new Date().toISOString().slice(0, 10);
function freeLeft(db, pl) {
  ensure(db);
  const r = db.prepare('SELECT * FROM scratch WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  return Math.max(0, FREE_A_DAY - (r && r.day === today() ? r.used_free : 0));
}
function infoXml(db, pl) { return `<root code="0" free="${freeLeft(db, pl)}" usercash="${pl.gold}"></root>`; }

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function roll() {
  let x = Math.random() * 100;
  for (const [g, pct] of PRIZES) { if ((x -= pct) < 0) return g; }
  return 0;
}
// 9 cells: the prize (if any) three times, every other amount at most twice, so exactly one amount (or none) wins.
function board(win) {
  const cells = win ? [win, win, win] : [];
  const others = shuffle(AMOUNTS.filter((g) => g !== win).flatMap((g) => [g, g]));
  while (cells.length < 9) cells.push(others.pop());
  return shuffle(cells);
}

function play(db, pl) {
  const free = freeLeft(db, pl) > 0;
  if (!free && pl.gold < COST) return { error: 'not enough gold' };
  const win = roll();
  const cells = board(win);
  // one ninja face per amount (from the game's own icons), so 3 same faces = 3 same amounts like the photos
  const faces = shuffle([...game.ninjas().values()].filter((n) => n[11] >= 4 && /^npc\d+_\d$/.test(n[3])).map((n) => 'icon_' + n[3]));
  const face = Object.fromEntries(AMOUNTS.map((g, i) => [g, faces[i % faces.length]]));
  if (free) db.prepare('INSERT INTO scratch VALUES (?,?,?,1) ON CONFLICT(uid, server_id) DO UPDATE SET used_free = CASE WHEN day = excluded.day THEN used_free + 1 ELSE 1 END, day = excluded.day').run(pl.uid, pl.server_id, today());
  const gold = pl.gold - (free ? 0 : COST) + win;
  db.prepare('UPDATE players SET gold=? WHERE uid=? AND server_id=?').run(gold, pl.uid, pl.server_id);
  game.bumpTask(db, pl.uid, pl.server_id, 9); // daily task "Scratch card 3 times"
  const cards = cells.map((g, i) => `<card>${el('id', i + 1)}${el('cash', g)}${el('icon', face[g])}</card>`).join('');
  return { xml: `<root code="0" usercash="${gold}"><win cash="${win}"/><cards>${cards}</cards></root>` };
}

module.exports = { infoXml, play };
