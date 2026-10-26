// Páginas HTML de la app. Sin plantillas ni JavaScript en el navegador: solo HTML y formularios.

const config = require('../config');
const { fechaLarga, horaCorta, MESES } = require('./fechas');

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

// Íconos de línea (SVG dentro del HTML, sin archivos aparte).
const ICONO = {
  calendario: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  bajar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  salir: '<path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4M6 12h10"/>',
  atras: '<path d="M15 6l-6 6 6 6"/>',
  adelante: '<path d="M9 6l6 6-6 6"/>',
  bot: '<path d="M12 3v3M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM9.5 13h.01M14.5 13h.01M10 16.5h4"/>',
};
const icono = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONO[n]}</svg>`;

function pagina(titulo, cuerpo, { sesion = true, activo = '' } = {}) {
  const item = (href, nombre, ico, clave) =>
    `<a class="nav-item${activo === clave ? ' activo' : ''}" href="${href}" title="${nombre}">${icono(ico)}<span>${nombre}</span></a>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1a33">
<title>${esc(titulo)} · Agenda del taller</title>
<link rel="stylesheet" href="/app.css">
</head>
<body${sesion ? ' class="con-menu"' : ''}>
${
  sesion
    ? `<aside class="lateral">
  <a class="marca" href="/calendario" title="${esc(config.negocio)}"><span class="logo">SD</span></a>
  <nav class="nav" aria-label="Menú">
    ${item('/calendario', 'Calendario', 'calendario', 'calendario')}
    ${item('/citas/nueva', 'Nueva cita', 'mas', 'nueva')}
    ${item('/bot', 'Bot', 'bot', 'bot')}
    ${item('/exportar', 'Copia', 'bajar', 'copia')}
    <form method="post" action="/salir" class="nav-salir"><button class="nav-item" type="submit" title="Salir">${icono('salir')}<span>Salir</span></button></form>
  </nav>
</aside>`
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

function tarjetaCita(c) {
  return `<a class="cita ${ESTADO[c.estado].tono}${c.estado === 'CANCELADA' ? ' cancelada' : ''}" href="/citas/${c.id}" title="${c.estado === 'CANCELADA' ? 'Cancelada: ábrela para volver a agendarla' : ''}">
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
    ${(d.canceladas || []).filter((c) => c.hora === h.hora).map(tarjetaCita).join('')}
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

// Color de la cita en el calendario: por estado y, si sigue agendada, por servicio.
const tonoCita = (c) =>
  ({ CONFIRMADA: 'verde', LLEGO: 'verde', NO_ASISTIO: 'naranja', CANCELADA: 'rojo' })[c.estado] ||
  (c.servicio === 'SINCRONIZACION' ? 'morado' : 'azul');

const DIAS_CABEZA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const horaMini = (h) => horaCorta(h).replace(/ (a|p)\. m\./, '$1');

// Primer día del mes anterior o siguiente.
function otroMes(fecha, cuantos) {
  let [a, m] = fecha.split('-').map(Number);
  m += cuantos;
  if (m < 1) { m = 12; a--; }
  if (m > 12) { m = 1; a++; }
  return `${a}-${String(m).padStart(2, '0')}-01`;
}

function celdaMes(d, mes, seleccionada) {
  const fuera = d.fecha.slice(0, 7) !== mes;
  const clases = ['celda', fuera && 'fuera', d.esHoy && 'hoy', d.fecha === seleccionada && 'sel', d.cierre && 'cerrado', d.pasado && 'pasado']
    .filter(Boolean)
    .join(' ');
  const citas = [...d.horas.flatMap((h) => h.citas), ...(d.canceladas || [])].sort((a, b) => a.hora.localeCompare(b.hora));
  const cierre = !fuera && d.cierre && d.cierre !== 'Sin atención' ? `<span class="evento gris">${esc(d.cierre)}</span>` : '';
  return `<a class="${clases}" href="/calendario?dia=${d.fecha}#dia" aria-label="${esc(mayuscula(fechaLarga(d.fecha)))}: ${citas.length} ${citas.length === 1 ? 'cita' : 'citas'}">
  <span class="num">${Number(d.fecha.slice(8))}</span>
  ${cierre}
  ${citas.slice(0, 2).map((c) => `<span class="evento ${tonoCita(c)}"><b>${horaMini(c.hora)}</b> ${esc(c.cliente.split(/\s+/)[0])}</span>`).join('')}
  ${citas.length > 2 ? `<span class="mas">+${citas.length - 2} más</span>` : ''}
  ${citas.length ? `<span class="puntos" aria-hidden="true">${citas.slice(0, 4).map((c) => `<i class="${tonoCita(c)}"></i>`).join('')}</span>` : ''}
</a>`;
}

function panelDia(d) {
  const hayCitas = d.totalCitas > 0;
  const accionDia = d.pasado
    ? ''
    : d.bloqueoDelDia
      ? `<form method="post" action="/bloqueos/${d.bloqueoDelDia.id}/borrar"><input type="hidden" name="semana" value="${d.fecha}"><button class="enlace" type="submit">Abrir el día otra vez</button></form>`
      : !d.cierre
        ? `<details class="bloquear-dia"><summary>Bloquear el día</summary>
          <form method="post" action="/bloqueos" class="en-linea">
            <input type="hidden" name="fecha" value="${d.fecha}"><input type="hidden" name="semana" value="${d.fecha}">
            <label class="oculto" for="motivo-${d.fecha}">Motivo</label>
            <input id="motivo-${d.fecha}" name="motivo" placeholder="Motivo (opcional)" maxlength="200">
            <button class="boton chico" type="submit">Bloquear</button>
          </form></details>`
        : '';
  return `<section class="tarjeta panel-dia${d.pasado ? ' pasado' : ''}" id="dia">
  <header class="panel-cabeza">
    <div>
      <p class="eyebrow">${d.esHoy ? 'Agenda de hoy' : 'Agenda del día'}</p>
      <h2>${esc(mayuscula(fechaLarga(d.fecha)))}</h2>
    </div>
    <span class="ocupacion" title="Citas / cupos del día">${d.totalCitas}${d.cupos ? `<small>/${d.cupos}</small>` : ''}</span>
  </header>
  ${d.cierre ? `<p><span class="chip mal">${esc(d.cierre)}</span></p>` : ''}
  ${!hayCitas && !d.cierre ? '<p class="vacio">Sin citas este día.</p>' : ''}
  ${d.horas.length ? `<div class="horas">${d.horas.map((h) => filaHora(d, h, d.fecha)).join('')}</div>` : ''}
  ${
    d.canceladas.filter((c) => !d.horas.some((h) => h.hora === c.hora)).length
      ? `<details class="canceladas" open><summary>Canceladas fuera del horario</summary>
      <ul>${d.canceladas.filter((c) => !d.horas.some((h) => h.hora === c.hora)).map((c) => `<li><a href="/citas/${c.id}">${horaCorta(c.hora)} · ${esc(c.cliente)}${c.placa ? ` · ${esc(placaBonita(c.placa))}` : ''}</a></li>`).join('')}</ul>
      <p class="suave">Ábrela y toca «Volver a agendada» para reactivarla.</p></details>`
      : ''
  }
  ${accionDia}
</section>`;
}

// Anillo con el porcentaje de cupos ocupados en la semana del día elegido.
function anilloSemana(semana) {
  const citas = semana.reduce((n, d) => n + d.totalCitas, 0);
  const cupos = semana.reduce((n, d) => n + d.cupos, 0);
  const pct = cupos ? Math.min(100, Math.round((citas / cupos) * 100)) : 0;
  return `<section class="tarjeta anillo-tarjeta">
  <h2>Ocupación de la semana</h2>
  <div class="anillo-fila">
    <div class="anillo">
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="fondo" cx="18" cy="18" r="15.5" pathLength="100"/><circle class="lleno" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="${pct} 100"/></svg>
      <span>${pct}%</span>
    </div>
    <ul class="leyenda">
      <li><i class="azul"></i>${citas} ${citas === 1 ? 'cita' : 'citas'}</li>
      <li><i class="gris"></i>${Math.max(0, cupos - citas)} cupos libres</li>
    </ul>
  </div>
</section>`;
}

function calendario({ fecha, celdas, seleccionado, semana, aviso }) {
  const mes = fecha.slice(0, 7);
  const [a, m] = mes.split('-').map(Number);
  const totalMes = celdas.filter((d) => d.fecha.slice(0, 7) === mes).reduce((n, d) => n + d.totalCitas, 0);
  return pagina(
    'Calendario',
    `<header class="cal-cabeza">
  <div class="cal-titulo">
    <a class="flecha" href="/calendario?dia=${otroMes(fecha, -1)}" title="Mes anterior">${icono('atras')}</a>
    <h1>${mayuscula(MESES[m - 1])} <span class="suave">${a}</span></h1>
    <a class="flecha" href="/calendario?dia=${otroMes(fecha, 1)}" title="Mes siguiente">${icono('adelante')}</a>
  </div>
  <p class="sub">${totalMes} ${totalMes === 1 ? 'cita' : 'citas'} este mes</p>
  <div class="cal-acciones">
    <a class="boton secundario" href="/calendario">Hoy</a>
    <a class="boton" href="/citas/nueva?fecha=${fecha}">${icono('mas')} Nueva cita</a>
  </div>
</header>
${aviso ? `<p class="alerta bien">${esc(aviso)}</p>` : ''}
<div class="tablero">
  <section class="tarjeta mes" aria-label="Calendario del mes">
    <div class="sem-cabeza">${DIAS_CABEZA.map((n) => `<span>${n}</span>`).join('')}</div>
    <div class="rejilla">
      ${celdas.map((d) => celdaMes(d, mes, fecha)).join('')}
    </div>
  </section>
  <div class="lado">
    ${panelDia(seleccionado)}
    ${anilloSemana(semana)}
  </div>
</div>`,
    { activo: 'calendario' }
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
  <div class="acciones"><a href="/calendario${v.fecha ? `?dia=${esc(v.fecha)}` : ''}">Volver</a><button class="boton" type="submit">Guardar cita</button></div>
</form>`,
    { activo: 'nueva' }
  );
}

