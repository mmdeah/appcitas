const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearBot } = require('../src/bot');
const { crearConversaciones } = require('../src/conversaciones');
const { crearAtencion } = require('../src/atencion');
const { crearConversacionLibre, fechaEscrita, horaEscrita, partir } = require('../src/libre');

const horario = { desde: '08:30', hasta: '15:30' };
const cfg = {
  horario: { 1: horario, 2: horario, 3: horario, 4: horario, 5: horario, 6: horario },
  intervaloMinutos: 60,
  capacidadPorHora: 2,
  diasAdelante: 14,
  anticipacionMinutos: 120,
  cerrarFestivos: true,
  servicios: { REVISION: {}, SINCRONIZACION: {} },
};
// Martes 6 de octubre de 2026, 8:00 a. m. en Colombia.
const reloj = () => new Date('2026-10-06T13:00:00Z');

let db;
let agenda;
beforeEach(() => {
  db = abrir(':memory:');
  agenda = crearAgenda(db, cfg, reloj);
});

const textos = (r) => [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean);

// Simula una conversación y revisa los límites de Kommo en cada respuesta.
async function charla(libre, mensajes, contacto = { telefono: '300 123 4567' }) {
  let estado = null;
  const respuestas = [];
  for (const mensaje of mensajes) {
    const r = await libre.responder({ estado, mensaje, servicio: 'REVISION', contacto, lead: '55' });
    for (const t of textos(r)) assert.ok([...t].length <= 80, `más de 80: ${t}`);
    assert.ok(r.handlers.length + 1 <= 10);
    respuestas.push(r);
    estado = r.siguiente;
  }
  return respuestas;
}

test('lee días y horas escritos sin confundirlos con placas, años ni modelos', () => {
  const hoy = '2026-10-06';
  const t = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9: ]/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(fechaEscrita(t('Mazda 3 2018, el jueves a las 10:30'), hoy), '2026-10-08');
  assert.equal(fechaEscrita(t('mañana en la mañana'), hoy), '2026-10-07');
  assert.equal(fechaEscrita(t('el 14 porfa'), hoy), '2026-10-14');
  assert.equal(fechaEscrita(t('viernes 16'), hoy), '2026-10-16');
  assert.equal(fechaEscrita(t('16 de octubre'), hoy), '2026-10-16');
  assert.equal(fechaEscrita(t('tengo un spark placa ABC123'), hoy), null);
  assert.equal(horaEscrita(t('el jueves a las 10:30')), '10:30');
  assert.equal(horaEscrita(t('a las 2')), '14:00');
  assert.equal(horaEscrita(t('a las 9 y media')), '09:30');
  assert.equal(horaEscrita(t('3 pm')), '15:00');
  assert.equal(horaEscrita(t('2 de la tarde')), '14:00');
  assert.equal(horaEscrita(t('Spark 2015 ABC123')), null);
  assert.equal(horaEscrita(t('10'), true), '10:00');
});

test('sin IA: toma lo que entiende y pregunta lo que falta hasta confirmar y guardar', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const [primero, nombre, vehiculo, confirmar] = await charla(libre, [
    'Hola, quiero la revisión el jueves a las 10:30, placa ABC123',
    'Juan Pérez',
    'Chevrolet Spark 2015',
    'sí',
  ]);
  assert.deepEqual(textos(primero), ['Anotado ✍️', '¿A nombre de quién agendo la cita?', 'Y también el vehículo (marca, modelo y año).']);
  assert.equal(primero.siguiente.datos.fecha, '2026-10-08');
  assert.equal(primero.siguiente.datos.hora, '10:30');
  assert.deepEqual(textos(nombre), ['Gracias, Juan 🙌', '¿Qué vehículo es? Ej: Mazda 3 2018']);
  assert.equal(nombre.siguiente.datos.nombre, 'Juan Pérez');
  assert.deepEqual(textos(vehiculo), [
    'Te agendo así 👇',
    '🔧 Revisión General Preventiva',
    '📅 Jueves 8 de octubre, 10:30 a. m.',
    '🚗 Chevrolet Spark 2015 · ABC123',
    '👤 Juan Pérez',
    '¿Confirmo la cita? Responde SÍ o dime qué cambio ✍️',
  ]);
  assert.equal(confirmar.estado, 'listo');
  const c = confirmar.cita;
  assert.deepEqual(
    [c.fecha, c.hora, c.cliente, c.vehiculo, c.placa, c.telefono, c.origen, c.kommo_lead],
    ['2026-10-08', '10:30', 'Juan Pérez', 'Chevrolet Spark 2015', 'ABC123', '573001234567', 'BOT', '55']
  );
});

