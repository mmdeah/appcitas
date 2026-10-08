// Base de datos SQLite (viene incluida en Node). Todo queda en un solo archivo.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ARCHIVO = path.join(__dirname, '..', 'data', 'taller.db');

function abrir(archivo = ARCHIVO) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const db = new DatabaseSync(archivo);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS citas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      servicio TEXT NOT NULL,
      fecha TEXT NOT NULL,                     -- YYYY-MM-DD, hora de Colombia
      hora TEXT NOT NULL,                      -- HH:MM
      puesto INTEGER NOT NULL,                 -- 1..capacidad de esa hora
      cliente TEXT NOT NULL,
      telefono TEXT NOT NULL,
      vehiculo TEXT,
      placa TEXT,
      notas TEXT,
      estado TEXT NOT NULL DEFAULT 'AGENDADA', -- AGENDADA | CONFIRMADA | LLEGO | NO_ASISTIO | CANCELADA
      origen TEXT NOT NULL DEFAULT 'MANUAL',   -- MANUAL | BOT
      creada TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Garantía de que dos citas activas nunca ocupan el mismo puesto a la misma hora.
    CREATE UNIQUE INDEX IF NOT EXISTS citas_sin_cruce
      ON citas (fecha, hora, puesto) WHERE estado <> 'CANCELADA';
    CREATE INDEX IF NOT EXISTS citas_por_fecha ON citas (fecha);

    CREATE TABLE IF NOT EXISTS bloqueos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora TEXT,                               -- NULL = todo el día
      motivo TEXT,
      creado TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS bloqueos_por_fecha ON bloqueos (fecha);

    -- En qué paso va cada cliente que está agendando por el bot de Kommo.
    CREATE TABLE IF NOT EXISTS conversaciones (
      lead TEXT PRIMARY KEY,                   -- ID del lead en Kommo
      datos TEXT NOT NULL,                     -- JSON con el paso y lo que ya respondió
      actualizada TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Columnas agregadas después de la primera versión.
  const columnas = db.prepare('PRAGMA table_info(citas)').all().map((c) => c.name);
  if (!columnas.includes('kommo_lead')) db.exec('ALTER TABLE citas ADD COLUMN kommo_lead TEXT');

  // Turnos cada 30 min con capacidad por hora: dos citas activas no pueden tener el mismo puesto en la misma hora.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS citas_sin_cruce_por_hora
      ON citas (fecha, substr(hora, 1, 2), puesto) WHERE estado <> 'CANCELADA'`);
  } catch (err) {
    // Solo pasaría con citas viejas forzadas a mano en la misma hora; la app sigue validando al reservar.
    console.warn('No pude crear el índice de cupos por hora:', err.message);
  }

  return db;
}

module.exports = { abrir };
