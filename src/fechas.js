// Fechas y horas siempre en hora de Colombia, guardadas como texto:
// fecha "YYYY-MM-DD" y hora "HH:MM". Así no dependen de la zona horaria del servidor.

const config = require('../config');

const partes = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.zonaHoraria,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Fecha y hora actuales en Colombia.
function ahora(momento = new Date()) {
  const p = Object.fromEntries(partes.formatToParts(momento).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

const aUTC = (fecha) => {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
const deUTC = (fecha) => fecha.toISOString().slice(0, 10);

function sumarDias(fecha, dias) {
  const d = aUTC(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return deUTC(d);
}

const diaSemana = (fecha) => aUTC(fecha).getUTCDay();
const diasEntre = (desde, hasta) => Math.round((aUTC(hasta) - aUTC(desde)) / 86400000);

function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}
const deMinutos = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && deUTC(aUTC(s)) === s;
const esHora = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function lunesDe(fecha) {
  const d = diaSemana(fecha);
  return sumarDias(fecha, d === 0 ? -6 : 1 - d);
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// "miércoles 7 de octubre"
function fechaLarga(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${DIAS[diaSemana(fecha)]} ${d} de ${MESES[m - 1]}`;
}

// "7 de octubre"
function fechaCorta(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

// "3:30 p. m."
function horaCorta(hora) {
  const [h, m] = hora.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

module.exports = {
  ahora,
  aUTC,
  sumarDias,
  diaSemana,
  diasEntre,
  aMinutos,
  deMinutos,
  esFecha,
  esHora,
  lunesDe,
  fechaLarga,
  fechaCorta,
  horaCorta,
  DIAS,
  MESES,
};
