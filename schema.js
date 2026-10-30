module.exports = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      uid INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      session TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      uid INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      nick TEXT NOT NULL,
      country INTEGER NOT NULL DEFAULT 1,
      card INTEGER NOT NULL DEFAULT 1,
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      gold INTEGER NOT NULL DEFAULT 1000,
      coin INTEGER NOT NULL DEFAULT 100000,
      energy INTEGER NOT NULL DEFAULT 50,
      created INTEGER NOT NULL,
      PRIMARY KEY (uid, server_id)
    );
  `);
};
