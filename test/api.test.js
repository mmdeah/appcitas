const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearApi } = require('../src/api');

const TOKEN = 'prueba-de-solo-lectura-1234567890';
const reloj = () => new Date('2026-10-15T13:00:00Z');
const pedir = (api, consulta, auth = `Bearer ${TOKEN}`) =>
  api.citas({ headers: auth ? { authorization: auth } : {} }, new URLSearchParams(consulta));

function preparar() {
  const db = abrir(':memory:');
  const agenda = crearAgenda(db, undefined, () => new Date('2026-10-12T13:00:00Z'));
  const a = agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-15', hora: '09:00', cliente: 'Juan Pérez', telefono: '3001234567', vehiculo: 'Mazda 3 2018', placa: 'ABC123' }, { origen: 'BOT' });
  const b = agenda.reservar({ servicio: 'SINCRONIZACION', fecha: '2026-10-15', hora: '10:30', cliente: 'Ana Ruiz', telefono: '3109876543', notas: 'Llega en la tarde' });
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-16', hora: '08:30', cliente: 'Luis', telefono: '3001112233', vehiculo: 'Kia Rio' });
  agenda.cancelar(b.id);
  return { api: crearApi(db, { token: TOKEN, reloj }), a, b };
}

test('API: sin token o con token malo no entrega nada; sin variable queda apagada', () => {
  const { api } = preparar();
  assert.equal(pedir(api, 'fecha=2026-10-15', null).estado, 401);
  assert.equal(pedir(api, 'fecha=2026-10-15', 'Bearer otro').estado, 401);
  assert.equal(crearApi(abrir(':memory:'), { token: '' }).citas({ headers: {} }, new URLSearchParams()).estado, 503);
});

test('API: citas de un día, de un rango y por estado', () => {
  const { api, a } = preparar();
  const dia = pedir(api, 'fecha=2026-10-15');
  assert.equal(dia.estado, 200);
  assert.equal(dia.datos.zona_horaria, 'America/Bogota');
  assert.equal(dia.datos.total, 2); // la cancelada también viene, con su estado
  assert.deepEqual(dia.datos.citas[0], {
    id: a.id,
    fecha: '2026-10-15',
    hora: '09:00',
    inicio: '2026-10-15T09:00:00-05:00',
    duracion_minutos: 45,
    servicio: 'REVISION',
    servicio_nombre: 'Revisión General Preventiva',
    estado: 'AGENDADA',
    cliente: 'Juan Pérez',
    telefono: '573001234567',
    placa: 'ABC123',
    vehiculo: 'Mazda 3 2018',
    notas: null,
    origen: 'BOT',
    kommo_lead: null,
    creada: dia.datos.citas[0].creada,
  });
  assert.match(dia.datos.citas[0].creada, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(dia.datos.citas[1].estado, 'CANCELADA');
  // Sin fecha: hoy (15 de octubre en Colombia).
  assert.equal(pedir(api, '').datos.total, 2);
  assert.equal(pedir(api, 'desde=2026-10-15&hasta=2026-10-16').datos.total, 3);
  assert.equal(pedir(api, 'desde=2026-10-15&hasta=2026-10-16&estado=AGENDADA,CONFIRMADA').datos.total, 2);
  assert.equal(pedir(api, 'fecha=15/10/2026').estado, 400);
  assert.equal(pedir(api, 'desde=2026-01-01&hasta=2026-12-31').estado, 400);
});