test('con IA: un solo mensaje con todo va directo a confirmar', async () => {
  const ia = {
    activa: true,
    extraer: async ({ mensaje }) =>
      /soy ana/i.test(mensaje)
        ? { nombre: 'Ana Gómez', vehiculo: 'Renault Duster 2019', placa: 'jkl-456', fecha: '2026-10-09', hora: '14:30', confirma: null, asesor: false }
        : { confirma: true },
  };
  const libre = crearConversacionLibre(agenda, { ia, reloj });
  const [resumen, listo] = await charla(libre, ['soy ana, duster 2019 jkl456, el viernes tipo 2:30 de la tarde', 'dale']);
  assert.equal(resumen.siguiente.confirmando, true);
  assert.match(textos(resumen).join(' '), /Viernes 9 de octubre, 2:30 p\. m\./);
  assert.equal(listo.estado, 'listo');
  assert.equal(listo.cita.placa, 'JKL456');
});

test('si la IA falla, sigue con reglas sin romperse', async () => {
  const ia = { activa: true, extraer: async () => { throw new Error('caída'); } };
  const libre = crearConversacionLibre(agenda, { ia, reloj });
  const aviso = console.warn;
  console.warn = () => {};
  try {
    const [r] = await charla(libre, ['el viernes a las 9 y media, placa XYZ789']);
    assert.equal(r.estado, 'esperar');
    assert.deepEqual([r.siguiente.datos.fecha, r.siguiente.datos.hora, r.siguiente.datos.placa], ['2026-10-09', '09:30', 'XYZ789']);
  } finally {
    console.warn = aviso;
  }
});

test('hora ocupada o día sin cupo: propone opciones reales', async () => {
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-08', hora: '10:30', cliente: 'X', telefono: '3000000001' });
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-08', hora: '10:30', cliente: 'Y', telefono: '3000000002' });
  const libre = crearConversacionLibre(agenda, { reloj });
  const [ocupada] = await charla(libre, ['el jueves a las 10:30']);
  assert.deepEqual(textos(ocupada), ['A las 10:30 a. m. no tengo cupo ese día 😕', 'Tengo libre: 8:30, 9:30, 11:30 am. ¿Cuál prefieres?']);
  assert.equal(ocupada.siguiente.preguntando, 'hora');

  const [domingo] = await charla(libre, ['el domingo']);
  assert.equal(textos(domingo)[0], 'El domingo 11 de octubre no tengo cupo 😕');
  assert.equal(domingo.siguiente.datos.fecha, null);
});

test('al confirmar puede cambiar un dato y vuelve a mostrar el resumen', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const r = await charla(libre, ['el jueves a las 10:30 placa ABC123', 'Juan', 'Mazda 3 2018', 'no', 'mejor el viernes', 'si']);
  assert.match(textos(r[3]).join(' '), /Qué quieres cambiar/);
  assert.match(textos(r[4]).join(' '), /Viernes 9 de octubre, 10:30 a\. m\./);
  assert.equal(r[5].estado, 'listo');
  assert.equal(r[5].cita.fecha, '2026-10-09');
});

test('pide asesor o no avanza 3 veces: pasa a asesor', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const [asesor] = await charla(libre, ['quiero hablar con un asesor']);
  assert.equal(asesor.estado, 'asesor');
  const r = await charla(libre, ['hola', 'ok', 'jaja']);
  assert.equal(r[2].estado, 'asesor');
  assert.equal(r[2].data.motivo, 'no_entendio');
});

test('Kommo con Paso = seguir y sin conversación guardada usa el texto libre', async () => {
  const enviados = [];
  const kommo = { contactoDelLead: async () => ({ telefono: '3001112233' }), continuar: async (u, c) => enviados.push(c), nota: async () => {} };
  const atender = crearAtencion({
    bot: crearBot(agenda, { reloj }),
    conversaciones: crearConversaciones(db),
    kommo,
    libre: crearConversacionLibre(agenda, { reloj }),
  });
  const log = console.log;
  console.log = () => {};
  try {
    await atender({ data: { lead: '9', inicio: 'no', servicio: 'REVISION', mensaje: 'Pedro, Kia Rio 2020 placa QWE123, mañana a las 2' }, return_url: 'x' });
    await atender({ data: { lead: '9', inicio: 'no', mensaje: 'si' }, return_url: 'x' });
  } finally {
    console.log = log;
  }
  // Sin IA el nombre no se puede sacar de una frase larga: lo pregunta.
  assert.equal(enviados[0].data.estado, 'texto');
  for (const e of enviados) for (const h of e.execute_handlers) assert.equal(h.handler, 'show');
});

test('parte textos largos en mensajes de 80 caracteres sin cortar palabras', () => {
  const partes = partir('Para agendarte me falta: tu nombre, el vehículo (marca, modelo y año), la placa, el día y la hora ✍️');
  assert.ok(partes.length === 2);
  for (const p of partes) assert.ok([...p].length <= 80);
});
