// Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"): algunos se pasan al lunes siguiente.

const { sumarDias, diaSemana } = require('./fechas');

const dos = (n) => String(n).padStart(2, '0');

// Domingo de Pascua (algoritmo gregoriano anónimo).
function pascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${dos(mes)}-${dos(dia)}`;
}

// Si la fecha no cae lunes, se pasa al lunes siguiente.
function alLunes(fecha) {
  const d = diaSemana(fecha);
  return d === 1 ? fecha : sumarDias(fecha, (8 - d) % 7);
}

const porAnio = new Map();

function festivosDe(anio) {
  if (porAnio.has(anio)) return porAnio.get(anio);
  const f = (mes, dia) => `${anio}-${dos(mes)}-${dos(dia)}`;
  const p = pascua(anio);
  const lista = [
    // Fijos
    f(1, 1), f(5, 1), f(7, 20), f(8, 7), f(12, 8), f(12, 25),
    // Se pasan al lunes
    ...[f(1, 6), f(3, 19), f(6, 29), f(8, 15), f(10, 12), f(11, 1), f(11, 11)].map(alLunes),
    // Semana Santa
    sumarDias(p, -3), sumarDias(p, -2),
    // Ascensión, Corpus Christi y Sagrado Corazón (se pasan al lunes)
    alLunes(sumarDias(p, 39)), alLunes(sumarDias(p, 60)), alLunes(sumarDias(p, 68)),
  ];
  const festivos = new Set(lista);
  porAnio.set(anio, festivos);
  return festivos;
}

const esFestivo = (fecha) => festivosDe(Number(fecha.slice(0, 4))).has(fecha);

module.exports = { esFestivo, festivosDe, pascua };
