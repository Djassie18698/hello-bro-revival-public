// Pets / summoning beasts (Base > Pets, opens at player level 150; ui_pet*.lua; rl_x_pet). As in the original game a pet
// is earned by collecting 30 of its fragments (sold in the mystery shop) and merging them in the Backpack (rl_w_comm Cmd 10).
// Grain (prop 36) levels a pet, nostrum (prop 37) ranks it up; both are also mystery shop items. One master pet and up to
// 8 helper slots (unlocked at player level 1/80/100/.../200); the stats of all working pets are added to the team.
// Cmds: 1/3 pet list, 2 summon circle, 4 training info, 5 train (Type 1 normal / 2 special), 6 level info, 7 level up,
// 8 rank info, 9 rank up, 10 put PetID in a free helper slot, 11 make PetID master, 12/13 swap PetID for DstPetID.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const GRAIN = 36, NOSTRUM = 37;
const MAX_LEVEL = 50, MAX_RANK = 10, MAX_STAR = 10; // = rows in petupgrade / petupgradeequ / petupgradestar
const SLOT_LV = [1, 80, 100, 120, 140, 160, 180, 200]; // original unlock levels (ui_petPsychicLayer.lua openLv)
// Training, from petinfo cols 20-27 (m_pet_gen, gencrit, spe, speexpend, specrit, genexpend, add, cei; order reconstructed):
// normal = 100 points, 20% crit, cost 30 gold +30 per use up to 150, reset daily; special = 150 points, 50% crit, 100 gold.
function trainCfg(r) {
  return { gen: r[20], genCrit: r[21], spe: r[22], speCost: r[23], speCrit: r[24], genCost: r[25], genAdd: r[26], genCap: r[27] };
}
const today = () => new Date().toISOString().slice(0, 10);

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pets (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, server_id INTEGER, pet_id INTEGER,
    level INTEGER DEFAULT 1, rank INTEGER DEFAULT 0, star INTEGER DEFAULT 0, train INTEGER DEFAULT 0, slot INTEGER DEFAULT -1);
    CREATE TABLE IF NOT EXISTS pet_train (uid INTEGER, server_id INTEGER, day TEXT, n INTEGER DEFAULT 0, PRIMARY KEY(uid, server_id))`);
}
// A new pet (from merging its fragments). The first pet becomes the master.
function addPet(db, uid, sid, petId) {
  ensure(db);
  const has = db.prepare('SELECT 1 FROM pets WHERE uid=? AND server_id=? AND slot=0').get(uid, sid);
  return db.prepare('INSERT INTO pets(uid,server_id,pet_id,slot) VALUES(?,?,?,?)').run(uid, sid, petId, has ? -1 : 0).lastInsertRowid;
}
function trainsToday(db, pl) {
  const r = db.prepare('SELECT * FROM pet_train WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  return r && r.day === today() ? r.n : 0;
}
const normalCost = (c, n) => Math.min(c.genCap, c.genCost + c.genAdd * n);
function all(db, pl) {
  ensure(db);
  return db.prepare('SELECT * FROM pets WHERE uid=? AND server_id=? ORDER BY id').all(pl.uid, pl.server_id);
}
const info = (petId) => game.table('petinfo').rows.find((r) => r[0] === petId);
// petinfo [9..11] = base attack/defense/chakra, [13..15] = added per level; petupgradeequ [5..7] = flat bonus at a rank;
// petupgradestar [3] / 50 = % buff at a star.
function stats(p) {
  const r = info(p.pet_id) || [];
  const eq = game.table('petupgradeequ').rows.find((x) => x[0] === p.rank);
  const st = game.table('petupgradestar').rows.find((x) => x[0] === p.star);
  const base = (i) => (r[i] || 0) + (r[i + 4] || 0) * (p.level - 1) + (eq ? eq[5 + i - 9] : 0);
  const buff = st ? Math.round(st[3] / 50) : 0;
  return { attack: base(9), defense: base(10), chakala: base(11), attack_buff: buff, defense_buff: buff, chakala_buff: buff };
}
const statXml = (s) => Object.entries(s).map(([k, v]) => el(k, v)).join('');
const petXml = (p) => '<pet>' + el('id', p.id) + el('pet_id', p.pet_id) + el('level', p.level) + el('rank', p.rank) + el('star', p.star) +
  statXml(stats(p)) + el('work', p.slot >= 0 ? 1 : 0) + '</pet>';
const one = (db, pl, id) => all(db, pl).find((p) => p.id === id);
const cnt = (db, pl, prop) => game.propCounts(db, pl.uid, pl.server_id)[prop] || 0;

function listXml(db, pl) { return `<pets>${all(db, pl).map(petXml).join('')}</pets>`; }
// Stats the pets give the team (also shown on the summon circle): the sum of all working pets, which the game
// spreads evenly over the ninjas.
function teamBonus(db, uid, sid) {
  ensure(db);
  const t = { attack: 0, defense: 0, chakala: 0 };
  for (const p of db.prepare('SELECT * FROM pets WHERE uid=? AND server_id=? AND slot>=0').all(uid, sid)) {
    const s = stats(p), f = 1;
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
  const row = starRow(p.star), c = trainCfg(info(p.pet_id));
  return { xml: '<basic>' + el('star', p.star) + el('max_star', MAX_STAR) + el('current_train', p.train) + el('total_train', row ? row[2] : 0) +
    el('tain_normal_cost', normalCost(c, trainsToday(db, pl))) + el('tain_spec_cost', c.speCost) + el('tain_normal_gen', c.gen) + el('tain_spec_gen', c.spe) +
    '</basic>' + numXml(p, { ...p, star: Math.min(MAX_STAR, p.star + 1) }) };
}
function train(db, pl, id, type) {
  const p = one(db, pl, id);
  if (!p || (type !== 1 && type !== 2)) return { error: 'no such pet' };
  const c = trainCfg(info(p.pet_id)), n = trainsToday(db, pl);
  const t = type === 1 ? { cost: normalCost(c, n), exp: c.gen, crit: c.genCrit } : { cost: c.speCost, exp: c.spe, crit: c.speCrit };
  const row = starRow(p.star);
  if (!row || p.star >= MAX_STAR) return { error: 'max star' };
  const gold = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id).gold;
  if (gold < t.cost) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(t.cost, pl.uid, pl.server_id);
  if (type === 1) db.prepare('INSERT INTO pet_train VALUES(?,?,?,1) ON CONFLICT DO UPDATE SET n=CASE WHEN day=excluded.day THEN n+1 ELSE 1 END, day=excluded.day').run(pl.uid, pl.server_id, today());
  const crit = Math.random() * 100 < t.crit ? 1 : 0;
  let exp = p.train + t.exp * (crit ? 2 : 1), star = p.star, up = 0;
  if (exp >= row[2]) { exp -= row[2]; star += 1; up = 1; }
  if (star >= MAX_STAR) exp = 0;
  db.prepare('UPDATE pets SET train=?, star=? WHERE id=?').run(exp, star, id);
  return { xml: '<basic>' + el('upgrade', up) + el('crit', crit) + el('train', exp) + el('current_cost', t.cost) + el('next_spec_cost', normalCost(c, type === 1 ? n + 1 : n)) + '</basic>' };
}
// Master pet id for fight XML (<master_pet><pet_id>), 0 when none.
function masterPetId(db, uid, sid) {
  ensure(db);
  const p = db.prepare('SELECT pet_id FROM pets WHERE uid=? AND server_id=? AND slot=0').get(uid, sid);
  return p ? p.pet_id : 0;
}

module.exports = { addPet, listXml, circleXml, place, levelInfo, levelUp, rankInfo, rankUp, trainInfo, train, teamBonus, masterPetId };
