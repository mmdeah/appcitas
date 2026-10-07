const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearBot, elegirDia, elegirHora, etiquetaDia, separarPlaca, limpiarNombre, MAX_TEXTO } = require('../src/bot');
const { crearConversaciones } = require('../src/conversaciones');
const { crearAtencion } = require('../src/atencion');

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
let bot;
beforeEach(() => {
  db = abrir(':memory:');
  agenda = crearAgenda(db, cfg, reloj);
  bot = crearBot(agenda, { reloj });
});

// Revisa que todo lo que se le manda a Kommo respete sus límites.
function revisarLimites(r) {
  for (const h of r.handlers) {
    assert.ok([...h.params.value].length <= MAX_TEXTO, `texto de más de 80: ${h.params.value}`);
    for (const b of h.params.buttons || []) assert.ok([...b].length <= 20, `botón de más de 20: ${b}`);
  }
  assert.ok(r.handlers.length <= 10);
}

function charla(mensajes, inicio = {}) {
  let r = bot.responder({ inicio: true, servicio: 'REVISION', lead: '123', ...inicio });
  const respuestas = [r];
  for (const mensaje of mensajes) {
    r = bot.responder({ estado: r.siguiente, mensaje });
    respuestas.push(r);
  }
  respuestas.forEach(revisarLimites);
  return respuestas;
}

test('agenda una cita completa desde WhatsApp', () => {
  const [dias, horas, nombre, vehiculo, listo] = charla(
    ['Mañana, miércoles 7', '10:30 a. m.', 'Me llamo Juan Pérez', 'Mazda 3 2018, abc-123'],
    { contacto: { nombre: 'Juancho', telefono: '+57 300 123 4567' } }
  );

  assert.equal(dias.estado, 'esperar');
  assert.equal(dias.handlers[0].params.value, '¿Qué día te queda bien para la revisión? Toca el botón y elige un día 👇');
  assert.deepEqual(dias.handlers[0].params.buttons, [
    'Hoy, martes 6', 'Mañana, miércoles 7', 'Jueves 8', 'Viernes 9', 'Sábado 10', 'Martes 13',
  ]);
  assert.equal(horas.handlers[0].params.value, 'Horas libres el miércoles 7 de octubre. Toca el botón y elige una 👇');
  assert.equal(horas.handlers[0].params.buttons.at(-1), 'Ver otros días');
  assert.equal(nombre.handlers[0].params.value, '¿A nombre de quién agendo la cita? Escríbeme tu nombre 😊');
  assert.match(vehiculo.handlers[0].params.value, /vehículo/);

  assert.equal(listo.estado, 'listo');
  assert.equal(listo.data.estado, 'listo');
  assert.equal(listo.siguiente, null);
  assert.equal(listo.handlers.length, 3);
  assert.match(listo.handlers[0].params.value, /Listo, Juan! Agendé tu Revisión General Preventiva/);
  const cita = listo.cita;
  assert.deepEqual(
    [cita.fecha, cita.hora, cita.cliente, cita.vehiculo, cita.placa, cita.telefono, cita.origen, cita.kommo_lead],
    ['2026-10-07', '10:30', 'Juan Pérez', 'Mazda 3 2018', 'ABC123', '573001234567', 'BOT', '123']
  );
});

test('ignora una sola vez el mensaje que arrancó el paso', () => {
  const r1 = bot.responder({ inicio: true, servicio: 'REVISION', lead: '9', mensaje: 'prueba agenda' });
  // Kommo reenvía "prueba agenda" como primera respuesta: no se contesta nada y se sigue esperando el día.
  const r2 = bot.responder({ estado: r1.siguiente, mensaje: 'Prueba agenda' });
  assert.equal(r2.estado, 'esperar');
  assert.deepEqual(r2.handlers, []);
  assert.equal(r2.siguiente.paso, 'dia');
  assert.ok(!('mensajeInicial' in r2.siguiente));
  // Si lo vuelve a escribir, ya se toma como respuesta.
  const r3 = bot.responder({ estado: r2.siguiente, mensaje: 'prueba agenda' });
  assert.equal(r3.handlers[0].params.value, 'No te entendí 🙈 Toca el botón de abajo y elige un día de la lista 👇');
  // Si la primera respuesta es distinta, se procesa normal.
  const r4 = bot.responder({ estado: r1.siguiente, mensaje: 'Jue 8 oct' });
  assert.equal(r4.siguiente.paso, 'hora');
});

test('hoy solo ofrece horas con 2 horas de anticipación', () => {
  const [, horas] = charla(['hoy']);
  assert.equal(horas.handlers[0].params.buttons[0], '10:30 a. m.');
});

