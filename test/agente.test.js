const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearConversacionLibre } = require('../src/libre');
const { crearAgente, verificar, placaValida } = require('../src/agente');

const horario = { desde: '08:30', hasta: '15:30' };
const cfg = {
  horario: { 1: horario, 2: horario, 3: horario, 4: horario, 5: horario, 6: horario },
  intervaloMinutos: 30,
  capacidadPorHora: 2,
  citasPorDia: 4,
  diasAdelante: 14,
  anticipacionMinutos: 120,
  cerrarFestivos: true,
  servicios: { REVISION: {}, SINCRONIZACION: {} },
};
// Lunes 19 de octubre de 2026, 7:28 a. m. en Colombia (caso real de Omar).
const reloj = () => new Date('2026-10-19T12:28:00Z');
const TEL = '3153368600';

let agenda;
beforeEach(() => {
  agenda = crearAgenda(abrir(':memory:'), cfg, reloj);
});

const textos = (r) => [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean);
const silencio = (fn) => async (...a) => {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    return await fn(...a);
  } finally {
    console.log = log;
    console.warn = warn;
  }
};

// Conversación con una IA de mentiras que responde lo que le digamos, para ver qué deja pasar la app.
function conIA(respuestas, { modo = 'si' } = {}) {
  const ia = { activa: true, json: async () => respuestas.shift(), extraer: async () => ({}), redactar: async () => null };
  const agente = crearAgente({ ia, agenda, reloj, modo, telefonos: TEL });
  const libre = crearConversacionLibre(agenda, { ia, agente, reloj });
  return silencio(async (mensajes) => {
    let estado = null;
    const salida = [];
    for (const mensaje of mensajes) {
      const r = await libre.responder({ estado, mensaje, servicio: 'REVISION', contacto: { telefono: TEL }, lead: '7' });
      salida.push(r);
      estado = r.siguiente || r.cerrado || null;
    }
    return salida;
  });
}

test('placas: corrige la letra O por cero (caso real NCY O66) y rechaza lo que no es placa', () => {
  assert.equal(placaValida('NCY O66'), 'NCY066');
  assert.equal(placaValida('ncy-066'), 'NCY066');
  assert.equal(placaValida('ABC12D'), null); // placa de moto: no atendemos motos
  assert.equal(placaValida('GYN9823'), null);
  assert.equal(placaValida('hola'), null);
});

test('paredes: solo turnos libres, un solo turno, sin rangos, sin tono prohibido', () => {
  const libres = new Set(['2026-10-20 15:30', '2026-10-21 15:30']);
  const base = { libres, datos: {}, texto: 'omar lopera, ford edge 2019, GYN982 3:30 pm', servicio: 'REVISION' };
  const ofrecer = (mensaje, turno = { fecha: '2026-10-20', hora: '15:30' }) => verificar({ accion: 'ofrecer', turno, mensaje, datos: {} }, base);
  assert.equal(ofrecer('¿Te sirve mañana martes 20 a las 3:30 p. m.?').ok, true);
  assert.match(ofrecer('¿Te sirve el martes 20 a las 3:30?', { fecha: '2026-10-20', hora: '09:00' }).razon, /no libre/);
  assert.match(ofrecer('Tenemos de 8:30 a 3:30, ¿cuál prefieres?').razon, /rango/);
  assert.match(ofrecer('Te sirve el martes 20 a las 3:30 o el miércoles 21 a las 10?').razon, /números/);
  assert.match(ofrecer('Uy, el martes 20 a las 3:30 p. m. ¿te sirve?').razon, /tono/);
  assert.match(verificar({ accion: 'agendar', turno: { fecha: '2026-10-20', hora: '15:30' }, datos: { nombre: 'Omar' } }, base).razon, /incompletos/);
  assert.match(verificar({ accion: 'inventar' }, base).razon, /desconocida/);
  // Las frases fijas del taller (horario, dirección, precio) sí se pueden decir.
  assert.equal(verificar({ accion: 'responder', mensaje: '🕘 Atendemos de lunes a sábado, de 8 a. m. a 5 p. m. La revisión cuesta $60.000.', datos: {} }, base).ok, true);
});

