// "Great gift for total recharge" (Event menu id 11 "Timed Gift", accumulateMoney_business -> ui_accumulateMoneyLayer):
// rl_r_pay_cumula = <cf><item><id/><need/><name1/><icon1/><drop1/><newlife1/> x4</item>...</cf><user><giftIdsGot>1|2</giftIdsGot><sum/><timeLeft/></user>
// (the client reads the first two children of each <item> as id and amount); claim = rl_w_activity Cmd 9100 ActType 6 SubID id.
// ORIGINAL (Facebook photo 1238): 48 h event; top up $240: Kyuubi Minato(A) + Shakujo + 160 Reincarnation Pills + 100 Souls Dan;
// $420: 2nd-Rebirth Hokage Kakashi (God) + 250 Super Ninja Pills + 200 Development Dan + 200 Reincarnation Pills;
// $750: 7th-Rebirth Kaguya (God) + 500 Sage Stone III + 400 Reincarnation Pills + 300 Souls Dan. The amount is the dollars topped up
// while it runs (top-ups are free here). (ours): the cards picked by the photo's faces (The Fourth Sage ATK = golden Kyuubi Minato, Hokage Kakashi, Kaguya).
const game = require('./game');
const settings = require('./settings');

const RUN_HOURS = 48;
// [id, dollars, [[label, icon, shown drop, newlife, [drops paid]]]]
const GIFTS = [
  [1, 240, [['Kyuubi Minato(A)', 'icon_npc42_6', 1096, 0, [1096]], ['Shakujo', 'small_weapon_033', 552, 0, [552]],
    ['160', 'props_033', 1456, 0, [1456]], ['100', 'props_260', 1801, 0, [1801]]]],
  [2, 420, [['2nd-Rebirth(G)', 'icon_npc300_8', 1728, 2, [1728]], ['250', 'props_145', 936, 0, [936, 936, 906]],
    ['200', 'props_229', 1673, 0, [1673]], ['200', 'props_033', 1367, 0, [1367]]]],
  [3, 750, [['7th-Rebirth(G)', 'icon_npc300_1', 1587, 7, [1587]], ['500', 'props_035', 1374, 0, [1374]],
    ['400', 'props_033', 1367, 0, [1367, 1367]], ['300', 'props_260', 1820, 0, [1820, 1801]]]],
];
const el = (k, v) => `<${k}>${v}</${k}>`;
const now = () => Math.floor(Date.now() / 1000);
const start = (db) => settings.switchedOnAt(db, 'totalgift') || now();
const left = (db) => Math.max(0, start(db) + RUN_HOURS * 3600 - now());

function ensure(db) {
  require('./limited').ensure(db);
  db.exec('CREATE TABLE IF NOT EXISTS totalgift_claim (uid INTEGER, server_id INTEGER, run INTEGER, gift INTEGER, PRIMARY KEY(uid, server_id, run, gift))');
}
const dollars = (db, pl) => Math.floor(db.prepare('SELECT COALESCE(SUM(cents),0) n FROM topup_log WHERE uid=? AND server_id=? AND at>=?').get(pl.uid, pl.server_id, start(db)).n / 100);
const claimed = (db, pl) => db.prepare('SELECT gift FROM totalgift_claim WHERE uid=? AND server_id=? AND run=?').all(pl.uid, pl.server_id, start(db)).map((r) => r.gift);

function listXml(db, pl) {
  if (!settings.eventOn(db, 'totalgift')) return null;
  ensure(db);
  const items = GIFTS.map(([id, need, slots]) => '<item>' + el('id', id) + el('need', need) +
    slots.map(([name, icon, drop, nl], i) => el('name' + (i + 1), name) + el('icon' + (i + 1), icon) + el('drop' + (i + 1), drop) + el('newlife' + (i + 1), nl)).join('') + '</item>').join('');
  return `<cf>${items}</cf><user>${el('giftIdsGot', claimed(db, pl).join('|'))}${el('sum', dollars(db, pl))}${el('timeLeft', left(db))}</user>`;
}

function claim(db, pl, id) {
  if (!settings.eventOn(db, 'totalgift') || !left(db)) return { error: 'The event has expired' };
  ensure(db);
  const g = GIFTS.find((x) => x[0] === id);
  if (!g) return { error: 'no such gift' };
  if (claimed(db, pl).includes(id)) return { error: 'This reward has already been redeemed' };
  if (dollars(db, pl) < g[1]) return { error: 'Recharge amount is insufficient, please redeem after recharge.' };
  db.prepare('INSERT INTO totalgift_claim VALUES (?,?,?,?)').run(pl.uid, pl.server_id, start(db), id);
  const awards = [];
  for (const [, , , nl, drops] of g[2]) for (const d of drops) {
    let a = game.grantDrop(db, pl, d);
    if (a && nl) { // a rebirth card: set its rebirth grade (the card was just made, so it is the newest seq)
      const seq = Number((a.match(/<bagIndex>(\d+)<\/bagIndex>/) || [])[1]);
      if (seq) db.prepare('UPDATE cards SET newlife=? WHERE seq=?').run(nl, seq);
      a = a.replace('<newlife>0</newlife>', el('newlife', nl));
    }
    if (a) awards.push(a);
  }
  return { xml: game.mergeAwards(awards) };
}

module.exports = { listXml, claim, ensure };
