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
  `);
  return db;
}

module.exports = { abrir };
