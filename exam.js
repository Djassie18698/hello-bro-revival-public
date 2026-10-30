// Ninja Test (Base > Ninja Test, ui_ninjaTestMain.lua; rl_x_exam). 15 stages, each guarded by 5 ninjas. You pick up to
// 5 of your 4-star+ ninjas; a fight is a chain of one-on-one duels (attack vs guard value, a little luck) and the loser
// of each duel is out. Fallen ninjas stay fallen for the day, so a stage may take several tries with fresh ninjas.
// Clearing a stage gives score (spent in the score shop) and opens a chest; every 5th stage has 3 chests.
// Cmd 1 info, 2 set team (card_index_list a_b_c), 3 exchange (reward_id), 4 buy a try, 5 fight, 6 open chest (box_index), 7 next stage.
const game = require('./game');
const tupo = require('./tupo');

const el = (n, v) => `<${n}>${v}</${n}>`;
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = () => new Date().toISOString().slice(0, 10);
const STAGES = 15, TRIES = 3, BUY_COST = 20;
const BOX_COST = [0, 30, 80];
// chest drops (single-item dropinfo rows): normal stage chest, then the three boss-stage chests
const NORMAL_BOX = [42, 43, 1397, 1784, 1785];
const BOSS_BOX = [[270, 506], [1397, 114], [1398, 241, 1446]];
// score shop: [reward_id, drop_id, score, gold, silver]
const SHOP = [[1, 506, 50, 0, 0], [2, 270, 80, 0, 0], [3, 114, 120, 0, 0], [4, 1398, 150, 0, 0], [5, 241, 200, 0, 0],
  [11, 1824, 30, 0, 0], [12, 1825, 60, 0, 0],
  [6, 1447, 400, 0, 0], [7, 1448, 450, 0, 0], [8, 1449, 450, 0, 0], [9, 1446, 800, 0, 0]];
