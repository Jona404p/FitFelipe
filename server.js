const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fitfelipe-dev-secret';
const databaseUrl = process.env.DATABASE_URL;

const demoUsers = [];
const demoDiary = {};
const demoProfiles = {};

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let pgClient = null;

async function connectDatabase() {
  if (!databaseUrl) {
    return null;
  }

  if (!pgClient) {
    try {
      pgClient = new Client({
        connectionString: databaseUrl,
        ssl: { rejectUnauthorized: false }
      });

      pgClient.on('error', (error) => {
        console.warn('[DB] Conexión PostgreSQL terminada:', error.message);
        pgClient = null;
      });

      await pgClient.connect();
      await pgClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS diary_entries (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date DATE NOT NULL,
          food TEXT NOT NULL,
          kcal_consumed INTEGER NOT NULL,
          minutes_walked INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_profiles (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          weight_kg NUMERIC(5,1) NOT NULL DEFAULT 90,
          height_cm NUMERIC(5,1) NOT NULL DEFAULT 170,
          age_years INTEGER NOT NULL DEFAULT 26,
          sex TEXT NOT NULL DEFAULT 'H',
          activity_factor NUMERIC(4,3) NOT NULL DEFAULT 1.2,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    } catch (error) {
      console.warn('[DB] No se pudo conectar a PostgreSQL, usando modo demo:', error.message);
      if (pgClient) {
        try { await pgClient.end(); } catch (cleanupError) { /* noop */ }
      }
      pgClient = null;
      return null;
    }
  }

  return pgClient;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Token no encontrado' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Sesión no válida o expirada' });
  }
}

async function getUserByEmail(email) {
  const client = await connectDatabase();

  if (!client) {
    const found = demoUsers.find(user => user.email.toLowerCase() === String(email).toLowerCase());
    return found || null;
  }

  const result = await client.query(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [String(email).toLowerCase()]
  );

  return result.rows[0] || null;
}

async function createUser({ name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const trimmedName = String(name).trim();

  // Validación de campos vacíos
  if (!trimmedName) {
    throw new Error('El nombre no puede estar vacío');
  }
  if (!normalizedEmail) {
    throw new Error('El email no puede estar vacío');
  }
  if (!password) {
    throw new Error('La contraseña no puede estar vacía');
  }

  // Validación de email formato
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    throw new Error('Por favor ingresa un email válido');
  }

  // Validación de contraseña
  if (password.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres');
  }
  if (password.length > 128) {
    throw new Error('La contraseña es demasiado larga (máximo 128 caracteres)');
  }

  // Validación de nombre
  if (trimmedName.length < 2) {
    throw new Error('El nombre debe tener al menos 2 caracteres');
  }
  if (trimmedName.length > 100) {
    throw new Error('El nombre es demasiado largo (máximo 100 caracteres)');
  }

  const client = await connectDatabase();

  if (!client) {
    const existing = demoUsers.find(user => user.email.toLowerCase() === normalizedEmail);
    if (existing) {
      throw new Error('Ya existe una cuenta con ese email');
    }

    const user = {
      id: `demo-${Date.now()}`,
      name: trimmedName,
      email: normalizedEmail,
      password_hash: await bcrypt.hash(password, 10)
    };

    demoUsers.push(user);
    console.log(`[DEMO] Usuario creado: ${normalizedEmail}`);
    return user;
  }

  try {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rowCount > 0) {
      throw new Error('Ya existe una cuenta con ese email');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [trimmedName, normalizedEmail, passwordHash]
    );

    console.log(`[DB] Usuario creado: ${normalizedEmail} (ID: ${result.rows[0].id})`);
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Ya existe una cuenta con ese email');
    }
    throw new Error(`Error al crear la cuenta: ${error.message}`);
  }
}

async function getUserProfile(userId) {
  const client = await connectDatabase();

  if (!client) {
    if (!demoProfiles[userId]) {
      demoProfiles[userId] = {
        user_id: userId,
        weight_kg: 90,
        height_cm: 170,
        age_years: 26,
        sex: 'H',
        activity_factor: 1.2,
        updated_at: new Date().toISOString()
      };
    }

    return demoProfiles[userId];
  }

  const result = await client.query(
    `SELECT weight_kg, height_cm, age_years, sex, activity_factor
     FROM user_profiles
     WHERE user_id = $1`,
    [userId]
  );

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  const defaultProfile = {
    user_id: userId,
    weight_kg: 90,
    height_cm: 170,
    age_years: 26,
    sex: 'H',
    activity_factor: 1.2,
    updated_at: new Date().toISOString()
  };

  const inserted = await client.query(
    `INSERT INTO user_profiles (user_id, weight_kg, height_cm, age_years, sex, activity_factor)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING weight_kg, height_cm, age_years, sex, activity_factor`,
    [userId, defaultProfile.weight_kg, defaultProfile.height_cm, defaultProfile.age_years, defaultProfile.sex, defaultProfile.activity_factor]
  );

  return inserted.rows[0];
}

