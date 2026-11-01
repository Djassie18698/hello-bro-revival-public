// Gold spending event "Cumulative gold" (Event menu id 37, business_proxy/consumption_business -> ui_consumptionLayer):
// rl_r_comm Cmd 13 = <basic><cash>gold spent</cash><remain>seconds</remain></basic><award><item id cash status drop1-4 name1-4 icon1-4/>...</award>,
// rl_w_comm Cmd 18 ID = claim a tier (status 1 claimable, 2 not reached, 3 claimed).
// Tiers and rewards are the ORIGINAL ones from the owner's Facebook group photos (FINDINGS.md, photo 0347). The gold of the lowest tier was
// not readable ("one below 8000"): 3000 is (ours), and its "100 pills" are read as Super Ninja Pills (ours).
const game = require('./game');
const settings = require('./settings');

const RUN_DAYS = 14;
// reward = { drop } (dropinfo id) or { prop, n, show } (n of an item; `show` = a dropinfo id of that item for the icon)
const TIERS = [
  [1, 3000, [{ drop: 1646 }, { drop: 1122 }, { prop: 28, n: 100, show: 936 }, { drop: 120 }]],             // Hinata (God), Shinra Tensei, 100 Super Ninja Pills, 70 Reincarnation Pills
  [2, 8000, [{ drop: 1460 }, { drop: 1123, name: 'Outer Path' }, { prop: 35, n: 60, show: 1906 }, { prop: 34, n: 100, show: 1673 }]], // Gaara (God), Outer Path, 60 Souls Dan, 100 Development Dan
  [3, 13000, [{ drop: 1975 }, { drop: 1125 }, { prop: 35, n: 100, show: 1906 }, { prop: 28, n: 150, show: 936 }]], // Sasuke and Sakura (G), Chibaku Tensei, 100 Souls Dan, 150 Super Ninja Pills
  [4, 30000, [{ drop: 2111 }, { drop: 1126 }, { drop: 1820 }, { drop: 1791 }]],                            // Susa Indra (G), Rinnegan, 200 Souls Dan, 300 Reincarnation Pills
];

// Every drop in a player's gold is logged by a trigger, so all gold spending counts (shop, recruits, events...).
function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS gold_spent (uid INTEGER, server_id INTEGER, at INTEGER, amount INTEGER);
    CREATE INDEX IF NOT EXISTS gold_spent_uid ON gold_spent(uid, server_id, at);
    CREATE TRIGGER IF NOT EXISTS gold_spent_log AFTER UPDATE OF gold ON players WHEN NEW.gold < OLD.gold
    BEGIN INSERT INTO gold_spent VALUES (NEW.uid, NEW.server_id, CAST(strftime('%s','now') AS INTEGER), OLD.gold - NEW.gold); END;
    CREATE TABLE IF NOT EXISTS consumption_claim (uid INTEGER, server_id INTEGER, run INTEGER, tier INTEGER, PRIMARY KEY(uid, server_id, run, tier))`);
}
const on = (db) => settings.eventOn(db, 'consumption');
const start = (db) => settings.switchedOnAt(db, 'consumption') || Math.floor(Date.now() / 1000);
const spent = (db, pl) => db.prepare('SELECT COALESCE(SUM(amount),0) n FROM gold_spent WHERE uid=? AND server_id=? AND at>=?').get(pl.uid, pl.server_id, start(db)).n;
const claimed = (db, pl, tier) => !!db.prepare('SELECT 1 FROM consumption_claim WHERE uid=? AND server_id=? AND run=? AND tier=?').get(pl.uid, pl.server_id, start(db), tier);

const dropRow = (id) => game.table('dropinfo').rows.find((x) => x[0] === id) || [];
const itemName = (id) => (game.table('consumeinfo').rows.find((r) => r[1] === id) || [])[2] || '';
const rewardName = (r) => String(r.name || (r.prop ? `${itemName(r.prop)}*${r.n}` : dropRow(r.drop)[2] || '')).replace(/[<>&"]/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')');

function infoXml(db, pl) {
  if (!on(db)) return null;
  ensure(db);
  const have = spent(db, pl);
  const left = Math.max(3600, start(db) + RUN_DAYS * 86400 - Math.floor(Date.now() / 1000));
  const items = TIERS.map(([id, cash, rewards]) => {
    const status = claimed(db, pl, id) ? 3 : have >= cash ? 1 : 2;
    const attrs = rewards.map((r, i) => ` drop${i + 1}="${r.drop || r.show}" name${i + 1}="${rewardName(r)}" icon${i + 1}=""`).join('');
    return `<item id="${id}" cash="${cash}" status="${status}"${attrs}/>`;
  }).join('');
  return `<basic><cash>${have}</cash><remain>${left}</remain></basic><award>${items}</award>`;
}
function claim(db, pl, id) {
  if (!on(db)) return { error: 'the event is over' };
  ensure(db);
  const t = TIERS.find((x) => x[0] === id);
  if (!t) return { error: 'no such reward' };
  if (claimed(db, pl, id)) return { error: 'already claimed' };
  if (spent(db, pl) < t[1]) return { error: 'spend more gold first' };
  db.prepare('INSERT INTO consumption_claim VALUES(?,?,?,?)').run(pl.uid, pl.server_id, start(db), id);
  const awards = t[2].map((r) => {
    if (!r.prop) return game.grantDrop(db, pl, r.drop) || '';
    game.propAdd(db, pl.uid, pl.server_id, r.prop, r.n);
    return require('./drops').awardXml({ cards: [], props: { [r.prop]: r.n }, coin: 0, cash: 0 }, r.show);
  }).filter(Boolean);
  return { xml: game.mergeAwards(awards) };
}

module.exports = { ensure, infoXml, claim };
