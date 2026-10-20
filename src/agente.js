// Agente de IA para agendar: la IA decide qué hacer y qué decir, pero dentro de dos paredes:
//   1) sus FUNCIONES (agendar esta cita y responder dirección, horario, precio y duración), y
//   2) sus LÍMITES (un solo turno, solo turnos libres reales, nunca el rango de horas, tono del taller…).
// La app verifica cada decisión antes de ejecutarla; si algo no cumple, no se hace y responden las reglas de siempre.

const config = require('../config');
const { ahora, sumarDias, diaSemana, fechaLarga, horaCorta, aMinutos } = require('./fechas');

const ACCIONES = ['preguntar', 'ofrecer', 'agendar', 'responder', 'cortar'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const HORARIO_ATENCION = 'Atendemos de lunes a sábado, de 8 a. m. a 5 p. m.';

// Frases y caritas que no van con el tono del taller.
const TONO_PROHIBIDO = /qu[eé] pena|lamentablemente|desafortunadamente|disculp|lo siento|lo lamento|\buy\b|😕|😔|😢|😞|🙁|☹/i;
// Rangos o listas de horas: el taller nunca debe verse vacío.
const RANGO = /\b(de|desde)\s+(las\s+)?\d{1,2}(:\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?\s*(a|hasta)\s+(las\s+)?\d{1,2}|\bhasta las\b|\bturnos? (libres|disponibles):/i;

// Placa colombiana: ABC123 (carro) o ABC12D (moto). Corrige O→0 e I/L→1 en la parte de números.
function placaValida(texto) {
  const p = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length !== 6) return null;
  const letras = p.slice(0, 3);
  const numeros = p.slice(3, 5).replace(/O/g, '0').replace(/[IL]/g, '1');
  const ultimo = p[5] === 'O' ? '0' : p[5];
  const placa = `${letras}${numeros}${ultimo}`;
  return /^[A-Z]{3}\d{2}[A-Z0-9]$/.test(placa) ? placa : null;
}

function instrucciones({ hoy, hora, servicio }) {
  const s = config.servicios[servicio] || config.servicios.REVISION;
  const precio = String(s.precio).replace(/^Precio:\s*/i, '');
  const duracion = s.duracionMinutos >= 60 ? `${s.duracionMinutos / 60} horas` : `${s.duracionMinutos} minutos`;
  return `Eres David, asesor de ${config.negocio}, un taller mecánico en Cali (Colombia). Atiendes por WhatsApp a clientes que vienen de un anuncio y quieren agendar la ${s.nombre}.
Hoy es ${fechaLarga(hoy)} (${hoy}) y son las ${hora}.

TUS FUNCIONES (lo único que haces):
1. Agendar esta cita. Para agendar necesitas: nombre, vehículo (marca, modelo y año), placa, y un turno (día y hora) de la lista TURNOS LIBRES que el cliente haya aceptado.
2. Responder solo estas preguntas, con estos datos exactos:
   - Dirección: "📍 Estamos en la ${config.direccion}."
   - Horario de atención: "🕘 ${HORARIO_ATENCION}"
   - Precio: "💰 La ${s.corto.toLowerCase()} cuesta ${precio}."
   - Duración: "⏱️ La ${s.corto.toLowerCase()} dura aprox. ${duracion}."
   Después de responder, sigue con la cita (pide lo que falte u ofrece un turno).

TUS LÍMITES (paredes que nunca cruzas):
1. Si el mensaje no es para agendar esta cita ni una de esas 4 preguntas, la acción es "cortar" (no respondes nada; lo atiende una persona). También "cortar" si: se despide o dice que confirmará después, pide hablar con una persona, pregunta por otros servicios, repuestos o cotizaciones, quiere agendar varios vehículos, está molesto o se queja, o la conversación no avanza. Lee TODA la conversación antes de decidir.
2. Turnos: solo puedes ofrecer o agendar turnos que estén en TURNOS LIBRES, copiando la fecha y la hora exactas. Ofrece UNO solo a la vez. Nunca digas cuántos turnos hay, nunca des listas ni rangos de horas ("de 8:30 a 3:30", "hasta las…") ni menciones días u horas distintos del turno que ofreces o de lo que el cliente pidió. La lista de turnos es interna: el cliente nunca la ve.
3. Cómo elegir el turno: si pidió día y hora y está libre, ese. Si la hora está ocupada, la más cercana ese mismo día. Si no dijo hora, la más temprana del día. Si no dijo día, el más próximo. Si rechaza el DÍA (pico y placa, trabajo, "ese día no puedo"), ofrece otro día y no vuelvas a ofrecer ese día. Si rechaza solo la HORA, otra hora. No repitas un turno que ya rechazó (está en TURNOS RECHAZADOS).
4. "agendar" solo cuando tengas nombre, vehículo y placa, y el cliente aceptó el turno ofrecido ("sí", "listo", "dale", "me sirve"…) o pidió exactamente un turno que está libre.
5. Datos: no inventes nada. Placa colombiana: 3 letras + 3 números (carros) o 3 letras + 2 números + 1 letra (motos). Si escribió la letra O en vez de cero, corrígela.
6. Tono: amable, serio y respetuoso; tutea. Mensajes cortos (máximo 3 frases). Como mucho 1 emoji. Nunca: "Uy", "qué pena", "lamentablemente", "disculpa", "lo siento", ni caritas tristes. No empieces el mensaje con el nombre del cliente cuando no hay disponibilidad. No prometas nada, no des precios de otros servicios, no inventes promociones.
7. Cuando la acción es "agendar", deja "mensaje" vacío: el sistema le manda la confirmación con todos los datos.

Responde SOLO con un objeto JSON:
{"accion": "preguntar" | "ofrecer" | "agendar" | "responder" | "cortar",
 "datos": {"nombre": string|null, "vehiculo": string|null, "placa": string|null},
 "turno": {"fecha": "YYYY-MM-DD", "hora": "HH:MM"} | null,
 "mensaje": "texto para el cliente (vacío si es cortar o agendar)",
 "motivo": "explicación corta de tu decisión"}
- "preguntar": pides los datos que faltan. - "ofrecer": ofreces UN turno (va en "turno"). - "responder": respondes una de las 4 preguntas y sigues con la cita (si ofreces un turno, va en "turno").
- En "datos" pon todo lo que ya sabes del cliente (de la conversación o de DATOS CONOCIDOS).`;
}

// Turnos libres de los próximos días, compactos para la IA ("2026-10-20 martes: 08:30 09:00 …").
function turnosLibres(agenda, hoy, dias) {
  const libres = new Set();
  const lineas = [];
  for (let i = 0; i <= dias; i++) {
    const fecha = sumarDias(hoy, i);
    const horas = agenda.horasLibres(fecha).map((h) => h.hora);
    if (!horas.length) continue;
    horas.forEach((h) => libres.add(`${fecha} ${h}`));
    lineas.push(`${fecha} ${DIAS[diaSemana(fecha)]}: ${horas.join(' ')}`);
  }
  return { libres, texto: lineas.join('\n') || '(no hay turnos libres)' };
}

// Todos los números de un texto (para comprobar que la IA no mencione días u horas de más).
const numerosDe = (texto) => (String(texto).match(/\d+/g) || []).map((n) => String(Number(n)));

// Revisa la decisión de la IA contra las paredes. Devuelve { ok, decision } o { ok: false, razon }.
function verificar(decision, { libres, datos, texto, servicio, pedido = {} }) {
  if (!decision || typeof decision !== 'object') return { ok: false, razon: 'sin respuesta' };
  const accion = String(decision.accion || '').toLowerCase();
  if (!ACCIONES.includes(accion)) return { ok: false, razon: `acción desconocida: ${decision.accion}` };
  if (accion === 'cortar') return { ok: true, decision: { accion, motivo: String(decision.motivo || '').slice(0, 80) } };

  // Datos del cliente: se aceptan solo si tienen forma válida.
  const d = decision.datos && typeof decision.datos === 'object' ? decision.datos : {};
  const nuevos = {};
  if (typeof d.nombre === 'string' && d.nombre.trim().length >= 2 && d.nombre.length <= 60 && !/\d{4,}|@|https?:/.test(d.nombre)) nuevos.nombre = d.nombre.trim();
  if (typeof d.vehiculo === 'string' && d.vehiculo.trim()) nuevos.vehiculo = d.vehiculo.trim().slice(0, 120);
  if (d.placa) {
    const placa = placaValida(d.placa);
    if (placa) nuevos.placa = placa;
  }

  // Turno: tiene que existir en la agenda y estar libre.
  let turno = null;
  if (decision.turno && decision.turno.fecha && decision.turno.hora) {
    turno = { fecha: String(decision.turno.fecha), hora: String(decision.turno.hora).padStart(5, '0') };
    if (!libres.has(`${turno.fecha} ${turno.hora}`)) return { ok: false, razon: `turno no libre: ${turno.fecha} ${turno.hora}` };
  }
  if ((accion === 'ofrecer' || accion === 'agendar') && !turno) return { ok: false, razon: `${accion} sin turno` };
  const todos = { ...datos, ...nuevos };
  if (accion === 'agendar' && !(todos.nombre && todos.vehiculo && todos.placa)) return { ok: false, razon: 'agendar con datos incompletos' };

  // Mensaje para el cliente: obligatorio (salvo al agendar) y dentro de las reglas de tono y de "un solo turno".
  const mensaje = String(decision.mensaje || '').trim();
  if (accion !== 'agendar') {
    if (!mensaje) return { ok: false, razon: 'mensaje vacío' };
    if (mensaje.length > 420) return { ok: false, razon: 'mensaje muy largo' };
    if (TONO_PROHIBIDO.test(mensaje)) return { ok: false, razon: 'tono prohibido' };
    // Se quitan las frases fijas del taller (dirección, horario, precio, duración) antes de revisar números y rangos.
    const s = config.servicios[servicio] || config.servicios.REVISION;
    let resto = mensaje
      .split(config.direccion).join(' ')
      .split(HORARIO_ATENCION).join(' ')
      .split(String(s.precio).replace(/^Precio:\s*/i, '')).join(' ')
      .replace(new RegExp(`\\b${s.duracionMinutos >= 60 ? s.duracionMinutos / 60 : s.duracionMinutos}\\s*(minutos|horas)`, 'g'), ' ');
    if (RANGO.test(resto)) return { ok: false, razon: 'menciona un rango de horas' };
    // Cada número del mensaje tiene que venir del turno ofrecido, de lo que dijo el cliente o de sus datos.
    const permitidos = new Set([...numerosDe(texto), ...numerosDe(todos.vehiculo || ''), ...numerosDe(todos.placa || '')]);
    // El día y la hora que pidió el cliente (aunque los haya dicho como "el lunes" o "tipo 11").
    for (const f of [pedido.fecha, datos.fecha].filter(Boolean)) [Number(f.slice(8)), Number(f.slice(5, 7))].forEach((n) => permitidos.add(String(n)));
    for (const h of [pedido.hora, datos.hora].filter(Boolean)) {
      const [hh, mm] = h.split(':').map(Number);
      [hh, hh > 12 ? hh - 12 : hh, mm].forEach((n) => permitidos.add(String(n)));
    }
    if (turno) {
      const [h, m] = turno.hora.split(':').map(Number);
      [Number(turno.fecha.slice(8)), h, h > 12 ? h - 12 : h, m, Number(turno.fecha.slice(5, 7))].forEach((n) => permitidos.add(String(n)));
    }
    const extra = numerosDe(resto).filter((n) => !permitidos.has(n));
    if (extra.length) return { ok: false, razon: `menciona números que no son el turno: ${extra.join(', ')}` };
  }
  return { ok: true, decision: { accion, datos: nuevos, turno, mensaje, motivo: String(decision.motivo || '').slice(0, 120) } };
}

function crearAgente({ ia, agenda, reloj = () => new Date(), modo = process.env.AGENTE, telefonos = process.env.AGENTE_TELEFONOS } = {}) {
  const lista = String(telefonos || '').split(/[,\s]+/).map((t) => t.replace(/\D/g, '')).filter(Boolean);
  // "si" = para todos; "prueba" = solo para los celulares de AGENTE_TELEFONOS; cualquier otra cosa = apagado.
  const paraQuien = (telefono) => {
    if (!ia || !ia.activa || !ia.json) return false;
    if (modo === 'si') return true;
    const t = String(telefono || '').replace(/\D/g, '');
    return modo === 'prueba' && lista.some((x) => t.endsWith(x.slice(-10)));
  };

  // Le pide la decisión a la IA y la verifica. Devuelve la decisión válida o null (entonces responden las reglas).
  async function decidir({ s, texto, historial, citas, pedido = {} }) {
    const momento = ahora(reloj());
    const { libres, texto: lista } = turnosLibres(agenda, momento.fecha, config.diasAdelante || 14);
    const conversacion = historial.slice(-30).map((m) => `${m.rol === 'cliente' ? 'Cliente' : 'Taller'}: ${m.texto}`).join('\n');
    const conocidos = { nombre: s.datos.nombre || null, vehiculo: s.datos.vehiculo || null, placa: s.datos.placa || null };
    const ofrecido = s.propuesta ? `${s.propuesta.fecha} ${s.propuesta.hora}` : 'ninguno';
    const usuario = [
      `CONVERSACIÓN (también de días anteriores):\n${conversacion || '(inicio)'}`,
      `DATOS CONOCIDOS: ${JSON.stringify(conocidos)}`,
      `CITAS QUE YA TIENE: ${citas.length ? citas.join('; ') : 'ninguna'}`,
      `TURNO OFRECIDO (esperando respuesta): ${ofrecido}`,
      `TURNOS RECHAZADOS: ${(s.rechazadas || []).join(', ') || 'ninguno'}`,
      `TURNOS LIBRES (fecha día: horas):\n${lista}`,
      `MENSAJE NUEVO DEL CLIENTE: "${texto}"`,
    ].join('\n\n');
    let crudo;
    try {
      crudo = await ia.json({ sistema: instrucciones({ hoy: momento.fecha, hora: momento.hora, servicio: s.servicio }), usuario });
    } catch (err) {
      console.warn('Agente: la IA no respondió, sigo con reglas:', err.message);
      return null;
    }
    const v = verificar(crudo, { libres, datos: s.datos, texto, servicio: s.servicio, pedido });
    if (!v.ok) {
      console.warn('Agente: decisión rechazada, sigo con reglas', { lead: s.lead, razon: v.razon, accion: crudo && crudo.accion });
      return null;
    }
    console.log('Agente: decidió', { lead: s.lead, accion: v.decision.accion, turno: v.decision.turno, motivo: v.decision.motivo });
    return v.decision;
  }

  return { paraQuien, decidir };
}

module.exports = { crearAgente, verificar, placaValida, instrucciones, turnosLibres };
