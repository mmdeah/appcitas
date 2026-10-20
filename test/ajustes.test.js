const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const { abrir } = require('../src/db');
const { crearAjustes } = require('../src/ajustes');
const { mascota } = require('../src/vistas-bot');

// Formulario como lo manda la página Bot → Configuración.
const formulario = (extra = {}) => ({
  agenteModo: 'si',
  dia1: 'on', desde1: '08:00', hasta1: '16:00',
  dia2: 'on', desde2: '08:00', hasta2: '16:00',
  dia6: 'on', desde6: '09:00', hasta6: '12:00',
  intervaloMinutos: '60',
  capacidadPorHora: '3',
  citasPorDia: '6',
  diasAdelante: '10',
  anticipacionMinutos: '60',
  precioRevision: '65.000',
  duracionRevision: '50',
  ...extra,
});

test('ajustes: se validan, se guardan, se aplican al instante y se cargan al reiniciar', () => {
  const copia = JSON.parse(JSON.stringify({ horario: config.horario, servicios: config.servicios, intervaloMinutos: config.intervaloMinutos, capacidadPorHora: config.capacidadPorHora, citasPorDia: config.citasPorDia, diasAdelante: config.diasAdelante, anticipacionMinutos: config.anticipacionMinutos, agenteModo: config.agenteModo }));
  const db = abrir(':memory:');
  try {
    const ajustes = crearAjustes(db);
    // Errores: horario al revés, turnos raros, precio inválido.
    const malo = ajustes.guardarFormulario(formulario({ desde1: '17:00', hasta1: '08:00', intervaloMinutos: '7', precioRevision: 'gratis' }));
    assert.equal(malo.ok, false);
    assert.equal(malo.errores.length, 3);
    assert.equal(config.capacidadPorHora, copia.capacidadPorHora); // nada se aplicó

    const bueno = ajustes.guardarFormulario(formulario());
    assert.equal(bueno.ok, true);
    assert.deepEqual(config.horario, { 1: { desde: '08:00', hasta: '16:00' }, 2: { desde: '08:00', hasta: '16:00' }, 6: { desde: '09:00', hasta: '12:00' } });
    assert.equal(config.capacidadPorHora, 3);
    assert.equal(config.servicios.REVISION.precio, '$65.000');
    assert.equal(config.servicios.REVISION.duracionMinutos, 50);
    assert.equal(ajustes.actuales().horario[3].activo, false);

    // Al reiniciar se vuelve a leer lo guardado.
    config.capacidadPorHora = 2;
    crearAjustes(db).cargar();
    assert.equal(config.capacidadPorHora, 3);
  } finally {
    for (const k of Object.keys(config.horario)) delete config.horario[k];
    Object.assign(config.horario, copia.horario);
    Object.assign(config.servicios.REVISION, copia.servicios.REVISION);
    for (const k of ['intervaloMinutos', 'capacidadPorHora', 'citasPorDia', 'diasAdelante', 'anticipacionMinutos']) config[k] = copia[k];
    if (copia.agenteModo === undefined) delete config.agenteModo;
    else config.agenteModo = copia.agenteModo;
  }
});

test('mascota: un dibujo por estado, sin estilos en línea (la política de seguridad los bloquea)', () => {
  for (const estado of ['feliz', 'pensando', 'confundido', 'callado', 'celebra', 'dormido']) {
    const svg = mascota(estado, { globo: 'Hola' });
    assert.match(svg, new RegExp(`mascota-${estado}`));
    assert.doesNotMatch(svg, /style=/);
  }
});
