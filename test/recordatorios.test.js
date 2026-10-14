const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearRecordatorios } = require('../src/recordatorios');

// Martes 13 de octubre de 2026 a la hora dada (Colombia es UTC-5).
const a = (hora) => () => new Date(`2026-10-13T${hora}:00-05:00`);

function preparar(reloj) {
  const db = abrir(':memory:');
  const agenda = crearAgenda(db, undefined, () => new Date('2026-10-12T13:00:00Z'));
  const cita = (fecha, hora, lead, telefono) =>
    agenda.reservar({ servicio: 'REVISION', fecha, hora, cliente: 'X', telefono, kommoLead: lead }, { origen: 'BOT' });
  const movidos = [];
  const kommo = { activo: true, moverLead: async (lead, etapa) => movidos.push([lead, etapa]) };
  return { db, agenda, cita, movidos, recordatorios: crearRecordatorios({ agenda, kommo, etapa: '999', encendido: true, reloj }) };
}

test('a las 7 a. m. pasa a RECORDATORIO los leads con cita mañana, una sola vez', async () => {
  const { cita, movidos, recordatorios, agenda } = preparar(a('07:05'));
  cita('2026-10-14', '09:00', '11', '3001110001');
  cita('2026-10-14', '10:00', '11', '3001110001'); // mismo lead: un solo recordatorio
  cita('2026-10-14', '11:00', '22', '3001110002');
  cita('2026-10-15', '09:00', '33', '3001110003'); // pasado mañana: todavía no
  const cancelada = cita('2026-10-14', '12:00', '44', '3001110004');
  agenda.cancelar(cancelada.id);

  await recordatorios.revisar();
  assert.deepEqual(movidos, [['11', '999'], ['22', '999']]);
  await recordatorios.revisar();
  assert.equal(movidos.length, 2);
});

test('antes de las 7 a. m. no manda nada', async () => {
  const { cita, movidos, recordatorios } = preparar(a('06:50'));
  cita('2026-10-14', '09:00', '11', '3001110001');
  await recordatorios.revisar();
  assert.deepEqual(movidos, []);
});

test('al reprogramar, la cita nueva del mismo lead cancela la anterior', () => {
  const { cita, agenda } = preparar(a('07:00'));
  const vieja = cita('2026-10-14', '09:00', '11', '3001110001');
  const nueva = cita('2026-10-16', '10:00', '11', '3001110001');
  const canceladas = agenda.cancelarOtrasDelLead('11', nueva.id);
  assert.deepEqual(canceladas.map((c) => c.id), [vieja.id]);
  assert.equal(agenda.cita(vieja.id).estado, 'CANCELADA');
  assert.equal(agenda.cita(nueva.id).estado, 'AGENDADA');
});

test('busca la etapa RECORDATORIO por nombre si no se fijó el número', async () => {
  const db = abrir(':memory:');
  const agenda = crearAgenda(db, undefined, () => new Date('2026-10-12T13:00:00Z'));
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-14', hora: '09:00', cliente: 'X', telefono: '3001110001', kommoLead: '11' }, { origen: 'BOT' });
  const movidos = [];
  const kommo = { activo: true, etapaPorNombre: async (n) => (n === 'RECORDATORIO' ? 777 : null), moverLead: async (l, e) => movidos.push([l, e]) };
  await crearRecordatorios({ agenda, kommo, etapa: '', encendido: true, reloj: a('07:00') }).revisar();
  assert.deepEqual(movidos, [['11', 777]]);
});

test('apagados por defecto: no mueven nada sin RECORDATORIOS=si', async () => {
  const { cita, movidos, agenda } = preparar(a('07:05'));
  cita('2026-10-14', '09:00', '11', '3001110001');
  const apagados = crearRecordatorios({ agenda, kommo: { activo: true, moverLead: async (l) => movidos.push(l) }, etapa: '999', encendido: false, reloj: a('07:05') });
  assert.equal(apagados.activo, false);
  await apagados.revisar();
  assert.deepEqual(movidos, []);
});
