// API de solo lectura para que otras aplicaciones (por ejemplo el sistema del taller) consulten las citas.
// GET /api/citas?fecha=YYYY-MM-DD   o   GET /api/citas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Autenticación: encabezado "Authorization: Bearer <API_LECTURA_TOKEN>" (variable de entorno).
// Sin esa variable la API queda apagada.

const crypto = require('node:crypto');
const config = require('../config');
const { ahora, esFecha, diasEntre } = require('./fechas');

const MAX_DIAS = 62;

// Fecha y hora de la cita con el desfase de Colombia (no tiene horario de verano: siempre -05:00).
const inicioISO = (c) => `${c.fecha}T${c.hora}:00-05:00`;

function aCita(c) {
  const servicio = config.servicios[c.servicio];
  return {
    id: c.id,
    fecha: c.fecha,
    hora: c.hora,
    inicio: inicioISO(c),
    duracion_minutos: servicio ? servicio.duracionMinutos : null,
    servicio: c.servicio,
    servicio_nombre: servicio ? servicio.nombre : c.servicio,
    estado: c.estado,
    cliente: c.cliente,
    telefono: c.telefono,
    placa: c.placa || null,
    vehiculo: c.vehiculo || null,
    notas: c.notas || null,
    origen: c.origen,
    kommo_lead: c.kommo_lead || null,
    creada: `${String(c.creada).replace(' ', 'T')}Z`,
  };
}

function crearApi(db, { token = process.env.API_LECTURA_TOKEN, reloj = () => new Date() } = {}) {
  const clave = String(token || '').trim();
  const activa = clave.length >= 24;
  const sql = db.prepare('SELECT * FROM citas WHERE fecha BETWEEN ? AND ? ORDER BY fecha, hora, puesto, id');

  // Compara el token sin filtrar información por el tiempo de respuesta.
  function autorizado(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return false;
    const a = crypto.createHash('sha256').update(m[1].trim()).digest();
    const b = crypto.createHash('sha256').update(clave).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // Devuelve { estado, datos } listo para responder como JSON.
  function citas(req, parametros) {
    if (!activa) return { estado: 503, datos: { error: 'API apagada: falta la variable API_LECTURA_TOKEN (mínimo 24 caracteres).' } };
    if (!autorizado(req)) return { estado: 401, datos: { error: 'No autorizado. Envía el encabezado Authorization: Bearer <token>.' } };
    const fecha = parametros.get('fecha');
    const desde = fecha || parametros.get('desde') || ahora(reloj()).fecha;
    const hasta = fecha || parametros.get('hasta') || desde;
    if (!esFecha(desde) || !esFecha(hasta)) return { estado: 400, datos: { error: 'Fechas en formato YYYY-MM-DD.' } };
    if (diasEntre(desde, hasta) < 0) return { estado: 400, datos: { error: '"desde" no puede ser después de "hasta".' } };
    if (diasEntre(desde, hasta) > MAX_DIAS) return { estado: 400, datos: { error: `Máximo ${MAX_DIAS} días por consulta.` } };
    let lista = sql.all(desde, hasta);
    const estados = String(parametros.get('estado') || '').toUpperCase().split(',').filter(Boolean);
    if (estados.length) lista = lista.filter((c) => estados.includes(c.estado));
    return {
      estado: 200,
      datos: { zona_horaria: config.zonaHoraria, desde, hasta, total: lista.length, citas: lista.map(aCita) },
    };
  }

  return { activa, citas };
}

module.exports = { crearApi, aCita };
