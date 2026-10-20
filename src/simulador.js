// Simulador del bot (sección Bot de la app): una conversación de práctica con el mismo agente y las mismas reglas,
// sobre una COPIA de la agenda real. Nunca agenda de verdad ni le escribe a nadie.

const { abrir } = require('./db');
const { crearAgenda } = require('./agenda');
const { crearConversacionLibre } = require('./libre');
const { crearAgente } = require('./agente');
const { crearMemoria } = require('./memoria');

// Ejemplos para probar rápido (botones del simulador).
const EJEMPLOS = [
  'Juan Pérez, Mazda 3 2018, ABC123, el jueves a las 10',
  'Hola, ¿cuánto vale la revisión y dónde quedan?',
  'el martes tengo pico y placa',
  'José Ñañez, Captiva 2012, placa NCY O66, sábado 11 am',
  'no me sirve tan temprano',
  'sí, dale',
  'ya te confirmo, gracias',
  '¿hacen cambio de aceite?',
];

function crearSimulador({ dbReal, ia, reloj = () => new Date() }) {
  let sesion = null;

  // Copia las citas y bloqueos reales a una base en memoria: el bot ve los turnos libres de verdad.
  function nuevaSesion() {
    const db = abrir(':memory:');
    const citas = dbReal.prepare(`SELECT * FROM citas WHERE estado <> 'CANCELADA'`).all();
    const insertarCita = db.prepare(
      'INSERT INTO citas (id, servicio, fecha, hora, puesto, cliente, telefono, vehiculo, placa, notas, estado, origen, kommo_lead) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const c of citas) {
      insertarCita.run(c.id, c.servicio, c.fecha, c.hora, c.puesto, c.cliente, c.telefono, c.vehiculo, c.placa, c.notas, c.estado, c.origen, c.kommo_lead);
    }
    const insertarBloqueo = db.prepare('INSERT INTO bloqueos (fecha, hora, motivo) VALUES (?, ?, ?)');
    for (const b of dbReal.prepare('SELECT * FROM bloqueos').all()) insertarBloqueo.run(b.fecha, b.hora, b.motivo);

    const agenda = crearAgenda(db, undefined, reloj);
    const turnos = [];
    const agente = crearAgente({ ia, agenda, reloj, fijo: true, alDecidir: (info) => turnos.push(info) });
    const libre = crearConversacionLibre(agenda, { ia, agente, memoria: crearMemoria(db), reloj });
    sesion = { libre, turnos, estado: null, chat: [], terminada: false };
    return sesion;
  }

  // Manda un mensaje como cliente y guarda la respuesta junto con "lo que pensó" el bot.
  async function enviar(mensaje) {
    if (!sesion) nuevaSesion();
    const texto = String(mensaje || '').trim().slice(0, 600);
    if (!texto) return sesion;
    const antes = sesion.turnos.length;
    const r = await sesion.libre.responder({
      estado: sesion.estado,
      mensaje: texto,
      servicio: 'REVISION',
      contacto: { telefono: '3000000000' },
      lead: 'simulador',
    });
    const pensamiento = sesion.turnos.slice(antes).pop() || null;
    sesion.chat.push({
      cliente: texto,
      bot: r.estado === 'asesor' ? [] : [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean),
      estado: r.estado,
      motivo: r.data.motivo || null,
      decidio: r.data.decidio === 'ia' ? 'ia' : 'reglas',
      pensamiento,
      cita: r.cita || null,
    });
    sesion.estado = r.siguiente || r.cerrado || null;
    sesion.terminada = r.estado === 'listo';
    return sesion;
  }

  return { sesion: () => sesion, nuevaSesion, enviar, EJEMPLOS };
}

module.exports = { crearSimulador, EJEMPLOS };
