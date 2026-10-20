// Sección "Bot" de la app: configuración, simulador para jugar con el bot y conversaciones reales con lo que
// decidió el agente. Sin JavaScript en el navegador: solo HTML, formularios y animaciones CSS.

const config = require('../config');
const { pagina, esc } = require('./vistas');
const { fechaLarga, horaCorta } = require('./fechas');

// ---------- Mascota: "Tuerquita", el robotcito mecánico del taller ----------
// Estados: feliz, pensando, confundido, callado, celebra, dormido.
function mascota(estado = 'feliz', { tam = 140, globo = '' } = {}) {
  const ojos = {
    feliz: '<ellipse class="ojo" cx="47" cy="58" rx="5.5" ry="6.5"/><ellipse class="ojo" cx="73" cy="58" rx="5.5" ry="6.5"/>',
    pensando: '<g class="mira-arriba"><ellipse class="ojo" cx="49" cy="55" rx="5" ry="6"/><ellipse class="ojo" cx="75" cy="55" rx="5" ry="6"/></g>',
    confundido: '<ellipse class="ojo" cx="47" cy="58" rx="5.5" ry="6.5"/><path class="trazo" d="M67 54 q6 -4 12 0"/><circle class="ojo" cx="73" cy="60" r="4"/>',
    callado: '<path class="trazo" d="M41 59 q6 4 12 0"/><path class="trazo" d="M67 59 q6 4 12 0"/>',
    celebra: '<path class="estrella" d="M47 51 l2 5 5 .5 -4 3.5 1.3 5 -4.3 -2.7 -4.3 2.7 1.3 -5 -4 -3.5 5 -.5z"/><path class="estrella" d="M73 51 l2 5 5 .5 -4 3.5 1.3 5 -4.3 -2.7 -4.3 2.7 1.3 -5 -4 -3.5 5 -.5z"/>',
    dormido: '<path class="trazo" d="M41 60 h12"/><path class="trazo" d="M67 60 h12"/>',
  }[estado];
  const boca = {
    feliz: '<path class="trazo" d="M51 71 q9 8 18 0"/>',
    pensando: '<circle class="boca-o" cx="60" cy="73" r="3"/>',
    confundido: '<path class="trazo" d="M50 74 q5 -4 10 0 t10 0"/>',
    callado: '<path class="trazo" d="M49 73 h22"/><path class="trazo fino" d="M53 70 v6 M58 70 v6 M63 70 v6 M68 70 v6"/>',
    celebra: '<path class="boca-abierta" d="M49 69 q11 14 22 0z"/>',
    dormido: '<path class="trazo" d="M54 73 q6 3 12 0"/>',
  }[estado];
  const extra = {
    pensando: '<g class="puntos-pensar"><circle cx="98" cy="22" r="3"/><circle cx="106" cy="14" r="4"/><circle cx="115" cy="5" r="5"/></g>',
    celebra: '<g class="confeti"><path d="M12 30 l4 -6"/><path d="M104 28 l6 -4"/><path d="M18 14 l2 6"/><path d="M98 10 l-3 6"/></g>',
    dormido: '<text class="zzz" x="92" y="24">z</text><text class="zzz zzz2" x="102" y="14">z</text>',
    confundido: '<text class="interroga" x="96" y="26">?</text>',
  }[estado] || '';
  return `<figure class="mascota mascota-${estado} ${tam >= 145 ? 'grande' : 'mediana'}">
  <svg viewBox="0 0 120 120" role="img" aria-label="Tuerquita, el bot del taller (${estado})">
    <g class="cuerpo">
      <path class="antena" d="M60 28 V14"/>
      <circle class="antena-bola" cx="60" cy="11" r="5"/>
      <rect class="oreja" x="11" y="50" width="11" height="22" rx="5"/>
      <rect class="oreja" x="98" y="50" width="11" height="22" rx="5"/>
      <rect class="cabeza" x="20" y="28" width="80" height="66" rx="24"/>
      <rect class="pantalla" x="29" y="39" width="62" height="45" rx="16"/>
      ${ojos}
      <circle class="cachete" cx="38" cy="70" r="4"/>
      <circle class="cachete" cx="82" cy="70" r="4"/>
      ${boca}
      <path class="llave" d="M86 96 l10 10 m-2 -12 a5 5 0 1 0 7 7"/>
    </g>
    ${extra}
  </svg>
  ${globo ? `<figcaption class="globo">${globo}</figcaption>` : ''}
</figure>`;
}

