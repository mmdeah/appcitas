// Páginas HTML de la app. Sin plantillas ni JavaScript en el navegador: solo HTML y formularios.

const config = require('../config');
const { sumarDias, fechaLarga, fechaCorta, horaCorta, MESES } = require('./fechas');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const ESTADO = {
  AGENDADA: { texto: 'Agendada', tono: 'neutro' },
  CONFIRMADA: { texto: 'Confirmada', tono: 'bien' },
  LLEGO: { texto: 'Llegó', tono: 'bien' },
  NO_ASISTIO: { texto: 'No asistió', tono: 'mal' },
  CANCELADA: { texto: 'Cancelada', tono: 'mal' },
};

const chipEstado = (estado) => `<span class="chip ${ESTADO[estado].tono}">${ESTADO[estado].texto}</span>`;
const nombreServicio = (s) => config.servicios[s]?.corto || s;
const placaBonita = (p) => (p && p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p || '');
const telefonoBonito = (t) =>
  t.startsWith('57') && t.length === 12 ? `${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}` : t;

// Todas las horas posibles de inicio (para el formulario de cita nueva).
function horasPosibles() {
  const horas = new Set();
  for (const h of Object.values(config.horario)) {
    const [dh, dm] = h.desde.split(':').map(Number);
    const [hh, hm] = h.hasta.split(':').map(Number);
    for (let m = dh * 60 + dm; m <= hh * 60 + hm; m += config.intervaloMinutos) {
      horas.add(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
  }
  return [...horas].sort();
}

function pagina(titulo, cuerpo, { sesion = true } = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · Agenda del taller</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
${
  sesion
    ? `<header class="barra">
  <a class="marca" href="/calendario"><span class="logo">SD</span><span>Agenda del taller</span></a>
  <nav>
    <a class="boton" href="/citas/nueva">+ Nueva cita</a>
    <form method="post" action="/salir"><button class="enlace" type="submit">Salir</button></form>
  </nav>
</header>`
    : ''
}
<main>
${cuerpo}
</main>
</body>
</html>`;
}

function login(error) {
  return pagina(
    'Entrar',
    `<section class="entrar">
  <span class="logo grande">SD</span>
  <h1>Agenda del taller</h1>
  <p class="sub">${esc(config.negocio)}</p>
  ${error ? `<p class="alerta mal">${esc(error)}</p>` : ''}
  <form method="post" action="/login" class="formulario">
    <label for="clave">Clave</label>
    <input id="clave" name="clave" type="password" autocomplete="current-password" required autofocus>
    <button class="boton" type="submit">Entrar</button>
  </form>
</section>`,
    { sesion: false }
  );
}

function rangoSemana(lunes, ultimo) {
  const [, m1, d1] = lunes.split('-').map(Number);
  const [, m2, d2] = ultimo.split('-').map(Number);
  return m1 === m2 ? `${d1} al ${d2} de ${MESES[m2 - 1]}` : `${fechaCorta(lunes)} al ${fechaCorta(ultimo)}`;
}

function tarjetaCita(c) {
  return `<a class="cita ${ESTADO[c.estado].tono}" href="/citas/${c.id}">
  <span class="cita-linea"><b>${esc(c.cliente)}</b>${c.origen === 'BOT' ? '<span class="chip bot">Bot</span>' : ''}</span>
  <span class="cita-linea suave">${esc(nombreServicio(c.servicio))}${c.vehiculo ? ` · ${esc(c.vehiculo)}` : ''}</span>
  <span class="cita-linea">${c.placa ? `<span class="placa">${esc(placaBonita(c.placa))}</span>` : ''}${c.estado !== 'AGENDADA' ? chipEstado(c.estado) : ''}</span>
</a>`;
}

function filaHora(d, h, semana) {
  const puedeBloquear = h.libres > 0;
  return `<div class="hora${h.pasada ? ' pasada' : ''}">
  <span class="hora-t">${horaCorta(h.hora)}</span>
  <div class="hora-citas">
    ${h.citas.map(tarjetaCita).join('')}
    ${
      h.bloqueo
        ? `<div class="bloqueo">Bloqueada${h.bloqueo.motivo ? `: ${esc(h.bloqueo.motivo)}` : ''}
      <form method="post" action="/bloqueos/${h.bloqueo.id}/borrar"><input type="hidden" name="semana" value="${semana}"><button class="enlace" type="submit">Quitar</button></form></div>`
        : ''
    }
    ${
      h.libres > 0
        ? `<a class="libre" href="/citas/nueva?fecha=${d.fecha}&amp;hora=${h.hora}">+ ${h.libres} ${h.libres === 1 ? 'cupo libre' : 'cupos libres'}</a>`
        : ''
    }
  </div>
  ${
    puedeBloquear
      ? `<form method="post" action="/bloqueos" class="hora-accion"><input type="hidden" name="fecha" value="${d.fecha}"><input type="hidden" name="hora" value="${h.hora}"><input type="hidden" name="semana" value="${semana}"><button class="enlace suave" type="submit" title="No recibir más citas a esta hora">Bloquear</button></form>`
      : ''
  }
</div>`;
}

function tarjetaDia(d, semana) {
  const clases = ['dia', d.esHoy && 'hoy', d.pasado && 'pasado', d.cierre && 'cerrado'].filter(Boolean).join(' ');
  const accionDia = d.pasado
    ? ''
    : d.bloqueoDelDia
      ? `<form method="post" action="/bloqueos/${d.bloqueoDelDia.id}/borrar"><input type="hidden" name="semana" value="${semana}"><button class="enlace" type="submit">Abrir el día otra vez</button></form>`
      : !d.cierre
        ? `<details class="bloquear-dia"><summary>Bloquear el día</summary>
          <form method="post" action="/bloqueos" class="en-linea">
            <input type="hidden" name="fecha" value="${d.fecha}"><input type="hidden" name="semana" value="${semana}">
            <label class="oculto" for="motivo-${d.fecha}">Motivo</label>
            <input id="motivo-${d.fecha}" name="motivo" placeholder="Motivo (opcional)" maxlength="200">
            <button class="boton chico" type="submit">Bloquear</button>
          </form></details>`
        : '';

  return `<section class="${clases}" id="d-${d.fecha}">
  <header class="dia-cabeza">
    <h2>${esc(mayuscula(fechaLarga(d.fecha)))}</h2>
    ${d.esHoy ? '<span class="chip hoy">Hoy</span>' : ''}
    ${d.cierre ? `<span class="chip mal">${esc(d.cierre)}</span>` : ''}
    <span class="ocupacion" title="Citas / cupos del día">${d.totalCitas}${d.cupos ? `<small>/${d.cupos}</small>` : ''}</span>
  </header>
  ${d.horas.length ? `<div class="horas">${d.horas.map((h) => filaHora(d, h, semana)).join('')}</div>` : '<p class="vacio">Sin horario de citas.</p>'}
  ${accionDia}
</section>`;
}

function calendario({ dias, lunes, aviso }) {
  const ultimo = dias.length ? dias[dias.length - 1].fecha : sumarDias(lunes, 6);
  const total = dias.reduce((n, d) => n + d.totalCitas, 0);
  const hoy = dias.find((d) => d.esHoy);
  return pagina(
    'Calendario',
    `<section class="cabeza">
  <div>
    <p class="eyebrow">Semana</p>
    <h1>${rangoSemana(lunes, ultimo)}</h1>
    <p class="sub">${total} ${total === 1 ? 'cita' : 'citas'} esta semana${hoy ? ` · <a href="#d-${hoy.fecha}">${hoy.totalCitas} hoy</a>` : ''}</p>
  </div>
  <nav class="semanas" aria-label="Cambiar de semana">
    <a href="/calendario?semana=${sumarDias(lunes, -7)}">← Anterior</a>
    <a href="/calendario">Esta semana</a>
    <a href="/calendario?semana=${sumarDias(lunes, 7)}">Siguiente →</a>
  </nav>
</section>
${aviso ? `<p class="alerta bien">${esc(aviso)}</p>` : ''}
<div class="dias">
${dias.map((d) => tarjetaDia(d, lunes)).join('\n')}
</div>
<p class="pie"><a href="/exportar">Descargar copia de todas las citas (JSON)</a></p>`
  );
}

function citaNueva({ valores = {}, error } = {}) {
  const v = { servicio: 'REVISION', ...valores };
  const horas = horasPosibles();
  if (v.hora && !horas.includes(v.hora)) horas.push(v.hora);
  const campo = (id, etiqueta, extra = '') =>
    `<div class="campo"><label for="${id}">${etiqueta}</label><input id="${id}" name="${id}" value="${esc(v[id])}" ${extra}></div>`;

  return pagina(
    'Nueva cita',
    `<section class="cabeza"><div><p class="eyebrow">Agendar a mano</p><h1>Nueva cita</h1>
  <p class="sub">Para clientes que llaman o llegan sin pasar por el bot.</p></div></section>
${error ? `<p class="alerta mal">${esc(error)}</p>` : ''}
<form method="post" action="/citas" class="formulario tarjeta">
  <div class="campo"><label for="servicio">Servicio</label>
    <select id="servicio" name="servicio">
      ${Object.entries(config.servicios)
        .map(([k, s]) => `<option value="${k}"${v.servicio === k ? ' selected' : ''}>${esc(s.nombre)}</option>`)
        .join('')}
    </select></div>
  <div class="dos">
    ${campo('fecha', 'Fecha', 'type="date" required')}
    <div class="campo"><label for="hora">Hora</label>
      <select id="hora" name="hora" required>
        ${horas.sort().map((h) => `<option value="${h}"${v.hora === h ? ' selected' : ''}>${horaCorta(h)}</option>`).join('')}
      </select></div>
  </div>
  ${campo('cliente', 'Nombre del cliente', 'required maxlength="120" autocomplete="off"')}
  ${campo('telefono', 'Celular (WhatsApp)', 'type="tel" required inputmode="tel" placeholder="300 123 4567"')}
  <div class="dos">
    ${campo('vehiculo', 'Vehículo', 'maxlength="120" placeholder="Marca, modelo y año"')}
    ${campo('placa', 'Placa', 'maxlength="10" placeholder="ABC123" class="mayus"')}
  </div>
  <div class="campo"><label for="notas">Notas</label><textarea id="notas" name="notas" rows="3" maxlength="1000">${esc(v.notas)}</textarea></div>
  <label class="check"><input type="checkbox" name="forzar"${v.forzar ? ' checked' : ''}> Agendar aunque la hora esté llena, bloqueada o fuera de horario</label>
  <div class="acciones"><a href="/calendario${v.fecha ? `?semana=${esc(v.fecha)}` : ''}">Volver</a><button class="boton" type="submit">Guardar cita</button></div>
</form>`
  );
}

function citaDetalle(c, { aviso, error } = {}) {
  const servicio = config.servicios[c.servicio];
  const fila = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '');
  const botonEstado = (estado, texto) =>
    c.estado === estado
      ? ''
      : `<form method="post" action="/citas/${c.id}/estado"><input type="hidden" name="estado" value="${estado}"><button class="boton secundario" type="submit">${texto}</button></form>`;

  return pagina(
    c.cliente,
    `<section class="cabeza"><div><p class="eyebrow">Cita #${c.id}</p><h1>${esc(c.cliente)}</h1>
  <p class="sub">${esc(mayuscula(fechaLarga(c.fecha)))} · ${horaCorta(c.hora)} · ${chipEstado(c.estado)}</p></div>
  <nav class="semanas"><a href="/calendario?semana=${c.fecha}#d-${c.fecha}">← Calendario</a></nav></section>
${aviso ? `<p class="alerta bien">${esc(aviso)}</p>` : ''}
${error ? `<p class="alerta mal">${esc(error)}</p>` : ''}
<div class="detalle">
  <dl class="tarjeta datos">
    ${fila('Servicio', esc(servicio ? servicio.nombre : c.servicio))}
    ${fila('Duración aprox.', servicio ? `${servicio.duracionMinutos >= 60 ? `${servicio.duracionMinutos / 60} h` : `${servicio.duracionMinutos} min`}` : '')}
    ${fila('Celular', `${esc(telefonoBonito(c.telefono))} · <a href="https://wa.me/${esc(c.telefono)}" target="_blank" rel="noopener">Abrir WhatsApp</a>`)}
    ${fila('Vehículo', esc(c.vehiculo))}
    ${fila('Placa', c.placa ? `<span class="placa">${esc(placaBonita(c.placa))}</span>` : '')}
    ${fila('Notas', esc(c.notas))}
    ${fila('Agendada por', c.origen === 'BOT' ? 'El bot de WhatsApp' : 'A mano')}
  </dl>
  <div class="tarjeta acciones-cita">
    <h2>Cambiar estado</h2>
    <div class="botones">
      ${botonEstado('CONFIRMADA', 'Confirmada')}
      ${botonEstado('LLEGO', 'Llegó')}
      ${botonEstado('NO_ASISTIO', 'No asistió')}
      ${c.estado !== 'AGENDADA' ? botonEstado('AGENDADA', 'Volver a agendada') : ''}
    </div>
    ${
      c.estado === 'CANCELADA'
        ? ''
        : `<details class="peligro"><summary>Cancelar la cita</summary>
      <p>El cupo queda libre para otro cliente.</p>
      <form method="post" action="/citas/${c.id}/estado"><input type="hidden" name="estado" value="CANCELADA"><button class="boton peligro" type="submit">Sí, cancelar</button></form>
    </details>`
    }
  </div>
</div>`
  );
}

const mensaje = (titulo, texto) =>
  pagina(titulo, `<section class="cabeza"><div><h1>${esc(titulo)}</h1><p class="sub">${esc(texto)}</p><p><a href="/calendario">Ir al calendario</a></p></div></section>`);

module.exports = {
  login,
  calendario,
  citaNueva,
  citaDetalle,
  noEncontrado: () => mensaje('No encontrado', 'Esa página no existe.'),
  error: () => mensaje('Algo falló', 'Intenta de nuevo. Si sigue pasando, revisa la consola del servidor.'),
};