async function saveUserProfile(userId, payload = {}) {
  const weight = Number(payload.weight_kg ?? 90);
  const height = Number(payload.height_cm ?? 170);
  const age = Number(payload.age_years ?? 26);
  const sex = payload.sex === 'M' ? 'M' : 'H';
  const activity = Number(payload.activity_factor ?? 1.2);

  if (!Number.isFinite(weight) || !Number.isFinite(height) || !Number.isFinite(age) || !Number.isFinite(activity)) {
    throw new Error('Datos del perfil inválidos');
  }

  const client = await connectDatabase();

  if (!client) {
    demoProfiles[userId] = {
      user_id: userId,
      weight_kg: weight,
      height_cm: height,
      age_years: age,
      sex,
      activity_factor: activity,
      updated_at: new Date().toISOString()
    };

    return demoProfiles[userId];
  }

  const result = await client.query(
    `INSERT INTO user_profiles (user_id, weight_kg, height_cm, age_years, sex, activity_factor)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id)
     DO UPDATE SET
       weight_kg = EXCLUDED.weight_kg,
       height_cm = EXCLUDED.height_cm,
       age_years = EXCLUDED.age_years,
       sex = EXCLUDED.sex,
       activity_factor = EXCLUDED.activity_factor,
       updated_at = NOW()
     RETURNING weight_kg, height_cm, age_years, sex, activity_factor`,
    [userId, weight, height, age, sex, activity]
  );

  return result.rows[0];
}

