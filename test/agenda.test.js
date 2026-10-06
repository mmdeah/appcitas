const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');

// Configuración fija para las pruebas (no depende de config.js).
const horario = { desde: '08:30', hasta: '15:30' };
const cfg = {
  horario: { 1: horario, 2: horario, 3: horario, 4: horario, 5: horario, 6: horario },
  intervaloMinutos: 60,
  capacidadPorHora: 2,
  diasAdelante: 14,
  anticipacionMinutos: 120,
  cerrarFestivos: true,
  servicios: { REVISION: { nombre: 'Revisión' }, SINCRONIZACION: { nombre: 'Sincronización' } },
};

// "Ahora" = martes 6 de octubre de 2026, 8:00 a. m. en Colombia.
const reloj = () => new Date('2026-10-06T13:00:00Z');

let db;
let agenda;
beforeEach(() => {
  db = abrir(':memory:');
  agenda = crearAgenda(db, cfg, reloj);
});

const cliente = (extra = {}) => ({
  servicio: 'REVISION',
  fecha: '2026-10-07',
  hora: '09:30',
  cliente: 'Juan Pérez',
  telefono: '300 123 4567',
  vehiculo: 'Mazda 3 2018',
  placa: 'abc-123',
  ...extra,
});

test('un día normal tiene 8 horas de 8:30 a 3:30 con 16 cupos', () => {
  const d = agenda.dia('2026-10-07');
  assert.deepEqual(d.horas.map((h) => h.hora), ['08:30', '09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30']);
  assert.equal(d.cupos, 16);
  assert.equal(d.cierre, null);
});

test('domingo y festivo no reciben citas', () => {
  assert.equal(agenda.dia('2026-10-11').cierre, 'Sin atención');
  assert.equal(agenda.dia('2026-10-12').cierre, 'Festivo');
  assert.deepEqual(agenda.horasLibres('2026-10-12'), []);
  assert.throws(() => agenda.reservar(cliente({ fecha: '2026-10-12' })), { codigo: 'CERRADO' });
  assert.deepEqual(agenda.semana('2026-10-05').map((d) => d.fecha), [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
  ]);
});

test('máximo 2 vehículos por hora, sin cruces', () => {
  const a = agenda.reservar(cliente());
  const b = agenda.reservar(cliente({ cliente: 'Ana' }));
  assert.deepEqual([a.puesto, b.puesto], [1, 2]);
  assert.throws(() => agenda.reservar(cliente({ cliente: 'Luis' })), { codigo: 'LLENO' });
  assert.ok(!agenda.horasLibres('2026-10-07').some((h) => h.hora === '09:30'));
  assert.equal(agenda.dia('2026-10-07').horas.find((h) => h.hora === '09:30').libres, 0);
});

test('la base de datos rechaza dos citas en el mismo puesto', () => {
  agenda.reservar(cliente());
  assert.throws(() =>
    db.prepare(`INSERT INTO citas (servicio, fecha, hora, puesto, cliente, telefono) VALUES ('REVISION', '2026-10-07', '09:30', 1, 'X', '573000000000')`).run()
  );
});

test('cancelar libera el cupo', () => {
  const a = agenda.reservar(cliente());
  agenda.reservar(cliente({ cliente: 'Ana' }));
  agenda.cancelar(a.id);
  const c = agenda.reservar(cliente({ cliente: 'Luis' }));
  assert.equal(c.puesto, 1);
  // Reactivar la cancelada ya no cabe: su puesto lo tomó Luis.
  assert.throws(() => agenda.cambiarEstado(a.id, 'AGENDADA'), { codigo: 'LLENO' });
});

test('forzar permite un tercer vehículo a mano', () => {
  agenda.reservar(cliente());
  agenda.reservar(cliente({ cliente: 'Ana' }));
  const extra = agenda.reservar(cliente({ cliente: 'Luis' }), { forzar: true });
  assert.equal(extra.puesto, 3);
});

test('el bot pide 2 horas de anticipación; a mano se puede agendar ya', () => {
  // Son las 8:00: 8:30 y 9:30 quedan a menos de 2 horas.
  assert.equal(agenda.horasLibres('2026-10-06')[0].hora, '10:30');
  assert.throws(() => agenda.reservar(cliente({ fecha: '2026-10-06', hora: '09:30' }), { origen: 'BOT' }), {
    codigo: 'FUERA_DE_PLAZO',
  });
  assert.equal(agenda.reservar(cliente({ fecha: '2026-10-06', hora: '08:30' })).hora, '08:30');
});

test('el bot solo agenda hasta 14 días adelante', () => {
  assert.equal(agenda.horasLibres('2026-10-20').length, 8);
  assert.deepEqual(agenda.horasLibres('2026-10-21'), []);
  assert.throws(() => agenda.reservar(cliente({ fecha: '2026-10-21' }), { origen: 'BOT' }), {
    codigo: 'FUERA_DE_PLAZO',
  });
});

test('próximos días con cupo saltan domingo y festivo', () => {
  assert.deepEqual(agenda.diasConCupo(7).map((d) => d.fecha), [
    '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-13', '2026-10-14',
  ]);
});

test('bloquear una hora y un día completo', () => {
  const b = agenda.bloquear({ fecha: '2026-10-07', hora: '10:30', motivo: 'Almuerzo' });
  assert.ok(!agenda.horasLibres('2026-10-07').some((h) => h.hora === '10:30'));
  assert.throws(() => agenda.reservar(cliente({ hora: '10:30' })), { codigo: 'CERRADO' });
  agenda.desbloquear(b.id);
  assert.ok(agenda.horasLibres('2026-10-07').some((h) => h.hora === '10:30'));

  agenda.bloquear({ fecha: '2026-10-08', motivo: 'Inventario' });
  assert.equal(agenda.dia('2026-10-08').cierre, 'Inventario');
  assert.throws(() => agenda.reservar(cliente({ fecha: '2026-10-08' })), { codigo: 'CERRADO' });
});

test('limpia teléfono y placa, y exige nombre', () => {
  const c = agenda.reservar(cliente());
  assert.equal(c.telefono, '573001234567');
  assert.equal(c.placa, 'ABC123');
  assert.throws(() => agenda.reservar(cliente({ cliente: '  ' })), { codigo: 'DATOS' });
  assert.throws(() => agenda.reservar(cliente({ servicio: 'LAVADO' })), { codigo: 'DATOS' });
  assert.throws(() => agenda.reservar(cliente({ hora: '9:30' })), { codigo: 'DATOS' });
});

test('la copia de respaldo incluye citas canceladas y bloqueos', () => {
  const a = agenda.reservar(cliente());
  agenda.cancelar(a.id);
  agenda.bloquear({ fecha: '2026-10-08' });
  const copia = agenda.exportar();
  assert.equal(copia.citas.length, 1);
  assert.equal(copia.citas[0].estado, 'CANCELADA');
  assert.equal(copia.bloqueos.length, 1);
});

test('una cita fuera de horario agendada a mano aparece en el día', () => {
  agenda.reservar(cliente({ hora: '17:00' }), { forzar: true });
  const h = agenda.dia('2026-10-07').horas.find((x) => x.hora === '17:00');
  assert.equal(h.citas.length, 1);
  assert.equal(h.enHorario, false);
});