test('entiende días y horas escritos a mano', () => {
  const hoy = '2026-10-06';
  const dias = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-10'].map((fecha) => ({ fecha, etiqueta: fecha }));
  assert.equal(elegirDia('el jueves porfa', dias, hoy).fecha, '2026-10-08');
  assert.equal(elegirDia('mañana', dias, hoy).fecha, '2026-10-07');
  assert.equal(elegirDia('Hoy', dias, hoy).fecha, '2026-10-06');
  assert.equal(elegirDia('sábado 10', dias, hoy).fecha, '2026-10-10');
  assert.equal(elegirDia('el 8', dias, hoy).fecha, '2026-10-08');
  assert.equal(elegirDia('domingo', dias, hoy), null);
  assert.equal(elegirDia('cuando puedan', dias, hoy), null);

  const horas = ['08:30', '10:30', '14:30', '15:30'];
  assert.equal(elegirHora('2:30 pm', horas), '14:30');
  assert.equal(elegirHora('a las 2', horas), '14:30');
  assert.equal(elegirHora('830', horas), '08:30');
  assert.equal(elegirHora('10', horas), '10:30');
  assert.equal(elegirHora('15:30', horas), '15:30');
  assert.equal(elegirHora('3:30 p. m.', horas), '15:30');
  assert.equal(elegirHora('9:30', horas), null);
  assert.equal(elegirHora('cuando sea', horas), null);
});

test('separa placa, vehículo y nombre', () => {
  assert.deepEqual(separarPlaca('Mazda 3 2018, abc-123'), { placa: 'ABC123', resto: 'Mazda 3 2018' });
  assert.deepEqual(separarPlaca('placa XYZ 789 chevrolet spark'), { placa: 'XYZ789', resto: 'chevrolet spark' });
  assert.equal(separarPlaca('moto AKT abc12d').placa, 'ABC12D');
  assert.equal(separarPlaca('Chevrolet Spark').placa, null);
  assert.equal(limpiarNombre('Hola, me llamo Ana María'), 'Ana María');
  assert.equal(limpiarNombre('Soy Pedro.'), 'Pedro');
  assert.equal(limpiarNombre('3001234567'), null);
});

test('si la hora se ocupa mientras el cliente elige, ofrece otra', () => {
  const [, horas, nombre, vehiculo] = charla(['Mié 7 oct', '10:30', 'Ana']);
  assert.ok(horas.handlers[0].params.buttons.includes('10:30 a. m.'));
  // Mientras tanto, dos clientes toman las 10:30 a mano.
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-07', hora: '10:30', cliente: 'X', telefono: '3000000001' });
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-07', hora: '10:30', cliente: 'Y', telefono: '3000000002' });
  const r = bot.responder({ estado: { ...vehiculo.siguiente, telefono: '573001112233' }, mensaje: 'Kia Picanto ABC123' });
  assert.equal(r.estado, 'esperar');
  assert.equal(r.siguiente.paso, 'hora');
  assert.equal(r.handlers[0].params.value, 'Esa hora se acaba de ocupar 😕 Toca el botón y elige otra 👇');
  assert.ok(!r.handlers[0].params.buttons.includes('10:30 a. m.'));
  assert.equal(nombre.siguiente.hora, '10:30');
});

test('pide la placa y el celular cuando faltan', () => {
  const r = charla(['Jue 8 oct', '8:30', 'Luis', 'Chevrolet Spark', 'no sé', 'xyz 789', '123', '300 555 1234']);
  assert.equal(r[4].handlers[0].params.value, '¿Y la placa? Son 3 letras y 3 números. Ej: ABC123');
  assert.match(r[5].handlers[0].params.value, /Escríbeme la placa/);
  assert.match(r[6].handlers[0].params.value, /A qué celular/);
  assert.match(r[7].handlers[0].params.value, /10 dígitos/);
  const listo = r[8];
  assert.equal(listo.estado, 'listo');
  assert.deepEqual([listo.cita.vehiculo, listo.cita.placa, listo.cita.telefono], ['Chevrolet Spark', 'XYZ789', '573005551234']);
});

test('vuelve a preguntar si no entiende, permite cambiar de día y pasar a asesor', () => {
  const [, noEntendio] = charla(['cuando puedan']);
  assert.equal(noEntendio.handlers[0].params.value, 'No te entendí 🙈 Toca el botón de abajo y elige un día de la lista 👇');
  assert.equal(noEntendio.siguiente.paso, 'dia');

  const [, , otroDia] = charla(['Vie 9 oct', 'Ver otros días']);
  assert.equal(otroDia.siguiente.paso, 'dia');

  // Ya dando el nombre, pide cambiar la fecha: vuelve a los días.
  const [, , , cambiar] = charla(['Viernes 9', '8:30', 'quiero cambiar la fecha']);
  assert.equal(cambiar.siguiente.paso, 'dia');

  const [, , asesor] = charla(['Vie 9 oct', 'mejor quiero hablar con un asesor']);
  assert.equal(asesor.estado, 'asesor');
  assert.equal(asesor.data.estado, 'asesor');
});