// Formulario para mover la cita a otra fecha u hora (solo citas activas).
function formularioReprogramar(c, valores = {}) {
  const fecha = valores.fecha || c.fecha;
  const hora = valores.hora || c.hora;
  const horas = horasPosibles();
  if (!horas.includes(hora)) horas.push(hora);
  return `<div class="tarjeta reprogramar">
    <h2>Cambiar fecha u hora</h2>
    <p class="sub">Se mueve la misma cita. Se revisa que el turno nuevo esté libre, en el horario y sin pico y placa para el vehículo.</p>
    <form method="post" action="/citas/${c.id}/reprogramar" class="formulario">
      <div class="dos">
        <div class="campo"><label for="nueva-fecha">Nueva fecha</label><input id="nueva-fecha" name="fecha" type="date" value="${esc(fecha)}" required></div>
        <div class="campo"><label for="nueva-hora">Nueva hora</label>
          <select id="nueva-hora" name="hora" required>
            ${horas.sort().map((h) => `<option value="${h}"${h === hora ? ' selected' : ''}>${horaCorta(h)}</option>`).join('')}
          </select></div>
      </div>
      <label class="check"><input type="checkbox" name="forzar"${valores.forzar ? ' checked' : ''}> Cambiarla aunque la hora esté llena, bloqueada, fuera de horario o con pico y placa</label>
      <div class="acciones"><span></span><button class="boton" type="submit">Reprogramar cita</button></div>
    </form>
  </div>`;
}

function citaDetalle(c, { aviso, error, reprogramar: valoresReprogramar } = {}) {
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
  <nav class="semanas"><a href="/calendario?dia=${c.fecha}#dia">← Calendario</a></nav></section>
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
    ${fila('Kommo', c.kommo_lead ? `<a href="https://${config.kommo.subdominio}.kommo.com/leads/detail/${esc(c.kommo_lead)}" target="_blank" rel="noopener">Ver lead #${esc(c.kommo_lead)}</a>` : '')}
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
  ${c.estado === 'CANCELADA' ? '' : formularioReprogramar(c, valoresReprogramar)}
</div>`
  );
}

const mensaje = (titulo, texto) =>
  pagina(titulo, `<section class="cabeza"><div><h1>${esc(titulo)}</h1><p class="sub">${esc(texto)}</p><p><a href="/calendario">Ir al calendario</a></p></div></section>`);

module.exports = {
  pagina,
  esc,
  icono,
  login,
  calendario,
  citaNueva,
  citaDetalle,
  noEncontrado: () => mensaje('No encontrado', 'Esa página no existe.'),
  error: () => mensaje('Algo falló', 'Intenta de nuevo. Si sigue pasando, revisa la consola del servidor.'),
};