// plus reward 10: fragments of the player's own god card (for Breakthrough), when they have one
function shopFor(db, pl) {
  const frag = tupo.fragmentDropFor(db, pl);
  return frag ? SHOP.concat([[10, frag, 100, 0, 0]]) : SHOP;
}

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS exam (uid INTEGER, server_id INTEGER, day TEXT, grade INTEGER DEFAULT 1, is_win INTEGER DEFAULT 0,
    score INTEGER DEFAULT 0, left_count INTEGER DEFAULT ${TRIES}, flags TEXT DEFAULT '000', team TEXT DEFAULT '', dead TEXT DEFAULT '',
    gdead TEXT DEFAULT '', PRIMARY KEY(uid, server_id))`);
}
function me(db, pl) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO exam(uid,server_id,day) VALUES(?,?,?)').run(pl.uid, pl.server_id, day());
  let e = db.prepare('SELECT * FROM exam WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (e.day !== day()) { // a new day: the run starts over, the score stays
    db.prepare(`UPDATE exam SET day=?, grade=1, is_win=0, left_count=?, flags='000', dead='', gdead='' WHERE uid=? AND server_id=?`).run(day(), TRIES, pl.uid, pl.server_id);
    e = db.prepare('SELECT * FROM exam WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  }
  return e;
}
const save = (db, pl, f) => {
  const keys = Object.keys(f);
  db.prepare(`UPDATE exam SET ${keys.map((k) => k + '=?').join(',')} WHERE uid=? AND server_id=?`).run(...keys.map((k) => f[k]), pl.uid, pl.server_id);
};
const list = (s) => (s ? s.split('_').map(Number).filter((n) => n > 0) : []);

// Odd stages: the guards defend (you attack). Even stages: the guards attack (your defense counts).
const guardsAttack = (grade) => (grade % 2 === 0 ? 1 : 0);
function guards(grade) {
  const pool = [...game.ninjas().values()].filter((n) => n[11] >= 4 && n[11] <= 5).sort((a, b) => a[0] - b[0]);
  return Array.from({ length: 5 }, (_, i) => {
    const n = pool[(grade * 7 + i * 13) % pool.length];
    return { id: n[0], name: n[2], attr: n[5] || 1, val: Math.round(380 + grade * 140 + i * 35 + (grade % 5 === 0 ? 300 : 0)) };
  });
}
// My card's value as the client shows it: average attack (or defense when the guards attack).
function cardVal(db, pl, seq, defend) {
  const c = db.prepare('SELECT * FROM cards WHERE seq=? AND uid=? AND server_id=? AND type=1').get(seq, pl.uid, pl.server_id);
  if (!c) return 0;
  const s = game.ninjaStats(c);
  return Math.round(defend ? (s.dl + s.dh) / 2 : (s.al + s.ah) / 2);
}
function infoXml(db, pl) {
  const e = me(db, pl);
  const g = guards(e.grade), gdead = list(e.gdead);
  const opp = g.map((x, i) => '<item><ninja_member>' + el('ninja_id', x.id) + el('val', x.val) + el('cardattr', x.attr) +
    el('dead_flag', gdead.includes(i + 1) ? 1 : 0) + '</ninja_member></item>').join('');
  const idx = (arr) => arr.map((b) => `<item>${el('bag_index', b)}</item>`).join('');
  const shop = shopFor(db, pl).map(([id, drop, score, cash, coin]) => {
    const r = game.table('dropinfo').rows.find((x) => x[0] === drop);
    return '<item><item>' + el('reward_id', id) + el('reward_name', esc(r ? r[2] : 'Reward')) + el('icon', 0) + el('score', score) + el('cash', cash) +
      el('coin', coin) + el('drop_id', drop) + el('quality', 5) + el('show', esc(r ? r[2] : '')) + '</item></item>';
  }).join('');
  const boxes = (e.grade % 5 === 0 ? BOX_COST : [0]).map((c, i) => '<item><box_info>' + el('index', i + 1) + el('cost', c) + '</box_info></item>').join('');
  const f = e.flags.split('').map(Number);
  return el('curr_grade', e.grade) + el('guard_name', esc(g[0].name)) + el('score', e.score) + el('buy_cost', BUY_COST) +
    el('is_attack', guardsAttack(e.grade)) + el('total_count', TRIES) + el('left_count', e.left_count) + el('is_win', e.is_win) +
    el('fetch_flag1', f[0]) + el('fetch_flag2', f[1]) + el('fetch_flag3', f[2]) +
    `<opp_list>${opp}</opp_list><dead_list>${idx(list(e.dead))}</dead_list><my_list>${idx(list(e.team))}</my_list>` +
    `<exchage_list>${shop}</exchage_list><reward_box>${boxes}</reward_box>`;
}
function setTeam(db, pl, raw) {
  me(db, pl);
  const seqs = [...new Set(list(String(raw || '')))].slice(0, 5);
  for (const s of seqs) {
    const c = db.prepare('SELECT ninja_id FROM cards WHERE seq=? AND uid=? AND server_id=? AND type=1').get(s, pl.uid, pl.server_id);
    const n = c && game.ninjas().get(c.ninja_id);
    if (!n || n[11] < 4) return { error: 'only your own 4-star or better ninjas can take the test' };
  }
  save(db, pl, { team: seqs.join('_') });
  return { xml: '' };
}
function buy(db, pl) {
  const e = me(db, pl);
  const p = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (p.gold < BUY_COST) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(BUY_COST, pl.uid, pl.server_id);
  save(db, pl, { left_count: e.left_count + 1 });
  return { xml: el('left_count', e.left_count + 1) };
}
function fight(db, pl) {
  const e = me(db, pl);
  if (e.is_win) return { error: 'stage already cleared' };
  if (e.left_count <= 0) return { error: 'no tries left' };
  const dead = list(e.dead), gdead = list(e.gdead);
  const defend = guardsAttack(e.grade) === 1;
  const mine = list(e.team).filter((s) => !dead.includes(s)).map((s) => ({ seq: s, val: cardVal(db, pl, s, defend) })).filter((x) => x.val > 0);
  if (!mine.length) return { error: 'pick ninjas that are still standing' };
  const g = guards(e.grade).map((x, i) => ({ ...x, slot: i + 1 })).filter((x) => !gdead.includes(x.slot));
  let a = 0, b = 0;
  const hp = mine.map((m) => m.val), ghp = g.map((x) => x.val);
  while (a < mine.length && b < g.length) { // duel: the stronger (with luck) survives, weakened by the loser's value
    const mv = hp[a] * (0.85 + Math.random() * 0.3), gv = ghp[b] * (0.85 + Math.random() * 0.3);
    if (mv >= gv) { hp[a] = Math.max(1, Math.round(hp[a] - ghp[b] * 0.4)); gdead.push(g[b].slot); b++; } else { ghp[b] = Math.max(1, Math.round(ghp[b] - hp[a] * 0.4)); dead.push(mine[a].seq); a++; }
  }
  const win = b >= g.length;
  const score = win ? 10 * e.grade + (e.grade % 5 === 0 ? 30 : 0) : 0;
  save(db, pl, { left_count: e.left_count - 1, dead: dead.join('_'), gdead: gdead.join('_'), is_win: win ? 1 : 0, score: e.score + score });
  const fightXml = game.battleXml(db, pl, 1, e.grade, { win, enemyIds: g.map((x) => x.id), enemyName: guards(e.grade)[0].name, enemyLevel: 10 + e.grade * 4 });
  return { xml: '<userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>' + fightXml };
}
function openBox(db, pl, index) {
  const e = me(db, pl);
  if (!e.is_win) return { error: 'clear the stage first' };
  const boss = e.grade % 5 === 0;
  const i = boss ? index : 1;
  if (!(i >= 1 && i <= 3)) return { error: 'bad chest' };
  const f = e.flags.split('');
  if (f[i - 1] === '1') return { error: 'already opened' };
  const cost = boss ? BOX_COST[i - 1] : 0;
  if (cost) {
    const p = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
    if (p.gold < cost) return { error: 'not enough gold' };
    db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  }
  f[i - 1] = '1';
  save(db, pl, { flags: f.join('') });
  const pool = boss ? BOSS_BOX[i - 1] : NORMAL_BOX;
  return { xml: game.grantDrop(db, pl, pool[Math.floor(Math.random() * pool.length)]) };
}
function next(db, pl) {
  const e = me(db, pl);
  if (e.is_win && e.grade < STAGES) save(db, pl, { grade: e.grade + 1, is_win: 0, flags: '000', gdead: '', left_count: Math.max(e.left_count, TRIES) });
  return { xml: infoXml(db, pl) };
}
function exchange(db, pl, rewardId) {
  const e = me(db, pl);
  const row = shopFor(db, pl).find((r) => r[0] === rewardId);
  if (!row) return { error: 'bad reward' };
  if (e.score < row[2]) return { error: 'not enough score' };
  save(db, pl, { score: e.score - row[2] });
  return { xml: el('score', e.score - row[2]) + game.grantDrop(db, pl, row[1]) };
}

module.exports = { infoXml, setTeam, buy, fight, openBox, next, exchange };