async function getDiaryByUser(userId) {
  const client = await connectDatabase();

  if (!client) {
    return demoDiary[userId] || [];
  }

  const result = await client.query(
    `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, food, kcal_consumed AS "kcalConsumed", minutes_walked AS "minutes"
     FROM diary_entries
     WHERE user_id = $1
     ORDER BY date DESC, created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    date: row.date,
    food: row.food,
    kcalConsumed: Number(row.kcalConsumed),
    minutes: Number(row.minutes)
  }));
}

function normalizeDiaryPayload(payload = {}) {
  const rawDate = String(payload.date ?? '').trim();
  const rawFood = String(payload.food ?? '').trim();
  const kcalValue = Number(payload.kcalConsumed);
  const minutesValue = Number(payload.minutes ?? 0);

  let date = rawDate;
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    date = rawDate;
  } else if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed.toISOString().slice(0, 10);
    }
  }

  return {
    date,
    food: rawFood,
    kcalConsumed: Number.isFinite(kcalValue) ? Math.round(kcalValue) : NaN,
    minutes: Number.isFinite(minutesValue) ? Math.round(minutesValue) : NaN
  };
}

function isValidCalendarDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

async function addDiaryEntry(userId, payload) {
  const client = await connectDatabase();
  const normalized = normalizeDiaryPayload(payload);
  const { date, food, kcalConsumed, minutes } = normalized;

  if (!date || !food || !Number.isFinite(kcalConsumed) || kcalConsumed <= 0) {
    throw new Error('La fecha, comida y calorías deben ser válidas');
  }

  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('Los minutos deben ser un número válido mayor o igual que 0');
  }

  if (!isValidCalendarDate(date)) {
    throw new Error('La fecha debe tener formato YYYY-MM-DD');
  }

  if (!client) {
    const entry = {
      id: `demo-entry-${Date.now()}`,
      date,
      food,
      kcalConsumed: Number(kcalConsumed),
      minutes: Number(minutes) || 0
    };

    if (!demoDiary[userId]) demoDiary[userId] = [];
    demoDiary[userId].unshift(entry);
    return entry;
  }

  if (!client) {
    throw new Error('La base de datos no está disponible. Inténtalo de nuevo.');
  }

  const result = await client.query(
    `INSERT INTO diary_entries (user_id, date, food, kcal_consumed, minutes_walked)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, food, kcal_consumed AS "kcalConsumed", minutes_walked AS "minutes"`,
    [userId, date, food, Number(kcalConsumed), Number(minutes) || 0]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    date: row.date,
    food: row.food,
    kcalConsumed: Number(row.kcalConsumed),
    minutes: Number(row.minutes)
  };
}

async function updateDiaryEntry(userId, entryId, payload) {
  const client = await connectDatabase();
  const normalized = normalizeDiaryPayload(payload || {});
  const { date, food, kcalConsumed, minutes } = normalized;

  if (!date || !food || !Number.isFinite(kcalConsumed) || kcalConsumed <= 0) {
    throw new Error('La fecha, comida y calorías deben ser válidas');
  }

  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('Los minutos deben ser un número válido mayor o igual que 0');
  }

  if (!isValidCalendarDate(date)) {
    throw new Error('La fecha debe tener formato YYYY-MM-DD');
  }

  if (!client) {
    const diary = demoDiary[userId] || [];
    const index = diary.findIndex(item => item.id === entryId);

    if (index === -1) {
      throw new Error('No se encontró el registro a actualizar');
    }

    diary[index] = {
      ...diary[index],
      date,
      food,
      kcalConsumed: Number(kcalConsumed),
      minutes: Number(minutes) || 0
    };

    demoDiary[userId] = diary;
    return diary[index];
  }

  const result = await client.query(
    `UPDATE diary_entries
     SET date = $1, food = $2, kcal_consumed = $3, minutes_walked = $4
     WHERE id = $5 AND user_id = $6
     RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, food, kcal_consumed AS "kcalConsumed", minutes_walked AS "minutes"`,
    [date, food, Number(kcalConsumed), Number(minutes) || 0, entryId, userId]
  );

  if (result.rowCount === 0) {
    throw new Error('No se encontró el registro a actualizar');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    date: row.date,
    food: row.food,
    kcalConsumed: Number(row.kcalConsumed),
    minutes: Number(row.minutes)
  };
}

async function deleteDiaryEntry(userId, entryId) {
  const client = await connectDatabase();

  if (!client) {
    if (!demoDiary[userId]) return;
    demoDiary[userId] = demoDiary[userId].filter(item => item.id !== entryId);
    return;
  }

  await client.query('DELETE FROM diary_entries WHERE id = $1 AND user_id = $2', [entryId, userId]);
}

app.get('/api/health', async (req, res) => {
  try {
    await connectDatabase();
    return res.json({
      ok: true,
      database: databaseUrl ? 'Neon/Postgres ready' : 'demo mode',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error al verificar la base de datos', error: error.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Nombre, email y contraseña deben ser texto' });
    }

    const user = await createUser({ name, email, password });
    const token = signToken(user);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      message: 'Cuenta creada exitosamente'
    });
  } catch (error) {
    console.error('[REGISTRO ERROR]', error.message);
    return res.status(400).json({ message: error.message || 'No se pudo crear la cuenta' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const client = await connectDatabase();
    const isDemoUser = !client;
    const validPassword = isDemoUser
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = signToken({
      id: user.id,
      name: user.name,
      email: user.email
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error al iniciar sesión', error: error.message });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const client = await connectDatabase();

    if (!client) {
      const user = demoUsers.find(item => item.id === req.user.sub);
      if (!user) {
        return res.status(404).json({ message: 'Usuario no encontrado' });
      }

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    }

    const result = await client.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.user.sub]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ message: 'Error al cargar perfil', error: error.message });
  }
});

app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.sub);
    return res.json({ profile });
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo cargar el perfil', error: error.message });
  }
});

app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const profile = await saveUserProfile(req.user.sub, req.body || {});
    return res.json({ profile });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo guardar el perfil' });
  }
});

app.get('/api/diary', authMiddleware, async (req, res) => {
  try {
    const entries = await getDiaryByUser(req.user.sub);
    return res.json(entries);
  } catch (error) {
    return res.status(500).json({ message: 'Error al obtener el registro', error: error.message });
  }
});

app.post('/api/diary', authMiddleware, async (req, res) => {
  try {
    const entry = await addDiaryEntry(req.user.sub, req.body || {});
    return res.status(201).json(entry);
  } catch (error) {
    const isValidationError = error.message?.includes('deben ser válidas')
      || error.message?.includes('deben ser un número')
      || error.message?.includes('formato YYYY-MM-DD');
    const status = isValidationError ? 400 : 503;
    console.error('[DIARIO ERROR]', error.message);
    return res.status(status).json({ message: error.message || 'No se pudo guardar el día' });
  }
});

app.put('/api/diary/:id', authMiddleware, async (req, res) => {
  try {
    const updated = await updateDiaryEntry(req.user.sub, req.params.id, req.body || {});
    return res.json(updated);
  } catch (error) {
    return res.status(400).json({ message: error.message || 'No se pudo actualizar el registro', error: error.message });
  }
});

app.delete('/api/diary/:id', authMiddleware, async (req, res) => {
  try {
    await deleteDiaryEntry(req.user.sub, req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo eliminar el registro', error: error.message });
  }
});

app.get('/service-worker.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'service-worker.js'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`FitFelipe ready on http://localhost:${port}`);
    console.log(`Base de datos: ${databaseUrl ? 'Neon/Postgres configured' : 'demo mode (fallback local)'}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = port + 1;
      console.warn(`Puerto ${port} ocupado, intentando ${fallbackPort} en su lugar.`);
      startServer(fallbackPort);
      return;
    }

    throw error;
  });
}

startServer(PORT);