test('nombres de día claros y cortos para los botones', () => {
  assert.equal(etiquetaDia('2026-10-06', '2026-10-06'), 'Hoy, martes 6');
  assert.equal(etiquetaDia('2026-10-07', '2026-10-06'), 'Mañana, miércoles 7');
  assert.equal(etiquetaDia('2026-10-09', '2026-10-06'), 'Viernes 9');
  assert.equal(etiquetaDia('2026-11-02', '2026-10-28'), 'Lunes 2 de noviembre');
  assert.equal(etiquetaDia('2026-09-30', '2026-08-28'), 'Miércoles 30 sep'); // "de septiembre" no cabe en 20
  assert.equal(etiquetaDia('2026-10-01', '2026-09-30'), 'Mañana, jueves 1');
});

test('para clientes que se confunden', () => {
  // Responde con el número de la opción.
  const [, porNumero] = charla(['2']);
  assert.equal(porNumero.siguiente.fecha, '2026-10-07');
  // "ok" no es un nombre.
  const [, , , okNoEsNombre] = charla(['jueves', '8 y 30', 'ok']);
  assert.equal(okNoEsNombre.siguiente.paso, 'nombre');
  assert.match(okNoEsNombre.handlers[0].params.value, /solo tu nombre/);
  // Solo manda la placa: pide marca y modelo.
  const [, , , , soloPlaca] = charla(['jueves', '10:30', 'Pedro', 'placa abc 123']);
  assert.equal(soloPlaca.siguiente.paso, 'modelo');
  assert.equal(soloPlaca.siguiente.placa, 'ABC123');
  // Tres respuestas que no entiende: pasa a un asesor.
  const [, , , tercera] = charla(['ajá', 'no sé', 'lo que sea']);
  assert.equal(tercera.estado, 'asesor');
  assert.equal(tercera.data.motivo, 'no_entendio');
});

test('sin cupos en los próximos días pasa al asesor', () => {
  const tarde = () => new Date('2026-10-06T21:00:00Z'); // 4:00 p. m., ya no quedan horas hoy
  const sinPlazo = crearBot(crearAgenda(db, { ...cfg, diasAdelante: 0 }, tarde), { reloj: tarde });
  const r = sinPlazo.responder({ inicio: true, servicio: 'REVISION', lead: '1' });
  assert.equal(r.estado, 'asesor');
  assert.equal(r.data.motivo, 'sin_cupos');
});

test('atención completa con Kommo simulado: guarda el paso, responde y deja nota', async () => {
  const enviados = [];
  const notas = [];
  const kommo = {
    contactoDelLead: async () => ({ nombre: 'Ana WA', telefono: '300 111 2233' }),
    continuar: async (url, cuerpo) => enviados.push(cuerpo),
    nota: async (lead, texto) => notas.push({ lead, texto }),
  };
  const conversaciones = crearConversaciones(db);
  const atender = crearAtencion({ bot, conversaciones, kommo });
  const url = 'https://autoonlinesdclientes.kommo.com/api/v4/salesbot/1/continue/2';

  await atender({ data: { lead: '77', inicio: 'si', servicio: 'SINCRONIZACION', mensaje: 'Quiero agendar' }, return_url: url });
  for (const mensaje of ['Vie 9 oct', '8:30 a. m.', 'Ana Gómez', 'Renault Duster 2019 JKL456']) {
    await atender({ data: { lead: '77', inicio: 'no', mensaje }, return_url: url });
  }

  assert.deepEqual(enviados.map((e) => e.data.estado), ['esperar', 'esperar', 'esperar', 'esperar', 'listo']);
  assert.match(enviados[0].execute_handlers[0].params.value, /sincronización/);
  assert.equal(conversaciones.leer('77'), null);
  assert.equal(notas.length, 1);
  assert.match(notas[0].texto, /Sincronización, viernes 9 de octubre a las 8:30 a\. m\..*JKL456/);
  const cita = agenda.dia('2026-10-09').horas[0].citas[0];
  assert.deepEqual([cita.cliente, cita.telefono, cita.kommo_lead], ['Ana Gómez', '573001112233', '77']);
});

test('si algo falla, Kommo igual recibe respuesta y pasa al asesor', async () => {
  const enviados = [];
  const kommo = { contactoDelLead: async () => { throw new Error('caído'); }, continuar: async (u, c) => enviados.push(c), nota: async () => {} };
  const roto = { responder: () => { throw new Error('falla'); } };
  const atender = crearAtencion({ bot: roto, conversaciones: crearConversaciones(db), kommo });
  const errorOriginal = console.error;
  const avisoOriginal = console.warn;
  console.error = console.warn = () => {};
  try {
    await atender({ data: { lead: '5', inicio: 'si' }, return_url: 'x' });
    await atender({ data: { inicio: 'si' }, return_url: 'x' });
  } finally {
    console.error = errorOriginal;
    console.warn = avisoOriginal;
  }
  assert.deepEqual(enviados.map((e) => [e.data.estado, e.data.motivo]), [['asesor', 'error'], ['asesor', 'sin_lead']]);
});
