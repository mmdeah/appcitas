const { test } = require('node:test');
const assert = require('node:assert/strict');
const { festivosDe, pascua, esFestivo } = require('../src/festivos');
const { ahora, fechaLarga, horaCorta, lunesDe } = require('../src/fechas');

test('Pascua de años conocidos', () => {
  assert.equal(pascua(2025), '2025-04-20');
  assert.equal(pascua(2026), '2026-04-05');
  assert.equal(pascua(2027), '2027-03-28');
});

test('los 18 festivos de Colombia en 2026', () => {
  assert.deepEqual([...festivosDe(2026)].sort(), [
    '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
    '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
    '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
    '2026-11-16', '2026-12-08', '2026-12-25',
  ]);
  assert.equal(esFestivo('2026-10-13'), false);
});

test('hora de Colombia sin importar la zona del servidor', () => {
  assert.deepEqual(ahora(new Date('2026-10-06T04:30:00Z')), { fecha: '2026-10-05', hora: '23:30' });
  assert.deepEqual(ahora(new Date('2026-10-06T13:00:00Z')), { fecha: '2026-10-06', hora: '08:00' });
});

test('textos de fecha y hora', () => {
  assert.equal(fechaLarga('2026-10-07'), 'miércoles 7 de octubre');
  assert.equal(horaCorta('08:30'), '8:30 a. m.');
  assert.equal(horaCorta('15:30'), '3:30 p. m.');
  assert.equal(horaCorta('12:00'), '12:00 p. m.');
  assert.equal(lunesDe('2026-10-11'), '2026-10-05');
  assert.equal(lunesDe('2026-10-05'), '2026-10-05');
});
