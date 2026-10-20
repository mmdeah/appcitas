// Ajustes que se cambian desde la app (sección Bot): horario de citas, turnos, cupos, plazo, precio y si el agente
// de IA está encendido. Se guardan en la base y se aplican sobre el mismo objeto config, así todo el sistema
// (agenda, bot, IA, recordatorios) los usa al instante sin volver a publicar.

const config = require('../config');
const { esHora, aMinutos } = require('./fechas');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function crearAjustes(db) {
  const sql = {
    todos: db.prepare('SELECT clave, valor FROM ajustes'),
    guardar: db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'),
  };

  // Aplica un ajuste sobre config (en el mismo objeto, para que los demás módulos lo vean).
  function aplicar(clave, valor) {
    if (clave === 'horario') {
      for (const k of Object.keys(config.horario)) delete config.horario[k];
      Object.assign(config.horario, valor);
    } else if (clave === 'precioRevision') config.servicios.REVISION.precio = valor;
    else if (clave === 'duracionRevision') config.servicios.REVISION.duracionMinutos = valor;
    else config[clave] = valor;
  }

  // Al arrancar: lo guardado en la app manda sobre config.js.
  function cargar() {
    for (const { clave, valor } of sql.todos.all()) {
      try {
        aplicar(clave, JSON.parse(valor));
      } catch (err) {
        console.warn('Ajustes: no pude aplicar', clave, err.message);
      }
    }
  }

  // Valores actuales para mostrar en el formulario.
  function actuales() {
    return {
      horario: DIAS.map((nombre, dia) => ({ dia, nombre, activo: Boolean(config.horario[dia]), desde: config.horario[dia]?.desde || '08:30', hasta: config.horario[dia]?.hasta || '15:30' })),
      intervaloMinutos: config.intervaloMinutos,
      capacidadPorHora: config.capacidadPorHora,
      citasPorDia: config.citasPorDia,
      diasAdelante: config.diasAdelante,
      anticipacionMinutos: config.anticipacionMinutos,
      precioRevision: String(config.servicios.REVISION.precio).replace(/^Precio:\s*/i, ''),
      duracionRevision: config.servicios.REVISION.duracionMinutos,
      agenteModo: config.agenteModo || process.env.AGENTE || 'si',
    };
  }

  // Valida el formulario completo; si todo está bien lo guarda y lo aplica. Devuelve { ok, errores }.
  function guardarFormulario(f) {
    const errores = [];
    const entero = (campo, nombre, min, max) => {
      const n = Number(f[campo]);
      if (!Number.isInteger(n) || n < min || n > max) errores.push(`${nombre}: entre ${min} y ${max}.`);
      return n;
    };
    const horario = {};
    for (let dia = 0; dia < 7; dia++) {
      if (f[`dia${dia}`] !== 'on') continue;
      const desde = String(f[`desde${dia}`] || '');
      const hasta = String(f[`hasta${dia}`] || '');
      if (!esHora(desde) || !esHora(hasta) || aMinutos(desde) > aMinutos(hasta)) {
        errores.push(`Horario del ${DIAS[dia]}: la primera cita debe ser antes o igual que la última.`);
      } else if (aMinutos(desde) < aMinutos('06:00') || aMinutos(hasta) > aMinutos('20:00')) {
        errores.push(`Horario del ${DIAS[dia]}: entre 6:00 a. m. y 8:00 p. m.`);
      } else horario[dia] = { desde, hasta };
    }
    if (!Object.keys(horario).length) errores.push('Tiene que haber al menos un día con citas.');
    const intervalo = Number(f.intervaloMinutos);
    if (![15, 20, 30, 60].includes(intervalo)) errores.push('Turnos cada 15, 20, 30 o 60 minutos.');
    const valores = {
      horario,
      intervaloMinutos: intervalo,
      capacidadPorHora: entero('capacidadPorHora', 'Carros por hora', 1, 10),
      citasPorDia: entero('citasPorDia', 'Citas por día', 1, 60),
      diasAdelante: entero('diasAdelante', 'Días hacia adelante', 1, 60),
      anticipacionMinutos: entero('anticipacionMinutos', 'Anticipación (minutos)', 0, 1440),
      duracionRevision: entero('duracionRevision', 'Duración de la revisión (minutos)', 5, 600),
      precioRevision: String(f.precioRevision || '').trim(),
      agenteModo: ['si', 'no'].includes(f.agenteModo) ? f.agenteModo : 'si',
    };
    if (!/^\$?\s?[\d.]{3,}$/.test(valores.precioRevision)) errores.push('Precio de la revisión: solo el valor, por ejemplo $60.000.');
    else if (!valores.precioRevision.startsWith('$')) valores.precioRevision = `$${valores.precioRevision.replace(/^\s+/, '')}`;
    if (errores.length) return { ok: false, errores };
    db.exec('BEGIN');
    try {
      for (const [clave, valor] of Object.entries(valores)) sql.guardar.run(clave, JSON.stringify(valor));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    for (const [clave, valor] of Object.entries(valores)) aplicar(clave, valor);
    return { ok: true, errores: [] };
  }

  return { cargar, actuales, guardarFormulario };
}

module.exports = { crearAjustes, DIAS };