test('caso real Omar: pico y placa el martes → la IA ofrece otro día y la app lo deja pasar; luego agenda', async () => {
  agenda.bloquear({ fecha: '2026-10-19', motivo: 'Lleno' });
  const charla = conIA([
    { accion: 'ofrecer', datos: { nombre: 'Omar Lopera', vehiculo: 'Ford Edge 2019', placa: 'GYN982' }, turno: { fecha: '2026-10-20', hora: '15:30' }, mensaje: 'Recibido 🙌 ¿Te queda bien mañana martes 20 a las 3:30 p. m.?' },
    { accion: 'ofrecer', datos: {}, turno: { fecha: '2026-10-21', hora: '15:30' }, mensaje: 'Entiendo lo del pico y placa. ¿Te sirve el miércoles 21 a las 3:30 p. m.?' },
    { accion: 'agendar', datos: {}, turno: { fecha: '2026-10-21', hora: '15:30' }, mensaje: '' },
  ]);
  const [primero, picoYPlaca, si] = await charla(['omar lopera , ford edge, 2019, GYN9823:30 pm', 'cómo pueden ver el martes tengo pico y placa', 'sí']);
  assert.equal(primero.data.decidio, 'ia');
  assert.deepEqual(primero.siguiente.propuesta, { fecha: '2026-10-20', hora: '15:30' });
  assert.match(textos(picoYPlaca).join(' '), /miércoles 21 a las 3:30/);
  assert.deepEqual(picoYPlaca.siguiente.rechazadas, ['2026-10-20 15:30']);
  assert.equal(si.estado, 'listo');
  assert.deepEqual([si.cita.cliente, si.cita.placa, si.cita.fecha, si.cita.hora], ['Omar Lopera', 'GYN982', '2026-10-21', '15:30']);
});

test('caso real José: placa con O y sábado 24 a las 11 → agenda de una', async () => {
  const charla = conIA([
    { accion: 'agendar', datos: { nombre: 'José Daniel Ñañez', vehiculo: 'Chevrolet Captiva 2012', placa: 'NCY O66' }, turno: { fecha: '2026-10-24', hora: '11:00' }, mensaje: '' },
  ]);
  const [r] = await charla(['José Daniel Ñañez\nCamioneta captiva 2012\nPlaca NCY O66\nSabado 24 oct  11 am']);
  assert.equal(r.estado, 'listo');
  assert.equal(r.cita.placa, 'NCY066');
});

test('si la IA se sale de las paredes, no se hace lo que dijo y el bot se calla (no responden reglas)', async () => {
  const charla = conIA([{ accion: 'ofrecer', datos: {}, turno: { fecha: '2026-10-20', hora: '15:30' }, mensaje: 'Tenemos libre de 8:30 a 3:30, dime cuál.' }]);
  const [r] = await charla(['Juan Pérez, Mazda 3 2018, ABC123, el martes']);
  assert.equal(r.estado, 'asesor');
  assert.equal(r.data.motivo, 'ia_no_pudo');
  assert.deepEqual(textos(r), []);
});

test('cortar: la IA decide cortar y el bot no le escribe nada al cliente', async () => {
  const charla = conIA([{ accion: 'cortar', motivo: 'pregunta por otro servicio' }]);
  const [r] = await charla(['¿hacen latonería?']);
  assert.equal(r.estado, 'asesor');
  assert.deepEqual(textos(r), []);
  assert.match(r.data.motivo, /^ia: pregunta por otro servicio/);
});

test('modo prueba: el agente solo atiende los celulares de prueba; los demás siguen con reglas', async () => {
  const ia = { activa: true, json: async () => ({ accion: 'cortar', motivo: 'x' }), extraer: async () => ({}), redactar: async () => null };
  const agente = crearAgente({ ia, agenda, reloj, modo: 'prueba', telefonos: TEL });
  assert.equal(agente.paraQuien(`57${TEL}`), true);
  assert.equal(agente.paraQuien('573001112233'), false);
  assert.equal(crearAgente({ ia, agenda, reloj, modo: '' }).paraQuien(`57${TEL}`), false);
});

test('respeto: rechaza confianzas, jerga, presión y signos repetidos', () => {
  const libres = new Set(['2026-10-20 15:30']);
  const base = { libres, datos: {}, texto: 'el martes a las 3:30', servicio: 'REVISION' };
  const di = (mensaje) => verificar({ accion: 'ofrecer', turno: { fecha: '2026-10-20', hora: '15:30' }, mensaje, datos: {} }, base);
  assert.equal(di('Con gusto. ¿Te sirve el martes 20 a las 3:30 p. m.?').ok, true);
  assert.match(di('Listo hermano, ¿te sirve el martes 20 a las 3:30?').razon, /confianza/);
  assert.match(di('Parce, ¿te sirve el martes 20 a las 3:30?').razon, /confianza/);
  assert.match(di('¿Te sirve el martes 20 a las 3:30? Apúrate que se acaban los cupos').razon, /presiona/);
  assert.match(di('¿Te sirve el martes 20 a las 3:30??').razon, /signos/);
  // "correcto" no es "córrele".
  assert.equal(di('Correcto. ¿Te sirve el martes 20 a las 3:30 p. m.?').ok, true);
});

