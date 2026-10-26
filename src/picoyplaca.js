// Pico y placa: los días que un vehículo no puede circular, según el último número de la placa
// (config.picoYPlaca). Ese día no se le puede agendar cita.

const config = require('../config');
const { diaSemana } = require('./fechas');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Último número de la placa ("CQW979" → 9). Sin placa o sin números: null.
const ultimoDigito = (placa) => {
  const m = String(placa || '').match(/(\d)\D*$/);
  return m ? Number(m[1]) : null;
};

// ¿Ese vehículo tiene pico y placa esa fecha?
function tienePicoYPlaca(placa, fecha, tabla = config.picoYPlaca) {
  const digito = ultimoDigito(placa);
  if (digito == null || !fecha) return false;
  return ((tabla || {})[diaSemana(fecha)] || []).includes(digito);
}

// Día de la semana en que ese vehículo tiene pico y placa ("lunes"), o null.
function diaDePicoYPlaca(placa, tabla = config.picoYPlaca) {
  const digito = ultimoDigito(placa);
  if (digito == null) return null;
  const dia = Object.entries(tabla || {}).find(([, digitos]) => digitos.includes(digito));
  return dia ? DIAS[Number(dia[0])] : null;
}

module.exports = { tienePicoYPlaca, diaDePicoYPlaca, ultimoDigito };
