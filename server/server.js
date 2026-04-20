const express = require('express');
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'superchats.db');

let db;

async function initDb() {
  const SQL = await initSqlJs();

  try {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } catch {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS streamers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      token TEXT,
      corner TEXT DEFAULT 'top-right',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS superchats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      streamer TEXT NOT NULL COLLATE NOCASE,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      amount REAL NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  saveDb();
}

let saveTimer = null;
function saveDb() {
  // Debounce: coalesce rapid writes into one disk flush
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = db.export();
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('DB save error:', e.message);
    }
  }, 200);
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] || 0;
  saveDb();
  return lastId;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function getColor(amount) {
  if (amount >= 10000) return 'gold';
  if (amount >= 100)   return 'purple';
  if (amount >= 50)    return 'pink';
  if (amount >= 20)    return 'orange';
  if (amount >= 5)     return 'green';
  return 'blue';
}

function requireAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const streamer = dbGet('SELECT * FROM streamers WHERE token = ?', [token]);
  if (!streamer) return res.status(401).json({ error: 'Invalid token' });
  req.streamer = streamer;
  next();
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = dbGet('SELECT id FROM streamers WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const salt = crypto.randomBytes(16).toString('hex');
  const password_hash = hashPassword(password, salt);
  const token = crypto.randomBytes(32).toString('hex');

  dbRun('INSERT INTO streamers (username, password_hash, salt, token) VALUES (?, ?, ?, ?)',
    [username, password_hash, salt, token]);

  const latest = dbGet('SELECT MAX(id) as id FROM superchats WHERE streamer = ?', [username]);
  res.json({ token, username, last_id: latest?.id || 0 });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const streamer = dbGet('SELECT * FROM streamers WHERE username = ?', [username]);
  if (!streamer) return res.status(401).json({ error: 'Invalid username or password' });

  const hash = hashPassword(password, streamer.salt);
  if (hash !== streamer.password_hash) return res.status(401).json({ error: 'Invalid username or password' });

  const token = crypto.randomBytes(32).toString('hex');
  dbRun('UPDATE streamers SET token = ? WHERE id = ?', [token, streamer.id]);

  const latest = dbGet('SELECT MAX(id) as id FROM superchats WHERE streamer = ?', [streamer.username]);
  res.json({ token, username: streamer.username, corner: streamer.corner, last_id: latest?.id || 0 });
});

app.get('/api/verify', requireAuth, (req, res) => {
  res.json({ username: req.streamer.username, corner: req.streamer.corner });
});

app.post('/api/settings', requireAuth, (req, res) => {
  const { corner } = req.body;
  const valid = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  if (!valid.includes(corner)) return res.status(400).json({ error: 'Invalid corner' });
  dbRun('UPDATE streamers SET corner = ? WHERE id = ?', [corner, req.streamer.id]);
  res.json({ corner });
});

app.post('/api/superchats', (req, res) => {
  const { streamer, sender_name, message, amount } = req.body;
  if (!streamer || !sender_name || !message || amount == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount < 1) {
    return res.status(400).json({ error: 'Amount must be at least $1.00' });
  }
  if (parsedAmount > 10000) {
    return res.status(400).json({ error: 'Amount cannot exceed $10,000.00' });
  }

  const color = getColor(parsedAmount);
  const id = dbRun(
    'INSERT INTO superchats (streamer, sender_name, message, amount, color) VALUES (?, ?, ?, ?, ?)',
    [streamer, sender_name, message, parsedAmount, color]
  );

  res.json({ id, color });
});

app.get('/api/poll/:username', requireAuth, (req, res) => {
  const { username } = req.params;
  if (req.streamer.username.toLowerCase() !== username.toLowerCase()) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const lastId = parseInt(req.query.last_id) || 0;
  const superchats = dbAll(
    'SELECT * FROM superchats WHERE streamer = ? AND id > ? ORDER BY id ASC LIMIT 20',
    [username, lastId]
  );
  res.json({ superchats });
});

app.get('/api/superchats/:username', (req, res) => {
  const { username } = req.params;
  const superchats = dbAll(
    'SELECT id, sender_name, message, amount, color, created_at FROM superchats WHERE streamer = ? ORDER BY id DESC LIMIT 50',
    [username]
  );
  res.json({ superchats });
});

app.get('/send', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'send.html'));
});

app.get('/download', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`SuperChat server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