test('el agente queda encendido para todos si no se configura nada; AGENTE=no lo apaga', () => {
  const ia = { activa: true, json: async () => null };
  const antes = process.env.AGENTE;
  delete process.env.AGENTE;
  try {
    assert.equal(crearAgente({ ia, agenda, reloj }).paraQuien('573001112233'), true);
    assert.equal(crearAgente({ ia, agenda, reloj, modo: 'no' }).paraQuien('573001112233'), false);
  } finally {
    if (antes !== undefined) process.env.AGENTE = antes;
  }
});

test('naturalidad: no repite la misma entrada ni el emoji del mensaje anterior; "más tarde" no es media hora', () => {
  const { pulir } = require('../src/agente');
  assert.equal(pulir('Con gusto. ¿Te sirve el jueves 22 a las 1:00 p. m.? 👍', 'Con gusto. ¿Te sirve el jueves 22 a las 12:30 p. m.? 👍'), '¿Te sirve el jueves 22 a las 1:00 p. m.?');
  assert.equal(pulir('Perfecto. ¿Te sirve el jueves 22 a las 3:00 p. m.?', 'Gracias por los datos.'), 'Perfecto. ¿Te sirve el jueves 22 a las 3:00 p. m.?');
  // Los emojis de datos fijos se quedan.
  assert.match(pulir('📍 Estamos en la Av. 6 Norte #18-22. ¿Te sirve mañana?', 'Hola 🙌'), /^📍/);

  const libres = new Set(['2026-10-22 13:00', '2026-10-22 15:00']);
  const base = { libres, datos: {}, texto: 'más tarde', servicio: 'REVISION', propuesta: { fecha: '2026-10-22', hora: '12:30' } };
  const ofrecer = (hora, mensaje) => verificar({ accion: 'ofrecer', turno: { fecha: '2026-10-22', hora }, mensaje, datos: {} }, base);
  assert.match(ofrecer('13:00', '¿Te sirve el jueves 22 a la 1:00 p. m.?').razon, /más tarde/);
  assert.equal(ofrecer('15:00', '¿Te sirve el jueves 22 a las 3:00 p. m.?').ok, true);
});

test('el saco de dinero no sale nunca en los mensajes', () => {
  const { pulir } = require('../src/agente');
  assert.equal(pulir('💰 La revisión cuesta $60.000. ¿Te sirve mañana?'), 'La revisión cuesta $60.000. ¿Te sirve mañana?');
  assert.equal(pulir('La revisión cuesta $60.000 💰'), 'La revisión cuesta $60.000');
});

test('caso real Francisco: cliente sin celular en Kommo → la IA lo pide una vez, lo guarda y agenda (sin bucle)', silencio(async () => {
  const respuestas = [
    { accion: 'agendar', datos: { nombre: 'Francisco Ruiz', vehiculo: 'Kia Picanto 2018', placa: 'FRA123', telefono: null }, turno: { fecha: '2026-10-24', hora: '11:00' }, mensaje: '' },
    { accion: 'agendar', datos: { telefono: '321 2857455' }, turno: { fecha: '2026-10-24', hora: '11:00' }, mensaje: '' },
  ];
  const ia = { activa: true, json: async () => respuestas.shift(), extraer: async () => ({}), redactar: async () => null };
  const agente = crearAgente({ ia, agenda, reloj, modo: 'si' });
  const libre = crearConversacionLibre(agenda, { ia, agente, reloj });
  const sinCelular = {}; // escribió desde una cuenta sin número
  const pide = await libre.responder({ estado: null, mensaje: 'Francisco Ruiz, Picanto 2018, FRA123, sábado a las 11', servicio: 'REVISION', contacto: sinCelular, lead: '9' });
  assert.equal(pide.estado, 'esperar');
  assert.match(textos(pide)[0], /número de celular/);
  assert.deepEqual(pide.siguiente.propuesta, { fecha: '2026-10-24', hora: '11:00' });
  const listo = await libre.responder({ estado: pide.siguiente, mensaje: '321 2857455', servicio: 'REVISION', contacto: sinCelular, lead: '9' });
  assert.equal(listo.estado, 'listo');
  assert.deepEqual([listo.cita.telefono, listo.cita.fecha, listo.cita.hora], ['573212857455', '2026-10-24', '11:00']);
}));

test('placa de carro con la letra O al final (ABC12O) es un carro, no una moto', () => {
  assert.equal(placaValida('ABC12O'), 'ABC120');
  assert.equal(placaValida('NCY O66'), 'NCY066');
});