const pestanas = (activa) => `<nav class="pestanas" aria-label="Secciones del bot">
  ${[['/bot', 'Configuración', 'config'], ['/bot/simulador', 'Simulador', 'simulador'], ['/bot/conversaciones', 'Conversaciones', 'conversaciones']]
    .map(([href, nombre, clave]) => `<a href="${href}"${activa === clave ? ' aria-current="page" class="activa"' : ''}>${nombre}</a>`)
    .join('')}
</nav>`;

const NOMBRE_ACCION = {
  preguntar: 'Pidió datos',
  ofrecer: 'Ofreció un turno',
  agendar: 'Agendó',
  responder: 'Respondió una pregunta',
  cortar: 'Se calló (pasó a asesor)',
};

// Hora de Colombia de un "datetime('now')" de SQLite (UTC).
const enCali = (creado) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: config.zonaHoraria, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(`${String(creado).replace(' ', 'T')}Z`));

const turnoTexto = (t) => (t && t.fecha ? `${fechaLarga(t.fecha)} a las ${horaCorta(t.hora)}` : '');

// Tarjeta "lo que pensó" el bot en un mensaje.
function tarjetaPensamiento({ aprobada, accion, turno, motivo, razon, datos }) {
  const turnoLeible = typeof turno === 'string' ? turno : turnoTexto(turno);
  const entendio = datos && Object.entries(datos).filter(([, v]) => v);
  return `<div class="pensamiento ${aprobada ? 'ok' : 'frenado'}">
  <p class="pensamiento-titulo">${aprobada ? '🧠 Lo que pensó' : '⛔ La app frenó a la IA'}</p>
  ${accion ? `<p><b>Decisión:</b> ${esc(NOMBRE_ACCION[accion] || accion)}</p>` : ''}
  ${turnoLeible ? `<p><b>Turno:</b> ${esc(turnoLeible)}</p>` : ''}
  ${entendio && entendio.length ? `<p><b>Entendió:</b> ${entendio.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}</p>` : ''}
  ${motivo ? `<p><b>Por qué:</b> ${esc(motivo)}</p>` : ''}
  ${aprobada ? '<p class="verifica">✅ La app revisó la decisión y la dejó pasar.</p>' : `<p class="verifica">Razón: ${esc(razon || 'no cumplió las reglas')}. El bot se calló: el chat queda para ti.</p>`}
</div>`;
}

