const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearConversacionLibre } = require('../src/libre');
const { crearAgente } = require('../src/agente');
const { tienePicoYPlaca, diaDePicoYPlaca } = require('../src/picoyplaca');

// Domingo 25 de octubre de 2026, 9 a. m. en Colombia. El lunes 26 es lunes; el martes 27, martes…
const reloj = () => new Date('2026-10-25T14:00:00Z');
const textos = (r) => [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean);
const agendaReal = () => crearAgenda(abrir(':memory:'), undefined, reloj); // con la tabla de pico y placa de config.js

test('tabla de pico y placa: lunes 0-9, martes 1-2, miércoles 3-4, jueves 5-6, viernes 7-8; sábado libre', () => {
  assert.deepEqual(config.picoYPlaca, { 1: [0, 9], 2: [1, 2], 3: [3, 4], 4: [5, 6], 5: [7, 8] });
  assert.equal(tienePicoYPlaca('CQW979', '2026-10-26'), true); // lunes, termina en 9
  assert.equal(tienePicoYPlaca('CQW979', '2026-10-27'), false); // martes
  assert.equal(tienePicoYPlaca('ABC121', '2026-10-27'), true); // martes, termina en 1
  assert.equal(tienePicoYPlaca('ABC128', '2026-10-30'), true); // viernes, termina en 8
  assert.equal(tienePicoYPlaca('ABC128', '2026-10-31'), false); // sábado: no hay
  assert.equal(diaDePicoYPlaca('CQW979'), 'lunes');
  assert.equal(diaDePicoYPlaca('ABC125'), 'jueves');
});

test('la agenda no guarda una cita el día de pico y placa (a mano se puede forzar)', () => {
  const agenda = agendaReal();
  const cita = (opciones) => agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-26', hora: '09:00', cliente: 'X', telefono: '3001234567', placa: 'CQW979' }, opciones);
  assert.throws(() => cita({ origen: 'BOT' }), /pico y placa/);
  assert.throws(() => cita({ origen: 'MANUAL' }), /pico y placa/);
  assert.equal(cita({ origen: 'MANUAL', forzar: true }).placa, 'CQW979');
});

test('bot de reglas: CQW979 pide el lunes → le dice que tiene pico y placa y le ofrece otro día', async () => {
  const libre = crearConversacionLibre(agendaReal(), { reloj });
  const r = await libre.responder({ estado: null, mensaje: 'Mario Rincón, Nissan March 2018, CQW979, el lunes a las 9', servicio: 'REVISION', contacto: { telefono: '3001234567' }, lead: '1' });
  assert.equal(r.estado, 'esperar');
  assert.match(textos(r).join(' '), /El lunes 26 tu vehículo tiene pico y placa \(placa terminada en 9\)/);
  assert.notEqual(r.siguiente.propuesta.fecha, '2026-10-26');
  assert.equal(r.siguiente.propuesta.fecha, '2026-10-27'); // el siguiente día, misma hora
});

test('agente: los días de pico y placa del vehículo no le llegan a la IA en TURNOS LIBRES y no se pueden agendar', async () => {
  const agenda = agendaReal();
  let usuario = '';
  const respuestas = [{ accion: 'agendar', datos: { nombre: 'Mario Rincón', vehiculo: 'Nissan March 2018', placa: 'CQW979' }, turno: { fecha: '2026-10-26', hora: '09:00' }, mensaje: '' }];
  const ia = { activa: true, json: async (p) => { usuario = p.usuario; return respuestas.shift(); } };
  const agente = crearAgente({ ia, agenda, reloj, modo: 'si' });
  const libre = crearConversacionLibre(agenda, { ia, agente, reloj });
  const { log, warn } = console;
  console.log = console.warn = () => {};
  let r;
  try {
    r = await libre.responder({ estado: null, mensaje: 'Mario Rincón, Nissan March 2018, CQW979, el lunes a las 9', servicio: 'REVISION', contacto: { telefono: '3001234567' }, lead: '1' });
  } finally {
    console.log = log;
    console.warn = warn;
  }
  assert.doesNotMatch(usuario, /2026-10-26 lunes/);
  assert.match(usuario, /PICO Y PLACA DEL VEHÍCULO: los lunes \(placa terminada en 9\)/);
  // La IA quiso agendar el lunes igual: la app no lo deja (no se agenda nada) y el bot se calla.
  assert.equal(r.estado, 'asesor');
  assert.equal(agenda.dia('2026-10-26').totalCitas, 0);
});
