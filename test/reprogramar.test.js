const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearReprogramaciones } = require('../src/reprogramar');

function preparar({ etapa = 555, enEtapa = [] } = {}) {
  const agenda = crearAgenda(abrir(':memory:'), undefined, () => new Date('2026-10-12T13:00:00Z'));
  const notas = [];
  const movidos = [];
  const kommo = {
    activo: true,
    etapaPorNombre: async (n) => (n === 'REPROGRAMAR' ? etapa : null),
    leadsEnEtapa: async () => enEtapa,
    nota: async (lead, texto) => notas.push([lead, texto]),
    moverLead: async (lead, a) => movidos.push([lead, a]),
  };
  return { agenda, notas, movidos, reprogramaciones: crearReprogramaciones({ agenda, kommo }) };
}

test('reprogramar: el lead en la etapa REPROGRAMAR pierde su cita (la recordada), queda nota y pasa a LLAMAR', async () => {
  const { agenda, notas, movidos, reprogramaciones } = preparar({ enEtapa: ['11', '22'] });
  const cita = (fecha, hora, lead) =>
    agenda.reservar({ servicio: 'REVISION', fecha, hora, cliente: 'X', telefono: '3001110001', kommoLead: lead }, { origen: 'BOT' });
  const recordada = cita('2026-10-14', '09:00', '11');
  const otra = cita('2026-10-20', '10:00', '11'); // otra cita del mismo cliente: no se toca
  agenda.marcarRecordada(recordada.id);

  const canceladas = await reprogramaciones.revisar();
  assert.deepEqual(canceladas, [recordada.id]);
  assert.equal(agenda.cita(recordada.id).estado, 'CANCELADA');
  assert.equal(agenda.cita(otra.id).estado, 'AGENDADA');
  assert.match(notas[0][1], /pidió reprogramar\. Se canceló la cita del miércoles 14 de octubre a las 9:00 a\. m\./);
  // El lead 22 no tenía citas: solo nota y pasa a LLAMAR.
  assert.match(notas[1][1], /no tenía citas pendientes/);
  assert.deepEqual(movidos, [['11', 105739403], ['22', 105739403]]);
});

test('reprogramar: si no existe la etapa en Kommo, no hace nada', async () => {
  const { reprogramaciones, movidos } = preparar({ etapa: null, enEtapa: ['11'] });
  const log = console.log;
  console.log = () => {};
  try {
    assert.deepEqual(await reprogramaciones.revisar(), []);
  } finally {
    console.log = log;
  }
  assert.deepEqual(movidos, []);
});