// ---------- Configuración ----------
function botConfig({ ajustes, estado, instrucciones, aviso, errores = [], estadisticas }) {
  const a = ajustes;
  const opcion = (valor, actual, texto) => `<option value="${valor}"${String(valor) === String(actual) ? ' selected' : ''}>${texto}</option>`;
  const numero = (id, etiqueta, valor, min, max, ayuda) =>
    `<div class="campo"><label for="${id}">${etiqueta}</label><input id="${id}" name="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${esc(valor)}" required>${ayuda ? `<small class="suave">${ayuda}</small>` : ''}</div>`;
  const encendido = a.agenteModo !== 'no';
  const humor = !estado.iaActiva ? 'dormido' : encendido ? 'feliz' : 'dormido';
  const globo = !estado.iaActiva ? 'Me falta la clave de OpenRouter para pensar…' : encendido ? '¡Hola! Estoy atendiendo a los clientes 🙌' : 'Estoy descansando: responden las reglas.';
  return pagina(
    'Bot',
    `<header class="cabeza"><div><p class="eyebrow">Tu asistente de WhatsApp</p><h1>Bot del taller</h1></div></header>
${pestanas('config')}
${aviso ? `<p class="alerta bien">${esc(aviso)}</p>` : ''}
${errores.length ? `<div class="alerta mal">${errores.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : ''}
<section class="bot-hero tarjeta">
  ${mascota(humor, { tam: 150, globo })}
  <dl class="bot-estado">
    <div><dt>Agente de IA</dt><dd>${encendido ? '<span class="chip bien">Encendido</span>' : '<span class="chip mal">Apagado</span>'}</dd></div>
    <div><dt>Modelo</dt><dd>${esc(estado.modelo || 'sin configurar')}</dd></div>
    <div><dt>Recordatorios</dt><dd>${estado.recordatorios ? '<span class="chip bien">Encendidos</span>' : '<span class="chip">Apagados</span>'}</dd></div>
    <div><dt>Decisiones hoy</dt><dd>${estadisticas.hoy} <small class="suave">(${estadisticas.frenadasHoy} frenadas)</small></dd></div>
  </dl>
</section>

<form method="post" action="/bot/ajustes" class="tarjeta ajustes">
  <h2>Configuración</h2>
  <p class="sub">Los cambios se aplican al instante, sin volver a publicar. Si cambias el horario, cambia también el texto del mensaje de Kommo que dice el horario.</p>

  <fieldset class="grupo">
    <legend>Agente de IA</legend>
    <label class="radio"><input type="radio" name="agenteModo" value="si"${encendido ? ' checked' : ''}> Encendido: la IA decide (dentro de sus reglas)</label>
    <label class="radio"><input type="radio" name="agenteModo" value="no"${!encendido ? ' checked' : ''}> Apagado: responde solo el bot de reglas</label>
  </fieldset>

  <fieldset class="grupo">
    <legend>Días y horario de las citas</legend>
    <p class="suave">Primera y última hora en que puede EMPEZAR una cita.</p>
    <div class="dias-horario">
      ${a.horario
        .map(
          (d) => `<div class="dia-fila">
        <label class="check"><input type="checkbox" name="dia${d.dia}"${d.activo ? ' checked' : ''}> ${d.nombre.charAt(0).toUpperCase() + d.nombre.slice(1)}</label>
        <label class="oculto" for="desde${d.dia}">Desde</label><input id="desde${d.dia}" name="desde${d.dia}" type="time" step="900" value="${d.desde}">
        <span class="suave">a</span>
        <label class="oculto" for="hasta${d.dia}">Hasta</label><input id="hasta${d.dia}" name="hasta${d.dia}" type="time" step="900" value="${d.hasta}">
      </div>`
        )
        .join('')}
    </div>
  </fieldset>

  <fieldset class="grupo">
    <legend>Turnos y cupos</legend>
    <div class="dos">
      <div class="campo"><label for="intervaloMinutos">Turnos cada</label>
        <select id="intervaloMinutos" name="intervaloMinutos">${[15, 20, 30, 60].map((m) => opcion(m, a.intervaloMinutos, `${m} minutos`)).join('')}</select></div>
      ${numero('capacidadPorHora', 'Carros por hora', a.capacidadPorHora, 1, 10, 'Cuántos vehículos caben en la misma hora.')}
      ${numero('citasPorDia', 'Citas por día', a.citasPorDia, 1, 60, 'Máximo de citas en un día.')}
      ${numero('diasAdelante', 'Días hacia adelante', a.diasAdelante, 1, 60, 'Hasta cuántos días en el futuro se puede agendar.')}
      ${numero('anticipacionMinutos', 'Anticipación (minutos)', a.anticipacionMinutos, 0, 1440, 'No ofrecer turnos que empiezan antes de este tiempo.')}
    </div>
  </fieldset>

  <fieldset class="grupo">
    <legend>Revisión General Preventiva</legend>
    <div class="dos">
      <div class="campo"><label for="precioRevision">Precio</label><input id="precioRevision" name="precioRevision" value="${esc(a.precioRevision)}" required></div>
      ${numero('duracionRevision', 'Duración (minutos)', a.duracionRevision, 5, 600, '')}
    </div>
  </fieldset>

  <div class="acciones"><span></span><button class="boton" type="submit">Guardar cambios</button></div>
</form>

<section class="tarjeta reglas-bot">
  <h2>Sus paredes</h2>
  <p class="sub">Lo que la app revisa en <b>cada</b> decisión de la IA antes de enviarla. Si algo no cumple, no se envía y el bot se calla: el chat queda para ti.</p>
  <ul class="lista-paredes">
    <li>Solo atiende: agendar la cita, dirección, horario, precio y duración. Lo demás: se calla y lo atiendes tú.</li>
    <li>Solo ofrece o agenda turnos que estén libres de verdad.</li>
    <li>Un solo turno a la vez: nunca rangos ni listas de horas.</li>
    <li>No menciona días u horas distintos del turno que ofrece o de lo que pidió el cliente.</li>
    <li>Para agendar necesita nombre, vehículo y una placa válida.</li>
    <li>Tono serio y respetuoso: sin "Uy", "qué pena", confianzas ("hermano", "parce"), presión ni "!!".</li>
  </ul>
  <details class="instrucciones"><summary>Ver las instrucciones completas que recibe la IA</summary><pre>${esc(instrucciones)}</pre></details>
</section>`,
    { activo: 'bot' }
  );
}

// ---------- Simulador ----------
function botSimulador({ sesion, ejemplos, iaActiva }) {
  const chat = sesion ? sesion.chat : [];
  const ultimo = chat[chat.length - 1];
  const humor = !ultimo ? (iaActiva ? 'feliz' : 'dormido')
    : ultimo.estado === 'listo' ? 'celebra'
    : ultimo.estado === 'asesor' ? 'callado'
    : ultimo.pensamiento && !ultimo.pensamiento.aprobada ? 'confundido'
    : iaActiva ? 'pensando' : 'feliz';
  const globo = !ultimo ? (iaActiva ? 'Escríbeme como si fueras un cliente 👇' : 'Sin la clave de OpenRouter solo responden las reglas.')
    : ultimo.estado === 'listo' ? '¡Cita agendada! (de práctica)'
    : ultimo.estado === 'asesor' ? 'Aquí me callo: esto lo atiende una persona.'
    : ultimo.pensamiento && !ultimo.pensamiento.aprobada ? 'La app me frenó, así que me quedé callado.'
    : 'Esperando tu respuesta…';
  const burbujas = chat
    .map((t, i) => {
      const p = t.pensamiento;
      const dec = p && p.decision;
      return `<div class="turno"${i === chat.length - 1 ? ' id="ultimo"' : ''}>
    <div class="burbuja cliente">${esc(t.cliente).replace(/\n/g, '<br>')}</div>
    ${t.bot.map((b) => `<div class="burbuja bot">${esc(b).replace(/\n/g, '<br>')}</div>`).join('')}
    ${t.estado === 'asesor' ? `<div class="burbuja silencio">🤐 El bot no responde nada. Pasa a LLAMAR <small>(${esc(t.motivo || '')})</small></div>` : ''}
    ${t.cita ? `<div class="burbuja agendada">✅ Habría agendado: ${esc(fechaLarga(t.cita.fecha))} a las ${esc(horaCorta(t.cita.hora))} · ${esc(t.cita.cliente)} · ${esc(t.cita.placa || '')}</div>` : ''}
    ${p ? tarjetaPensamiento({ aprobada: p.aprobada, accion: dec ? dec.accion : p.crudo && p.crudo.accion, turno: dec ? dec.turno : p.crudo && p.crudo.turno, motivo: dec ? dec.motivo : p.crudo && p.crudo.motivo, razon: p.razon, datos: dec && dec.datos }) : `<div class="pensamiento reglas"><p class="pensamiento-titulo">⚙️ Respondió el bot de reglas</p></div>`}
  </div>`;
    })
    .join('');
  return pagina(
    'Simulador del bot',
    `<header class="cabeza"><div><p class="eyebrow">Practica sin miedo</p><h1>Simulador</h1></div></header>
${pestanas('simulador')}
<div class="simulador">
  <aside class="tarjeta sim-lado">
    ${mascota(humor, { tam: 130, globo })}
    <p class="suave sim-nota">Usa los turnos libres <b>reales</b>, pero <b>no agenda nada</b> ni le escribe a nadie. Cada mensaje cuesta lo mismo que uno real (unos $20–45 pesos).</p>
    <form method="post" action="/bot/simulador/reiniciar"><button class="boton secundario" type="submit">Empezar de nuevo</button></form>
  </aside>
  <section class="tarjeta sim-chat">
    <div class="chat">${burbujas || '<p class="vacio">Todavía no hay mensajes. Escribe uno o toca un ejemplo.</p>'}</div>
    <form method="post" action="/bot/simulador#ultimo" class="sim-enviar">
      <label class="oculto" for="mensaje">Mensaje del cliente</label>
      <textarea id="mensaje" name="mensaje" rows="2" maxlength="600" placeholder="Escribe como si fueras el cliente…" required${sesion && sesion.terminada ? ' disabled' : ''}></textarea>
      <button class="boton" type="submit"${sesion && sesion.terminada ? ' disabled' : ''}>Enviar</button>
    </form>
    ${sesion && sesion.terminada ? '<p class="suave">La conversación terminó con la cita agendada. Toca "Empezar de nuevo" para otra.</p>' : ''}
    <div class="ejemplos">
      <p class="suave">Ejemplos:</p>
      ${ejemplos.map((e) => `<form method="post" action="/bot/simulador#ultimo"><input type="hidden" name="mensaje" value="${esc(e)}"><button class="chip-boton" type="submit">${esc(e)}</button></form>`).join('')}
    </div>
  </section>
</div>`,
    { activo: 'bot' }
  );
}

// ---------- Conversaciones reales ----------
function botConversaciones({ lista }) {
  return pagina(
    'Conversaciones del bot',
    `<header class="cabeza"><div><p class="eyebrow">Clientes reales</p><h1>Conversaciones</h1></div></header>
${pestanas('conversaciones')}
<section class="tarjeta">
  ${
    lista.length
      ? `<ul class="lista-conversaciones">${lista
          .map(
            (c) => `<li><a href="/bot/conversaciones/${encodeURIComponent(c.lead)}">
      <span class="conv-cabeza"><b>Lead #${esc(c.lead)}</b><span class="suave">${esc(enCali(c.ultimo))}</span></span>
      <span class="conv-texto">${esc(String(c.texto).slice(0, 110))}</span>
      <span class="conv-pie suave">${c.mensajes} mensajes${c.frenadas ? ` · <span class="chip mal">${c.frenadas} frenadas</span>` : ''}${c.cortes ? ` · <span class="chip">${c.cortes} cortes</span>` : ''}</span>
    </a></li>`
          )
          .join('')}</ul>`
      : '<p class="vacio">Todavía no hay conversaciones guardadas.</p>'
  }
</section>`,
    { activo: 'bot' }
  );
}

function botConversacion({ lead, eventos }) {
  const filas = eventos
    .map((e) => {
      if (e.tipo === 'mensaje') {
        if (e.rol === 'cliente') return `<div class="burbuja cliente">${esc(e.texto).replace(/\n/g, '<br>')}<small>${esc(enCali(e.creado))}</small></div>`;
        if (/^\(el bot no respondió/.test(e.texto)) return `<div class="burbuja silencio">🤐 El bot no respondió: lo atiende un asesor <small>${esc(enCali(e.creado))}</small></div>`;
        return `<div class="burbuja bot">${esc(e.texto).replace(/\n/g, '<br>')}<small>${esc(enCali(e.creado))}</small></div>`;
      }
      let turno = null;
      try {
        turno = e.turno ? JSON.parse(e.turno) : null;
      } catch {
        turno = e.turno;
      }
      return tarjetaPensamiento({ aprobada: Boolean(e.aprobada), accion: e.accion, turno, motivo: e.motivo, razon: e.razon });
    })
    .join('');
  return pagina(
    `Lead ${lead}`,
    `<header class="cabeza"><div><p class="eyebrow">Conversación real</p><h1>Lead #${esc(lead)}</h1></div>
  <nav class="semanas"><a href="/bot/conversaciones">← Conversaciones</a><a href="https://${config.kommo.subdominio}.kommo.com/leads/detail/${encodeURIComponent(lead)}" target="_blank" rel="noopener">Ver en Kommo</a></nav></header>
${pestanas('conversaciones')}
<section class="tarjeta"><div class="chat">${filas || '<p class="vacio">Sin mensajes.</p>'}</div></section>`,
    { activo: 'bot' }
  );
}

module.exports = { mascota, botConfig, botSimulador, botConversaciones, botConversacion };
