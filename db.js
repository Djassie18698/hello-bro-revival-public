// Opens the save (SQLite, one file) set up for many players at once:
// - WAL mode: reads never wait for writes and a write is one quick append (faster, and safe if the PC crashes);
// - a health check on start (PRAGMA quick_check), shown in the Server Manager;
// - a backup on start and every 6 hours while running (VACUUM INTO = a complete, consistent copy even while players play),
//   kept in backups/ (the newest 10 automatic ones; manual backups from the manager are never deleted);
// - indexes for the lookups that grow with the number of players.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// HB_BACKUPS: the backup folder (START-PUBLIC-SERVER.bat keeps the public save's backups apart)
const BACKUPS = process.env.HB_BACKUPS || 'backups';
const BACKUP_EVERY = 6 * 3600 * 1000, KEEP_AUTO = 10;
let health = 'not checked', lastBackup = null;

function backup(db, why) {
  try {
    fs.mkdirSync(BACKUPS, { recursive: true });
    const name = `hellobro-${why}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    db.exec(`VACUUM INTO '${path.join(BACKUPS, name).replace(/'/g, "''")}'`);
    lastBackup = { name, at: Date.now() };
    const auto = fs.readdirSync(BACKUPS).filter((f) => /^hellobro-.*\.db$/.test(f)).sort();
    for (const f of auto.slice(0, -KEEP_AUTO)) fs.rmSync(path.join(BACKUPS, f), { force: true });
  } catch (e) { console.error('backup failed', e.message); }
}

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY;');
  try { health = db.prepare('PRAGMA quick_check').get().quick_check; } catch (e) { health = e.message; }
  if (health !== 'ok') console.error('[database] health check: ' + health + ' (restore a file from backups/ if the game misbehaves)');
  backup(db, 'start');
  setInterval(() => backup(db, 'auto'), BACKUP_EVERY).unref();
  return db;
}

// Run after every module made its tables: an index only where the table exists.
function indexes(db) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const want = [['pets', 'pets_owner', 'uid, server_id'], ['mail', 'mail_to', 'to_uid'], ['war_log', 'war_log_server', 'server_id, uid'],
    ['equipped', 'equipped_seq', 'seq'], ['team', 'team_seq', 'seq'], ['accounts', 'accounts_session', 'session']];
  for (const [t, name, cols] of want) if (has(t)) db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${t}(${cols})`);
  db.exec('PRAGMA optimize');
}

const status = () => ({ health, lastBackup, mode: 'SQLite (WAL)' });

module.exports = { open, indexes, backup, status };
