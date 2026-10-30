// Pets / summoning beasts (Base > Pets, ui_pet*.lua; rl_x_pet). Free play: every player owns all 8 pets from petinfo,
// plus starter grain (prop 36, levels) and nostrum (prop 37, ranks). Pets open at level 30 (hot update). One master pet and up to 8 helper slots (unlocked
// at player level 1/30/40/.../90) add stats to the team (master 50%, helpers 15%), see teamBonus.
// Cmds: 1/3 pet list, 2 summon circle, 4 training info, 5 train (Type 1 normal / 2 special), 6 level info, 7 level up,
// 8 rank info, 9 rank up, 10 put PetID in a free helper slot, 11 make PetID master, 12/13 swap PetID for DstPetID.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const GRAIN = 36, NOSTRUM = 37, STARTER = 200;
const MAX_LEVEL = 50, MAX_RANK = 10, MAX_STAR = 5; // the training screen draws 5 stars
const SLOT_LV = [1, 30, 40, 50, 60, 70, 80, 90]; // same as the 28.0.6 hot update of ui_petPsychicLayer.lua
const TRAIN = { 1: { cost: 5, exp: 60 }, 2: { cost: 20, exp: 260 } };

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, server_id INTEGER, pet_id INTEGER,
    level INTEGER DEFAULT 1, rank INTEGER DEFAULT 0, star INTEGER DEFAULT 0, train INTEGER DEFAULT 0, slot INTEGER DEFAULT -1)`);
}
function all(db, pl) {
  ensure(db);
  let rows = db.prepare('SELECT * FROM pets WHERE uid=? AND server_id=? ORDER BY id').all(pl.uid, pl.server_id);
  if (!rows.length) { // first visit: hand out every pet and some food
    const ins = db.prepare('INSERT INTO pets(uid,server_id,pet_id,slot) VALUES(?,?,?,?)');
    game.table('petinfo').rows.forEach((r, i) => ins.run(pl.uid, pl.server_id, r[0], i === 0 ? 0 : -1));
    game.propAdd(db, pl.uid, pl.server_id, GRAIN, STARTER);
    game.propAdd(db, pl.uid, pl.server_id, NOSTRUM, STARTER);
    rows = db.prepare('SELECT * FROM pets WHERE uid=? AND server_id=? ORDER BY id').all(pl.uid, pl.server_id);
  }
  return rows;
}
const info = (petId) => game.table('petinfo').rows.find((r) => r[0] === petId);
// petinfo [9..11] = base attack/defense/chakra; +4% of base per level; petupgradeequ [5..7] = flat bonus at a rank;
// petupgradestar [3] / 50 = % buff at a star.
function stats(p) {
  const r = info(p.pet_id) || [];
  const eq = game.table('petupgradeequ').rows.find((x) => x[0] === p.rank);
  const st = game.table('petupgradestar').rows.find((x) => x[0] === p.star);
  const base = (i) => Math.round((r[i] || 0) * (1 + 0.04 * (p.level - 1))) + (eq ? eq[5 + i - 9] : 0);
  const buff = st ? Math.round(st[3] / 50) : 0;
  return { attack: base(9), defense: base(10), chakala: base(11), attack_buff: buff, defense_buff: buff, chakala_buff: buff };
}
const statXml = (s) => Object.entries(s).map(([k, v]) => el(k, v)).join('');
const petXml = (p) => '<pet>' + el('id', p.id) + el('pet_id', p.pet_id) + el('level', p.level) + el('rank', p.rank) + el('star', p.star) +
  statXml(stats(p)) + el('work', p.slot >= 0 ? 1 : 0) + '</pet>';
const one = (db, pl, id) => all(db, pl).find((p) => p.id === id);
const cnt = (db, pl, prop) => game.propCounts(db, pl.uid, pl.server_id)[prop] || 0;

function listXml(db, pl) { return `<pets>${all(db, pl).map(petXml).join('')}</pets>`; }
// Stats the pets give the team (also shown on the summon circle).
function teamBonus(db, uid, sid) {
  ensure(db);
  const t = { attack: 0, defense: 0, chakala: 0 };
  for (const p of db.prepare('SELECT * FROM pets WHERE uid=? AND server_id=? AND slot>=0').all(uid, sid)) {
    const s = stats(p), f = p.slot === 0 ? 0.5 : 0.15;
    t.attack += Math.round(s.attack * (1 + s.attack_buff / 100) * f);
    t.defense += Math.round(s.defense * (1 + s.defense_buff / 100) * f);
    t.chakala += Math.round(s.chakala * (1 + s.chakala_buff / 100) * f);
  }
  return t;
}
function circleXml(db, pl) {
  const rows = all(db, pl);
  const master = rows.find((p) => p.slot === 0);
  const slots = SLOT_LV.map((_, i) => { const p = rows.find((x) => x.slot === i + 1); return `<pet id="${p ? p.id : 0}" pet_id="${p ? p.pet_id : 0}"/>`; }).join('');
  return `<basic>${statXml(teamBonus(db, pl.uid, pl.server_id))}</basic><master>${el('id', master ? master.id : 0)}${el('pet_id', master ? master.pet_id : 0)}</master><pets>${slots}</pets>`;
}
function place(db, pl, cmd, petId, dstId) {
  const rows = all(db, pl);
  const set = (id, slot) => db.prepare('UPDATE pets SET slot=? WHERE id=? AND uid=?').run(slot, id, pl.uid);
  if (cmd === 10 || cmd === 11) {
    const p = rows.find((x) => x.id === petId);
    if (!p) return { error: 'no such pet' };
    if (cmd === 11) { rows.filter((x) => x.slot === 0).forEach((x) => set(x.id, -1)); set(p.id, 0); return { xml: '' }; }
    if (p.slot >= 0) return { error: 'this pet is already working' };
    const open = SLOT_LV.map((lv, i) => i + 1).filter((s) => pl.level >= SLOT_LV[s - 1] && !rows.some((x) => x.slot === s));
    if (!open.length) return { error: 'no free slot' };
    set(p.id, open[0]);
    return { xml: '' };
  }
  const old = rows.find((x) => x.id === petId), dst = rows.find((x) => x.id === dstId);
  if (!old || !dst) return { error: 'no such pet' };
  const s = old.slot;
  set(old.id, dst.slot); set(dst.id, s); // swap places (dst may be idle, then the old pet goes idle)
  return { xml: '' };
}
function numXml(p, next) { return `<num><current>${statXml(stats(p))}</current><next>${statXml(stats(next))}</next></num>`; }
function levelInfo(db, pl, id) {
  const p = one(db, pl, id);
  if (!p) return { error: 'no such pet' };
  const row = game.table('petupgrade').rows.find((r) => r[0] === p.level) || [0, 0, GRAIN, 0];
  return { xml: '<basic>' + el('level', p.level) + el('rank', p.rank) + el('star', p.star) + el('max_level', MAX_LEVEL) + el('prop_id', GRAIN) +
    el('prop_num', p.level >= MAX_LEVEL ? 0 : row[3]) + '</basic>' + numXml(p, { ...p, level: Math.min(MAX_LEVEL, p.level + 1) }) };
}
function levelUp(db, pl, id) {
  const p = one(db, pl, id);
  if (!p) return { error: 'no such pet' };
  if (p.level >= MAX_LEVEL) return { error: 'max level' };
  const need = (game.table('petupgrade').rows.find((r) => r[0] === p.level) || [0, 0, 0, 20])[3];
  if (cnt(db, pl, GRAIN) < need) return { error: 'not enough grain' };
  game.propAdd(db, pl.uid, pl.server_id, GRAIN, -need);
  db.prepare('UPDATE pets SET level=level+1 WHERE id=?').run(id);
  return { xml: '<basic>' + el('upgrade', 1) + '</basic>' };
}
function rankInfo(db, pl, id) {
  const p = one(db, pl, id);
  if (!p) return { error: 'no such pet' };
  const row = game.table('petupgradeequ').rows.find((r) => r[0] === p.rank + 1);
  return { xml: '<basic>' + el('level', p.level) + el('star', p.star) + el('rank', p.rank) + el('max_rank', MAX_RANK) + el('prop_id', NOSTRUM) +
    el('prop_num', row ? row[3] : 0) + el('chance', row ? row[4] : 0) + '</basic>' + numXml(p, { ...p, rank: Math.min(MAX_RANK, p.rank + 1) }) };
}
function rankUp(db, pl, id) {
  const p = one(db, pl, id);
  if (!p) return { error: 'no such pet' };
  const row = game.table('petupgradeequ').rows.find((r) => r[0] === p.rank + 1);
  if (!row) return { error: 'max rank' };
  if (cnt(db, pl, NOSTRUM) < row[3]) return { error: 'not enough nostrum' };
  game.propAdd(db, pl.uid, pl.server_id, NOSTRUM, -row[3]); // the client takes the nostrum on failure too
  const ok = Math.random() * 100 < row[4];
  if (ok) db.prepare('UPDATE pets SET rank=rank+1 WHERE id=?').run(id);
  return { xml: '<basic>' + el('upgrade', ok ? 1 : 0) + '</basic>' };
}
const starRow = (star) => game.table('petupgradestar').rows.find((r) => r[0] === star + 1);
function trainInfo(db, pl, id) {
  const p = one(db, pl, id);
  if (!p) return { error: 'no such pet' };
  const row = starRow(p.star);
  return { xml: '<basic>' + el('star', p.star) + el('max_star', MAX_STAR) + el('current_train', p.train) + el('total_train', row ? row[2] : 0) +
    el('tain_normal_cost', TRAIN[1].cost) + el('tain_spec_cost', TRAIN[2].cost) + el('tain_normal_gen', TRAIN[1].exp) + el('tain_spec_gen', TRAIN[2].exp) +
    '</basic>' + numXml(p, { ...p, star: Math.min(MAX_STAR, p.star + 1) }) };
}
function train(db, pl, id, type) {
  const p = one(db, pl, id);
  const t = TRAIN[type];
  if (!p || !t) return { error: 'no such pet' };
  const row = starRow(p.star);
  if (!row || p.star >= MAX_STAR) return { error: 'max star' };
  const gold = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id).gold;
  if (gold < t.cost) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(t.cost, pl.uid, pl.server_id);
  const crit = Math.random() < 0.2 ? 1 : 0;
  let exp = p.train + t.exp * (crit ? 2 : 1), star = p.star, up = 0;
  if (exp >= row[2]) { exp -= row[2]; star += 1; up = 1; }
  if (star >= MAX_STAR) exp = 0;
  db.prepare('UPDATE pets SET train=?, star=? WHERE id=?').run(exp, star, id);
  return { xml: '<basic>' + el('upgrade', up) + el('crit', crit) + el('train', exp) + el('current_cost', t.cost) + el('next_spec_cost', TRAIN[1].cost) + '</basic>' };
}
// Master pet id for fight XML (<master_pet><pet_id>), 0 when none.
function masterPetId(db, uid, sid) {
  ensure(db);
  const p = db.prepare('SELECT pet_id FROM pets WHERE uid=? AND server_id=? AND slot=0').get(uid, sid);
  return p ? p.pet_id : 0;
}

module.exports = { listXml, circleXml, place, levelInfo, levelUp, rankInfo, rankUp, trainInfo, train, teamBonus, masterPetId };
