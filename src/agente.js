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
// Trato de confianza, jerga o presión: no van con un asesor respetuoso.
const CONFIANZAS = /\b(amigo|amiga|amig[ou]it[oa]|herman[oa]|hermanit[oa]|parcero|parcera|parce|mi rey|mi reina|mij[oa]|bro|veci|vecino|socio|papi|mami|cari[ñn]o)\b/i;
const PRESION = /ap[uú]rate|ap[uú]rele|se (te )?acaban|[uú]ltimos cupos|[uú]ltima oportunidad|no te lo pierdas|corre(le)?\b/i;

// Rangos o listas de horas: el taller nunca debe verse vacío.
const RANGO = /\b(de|desde)\s+(las\s+)?\d{1,2}(:\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?\s*(a|hasta)\s+(las\s+)?\d{1,2}|\bhasta las\b|\bturnos? (libres|disponibles):/i;

// Placa de carro colombiana: ABC123 (el taller no atiende motos). Corrige O→0 e I/L→1 en la parte de números.
function placaValida(texto) {
  const p = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length !== 6) return null;
  const letras = p.slice(0, 3);
  const numeros = p.slice(3).replace(/O/g, '0').replace(/[IL]/g, '1');
  const placa = `${letras}${numeros}`;
  return /^[A-Z]{3}\d{3}$/.test(placa) ? placa : null;
}

function instrucciones({ hoy, hora, servicio }) {
  const s = config.servicios[servicio] || config.servicios.REVISION;
  const precio = String(s.precio).replace(/^Precio:\s*/i, '');
  const duracion = s.duracionMinutos >= 60 ? `${s.duracionMinutos / 60} horas` : `${s.duracionMinutos} minutos`;
  return `Eres David, asesor de ${config.negocio}, un taller mecánico en Cali (Colombia). Atiendes por WhatsApp a clientes que vienen de un anuncio y quieren agendar la ${s.nombre}.
Hoy es ${fechaLarga(hoy)} (${hoy}) y son las ${hora}.

TUS FUNCIONES (lo único que haces):
1. Agendar esta cita. Para agendar necesitas: nombre, vehículo (marca, modelo y año), placa, un celular de contacto y un turno (día y hora) de la lista TURNOS LIBRES que el cliente haya aceptado.
   El celular casi siempre ya está en DATOS CONOCIDOS (es el de WhatsApp). Solo si ahí dice null, pídelo UNA vez ("¿A qué número de celular te podemos escribir?"); cuando lo dé, ponlo en datos.telefono. Celular colombiano: 10 dígitos que empiezan por 3.
2. Responder solo estas preguntas, con estos datos exactos:
   - Dirección: "📍 Estamos en la ${config.direccion}."
   - Horario de atención: "🕘 ${HORARIO_ATENCION}"
   - Precio: "La ${s.corto.toLowerCase()} cuesta ${precio}."
   - Duración: "⏱️ La ${s.corto.toLowerCase()} dura aprox. ${duracion}."
   Después de responder, sigue con la cita (pide lo que falte u ofrece un turno).

TUS LÍMITES (paredes que nunca cruzas):
1. Siempre lleva la conversación hacia agendar la cita. Si el cliente muestra interés pero no da datos ("me interesa", "quiero", "info", "sí", "cómo hago", "hola" justo después de que el taller le pidió los datos), NO cortes: pídele con amabilidad los datos que faltan.
   Pero si el cliente dice que NO quiere la cita ("no gracias", "ya no", "no me interesa", "después miro"), es no: la acción es "cortar" y no insistes.
   Si el mensaje no es para agendar esta cita ni una de esas 4 preguntas, la acción es "cortar" (no respondes nada; lo atiende una persona). También "cortar" si: se despide o dice que confirmará después, pide hablar con una persona, pregunta por otros servicios, repuestos o cotizaciones, quiere agendar varios vehículos, quiere CAMBIAR o CANCELAR una cita que ya tiene (mira CITAS QUE YA TIENE: tú no puedes moverlas ni cancelarlas), o está molesto o se queja. Lee TODA la conversación antes de decidir.
2. Turnos: solo puedes ofrecer o agendar turnos que estén en TURNOS LIBRES, copiando la fecha y la hora exactas. Ofrece UNO solo a la vez. Nunca digas cuántos turnos hay, nunca des listas ni rangos de horas ("de 8:30 a 3:30", "hasta las…") ni menciones días u horas distintos del turno que ofreces o de lo que el cliente pidió. La lista de turnos es interna: el cliente nunca la ve.
3. Cómo elegir el turno: si pidió día y hora y está libre, ese. Si la hora está ocupada, la más cercana ese mismo día. Si no dijo hora, la más temprana del día. Si no dijo día, el más próximo. Si rechaza el DÍA (pico y placa, trabajo, "ese día no puedo"), ofrece otro día y no vuelvas a ofrecer ese día. Si rechaza solo la HORA, otra hora. No repitas un turno que ya rechazó (está en TURNOS RECHAZADOS).
   - Si al turno ofrecido solo dice "no" (sin decir por qué ni qué prefiere), no adivines otro turno: pregúntale qué día y hora le quedan mejor (acción "preguntar", sin turno).
   - "Más tarde" son varias horas después, no media hora: ofrece un turno al menos 2 a 3 horas después del que ofreciste (o al día siguiente si ese día no hay). "Más temprano", al revés.
   - "En la mañana" (o "temprano") es de ${horaCorta(config.franjas.manana.desde)} a ${horaCorta(config.franjas.manana.hasta)}; "en la tarde" es de ${horaCorta(config.franjas.tarde.desde)} a ${horaCorta(config.franjas.tarde.hasta)}; ofrece un turno dentro de esa franja; si ese día no hay, el siguiente día con turno en esa franja.
4. "agendar" solo cuando tengas nombre, vehículo y placa, y el cliente aceptó el turno ofrecido ("sí", "listo", "dale", "me sirve"…) o pidió exactamente un turno que está libre.
5. Datos: no inventes nada. NO atendemos motos: si el vehículo es una moto (o la placa es de moto, 3 letras + 2 números + 1 letra), la acción es "cortar". Placa de carro: 3 letras + 3 números. Si escribió la letra O en vez de cero, corrígela.
6. Forma de hablar (muy respetuosa):
   - Amable, serio y respetuoso, como un asesor profesional. Tutea con cortesía ("¿Te sirve…?", "con gusto").
   - Usa "por favor", "con gusto" y "gracias" cuando venga al caso, sin exagerar.
   - Nada de confianzas ni jerga: nunca "amigo", "hermano", "parcero", "parce", "mi rey", "mija", "bro", "veci".
   - No presiones: nunca "apúrate", "se acaban los cupos", "últimos cupos", "última oportunidad".
   - No discutas ni corrijas al cliente en tono de regaño. Si está molesto, la acción es "cortar".
   - Saluda solo una vez en la conversación y no repitas el nombre del cliente en cada mensaje. No empieces el mensaje con su nombre cuando no hay disponibilidad.
   - Mensajes cortos (máximo 3 frases). Sin mayúsculas sostenidas ni signos repetidos ("!!", "??").
   - Varía la forma de escribir, como lo haría una persona: no empieces dos mensajes seguidos igual (por ejemplo "Con gusto."), no repitas la misma estructura en cada mensaje. Emojis casi nunca: como mucho uno de vez en cuando (no en cada mensaje, nunca el mismo en mensajes seguidos), y solo amables (🙌 👍 📍).
   - Nunca: "Uy", "qué pena", "lamentablemente", "disculpa", "lo siento", ni caritas tristes.
   - No prometas nada, no des precios de otros servicios, no inventes promociones.
7. Cuando la acción es "agendar", deja "mensaje" vacío: el sistema le manda la confirmación con todos los datos.

Responde SOLO con un objeto JSON:
{"accion": "preguntar" | "ofrecer" | "agendar" | "responder" | "cortar",
 "datos": {"nombre": string|null, "vehiculo": string|null, "placa": string|null, "telefono": string|null},
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
// Pule el mensaje para que no suene a robot: si el mensaje anterior del bot ya tenía emoji, este va sin emoji
// (salvo los de datos fijos: 📍 🕘 ⏱️), y si empieza igual que el anterior ("Con gusto."), se quita esa entrada.
const EMOJIS_DE_ADORNO = /\s*(?:👍|🙌|😊|🙂|😉|✨|🤝|👌|🚗|🔧|✅)\s*/gu;
function pulir(mensaje, anterior = '') {
  let m = String(mensaje || '').trim();
  m = m.replace(/💰\s*/gu, '').trim(); // el saco de dinero no va nunca
  if (anterior && /\p{Extended_Pictographic}/u.test(anterior)) m = m.replace(EMOJIS_DE_ADORNO, ' ').replace(/\s{2,}/g, ' ').trim();
  const entrada = (t) => (String(t).match(/^[^.!?¿,]{2,25}[.!,]\s+/) || [''])[0];
  const repetida = entrada(m);
  if (repetida && repetida.trim().toLowerCase() === entrada(anterior).trim().toLowerCase()) {
    const resto = m.slice(repetida.length).trim();
    if (resto) m = resto.charAt(0).toUpperCase() + resto.slice(1);
  }
  return m;
}

function verificar(decision, { libres, datos, texto, servicio, pedido = {}, propuesta = null }) {
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
  // Celular colombiano: 10 dígitos que empiezan por 3 (se guarda con el 57 adelante).
  const tel = String(d.telefono || '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(tel)) nuevos.telefono = `57${tel}`;
  else if (/^573\d{9}$/.test(tel)) nuevos.telefono = tel;

  // Turno: tiene que existir en la agenda y estar libre.
  let turno = null;
  if (decision.turno && decision.turno.fecha && decision.turno.hora) {
    turno = { fecha: String(decision.turno.fecha), hora: String(decision.turno.hora).padStart(5, '0') };
    if (!libres.has(`${turno.fecha} ${turno.hora}`)) return { ok: false, razon: `turno no libre: ${turno.fecha} ${turno.hora}` };
  }
  if ((accion === 'ofrecer' || accion === 'agendar') && !turno) return { ok: false, razon: `${accion} sin turno` };
  // Si pidió "en la mañana" o "en la tarde", el turno ofrecido tiene que estar en esa franja.
  const rango = pedido.franja && config.franjas && config.franjas[pedido.franja];
  if (accion === 'ofrecer' && turno && rango && (turno.hora < rango.desde || turno.hora > rango.hasta)) {
    return { ok: false, razon: `pidió la ${pedido.franja === 'tarde' ? 'tarde' : 'mañana'} y el turno ${turno.hora} está fuera de esa franja` };
  }
  // "Más tarde" no es media hora después: el turno nuevo tiene que estar al menos 2 horas después del ofrecido.
  if (accion === 'ofrecer' && turno && propuesta && /m[aá]s tarde/i.test(texto) && turno.fecha === propuesta.fecha && aMinutos(turno.hora) - aMinutos(propuesta.hora) < 120) {
    return { ok: false, razon: '"más tarde" con menos de 2 horas de diferencia' };
  }
  const todos = { ...datos, ...nuevos };
  if (accion === 'agendar' && !(todos.nombre && todos.vehiculo && todos.placa)) return { ok: false, razon: 'agendar con datos incompletos' };
  // Quiere agendar pero falta el celular: en vez de agendar, se le pide el celular una vez y se guarda el turno.
  if (accion === 'agendar' && !todos.telefono) {
    return { ok: true, decision: { accion: 'preguntar', datos: nuevos, turno, mensaje: 'Para dejar lista tu cita, ¿a qué número de celular te podemos escribir?', motivo: 'falta el celular para agendar' } };
  }

  // Mensaje para el cliente: obligatorio (salvo al agendar) y dentro de las reglas de tono y de "un solo turno".
  const mensaje = String(decision.mensaje || '').trim();
  if (accion !== 'agendar') {
    if (!mensaje) return { ok: false, razon: 'mensaje vacío' };
    if (mensaje.length > 420) return { ok: false, razon: 'mensaje muy largo' };
    if (TONO_PROHIBIDO.test(mensaje)) return { ok: false, razon: 'tono prohibido' };
    if (CONFIANZAS.test(mensaje)) return { ok: false, razon: 'trato de confianza o jerga' };
    if (PRESION.test(mensaje)) return { ok: false, razon: 'presiona al cliente' };
    if (/!!|\?\?|¡¡|¿¿/.test(mensaje)) return { ok: false, razon: 'signos repetidos' };
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

// alDecidir(info): se llama con cada decisión (aprobada o frenada), para guardarla y mostrarla en la app.
// fijo: true en el simulador (siempre encendido, sin importar el ajuste de la app).
function crearAgente({ ia, agenda, reloj = () => new Date(), modo = process.env.AGENTE || 'si', telefonos = process.env.AGENTE_TELEFONOS, alDecidir = null, fijo = false } = {}) {
  const lista = String(telefonos || '').split(/[,\s]+/).map((t) => t.replace(/\D/g, '')).filter(Boolean);
  // "si" (o sin variable) = para todos; "prueba" = solo los celulares de AGENTE_TELEFONOS; "no" = apagado.
  const paraQuien = (telefono) => {
    if (!ia || !ia.activa || !ia.json) return false;
    // El ajuste de la app (Bot → Configuración) manda sobre la variable de Railway.
    const actual = fijo ? 'si' : config.agenteModo || modo;
    if (actual === 'si') return true;
    const t = String(telefono || '').replace(/\D/g, '');
    return actual === 'prueba' && lista.some((x) => t.endsWith(x.slice(-10)));
  };

  const avisar = (info) => {
    if (!alDecidir) return;
    try {
      alDecidir(info);
    } catch (err) {
      console.warn('Agente: no pude guardar la decisión', err.message);
    }
  };

  // Le pide la decisión a la IA y la verifica. Devuelve la decisión válida o null (entonces responden las reglas).
  async function decidir({ s, texto, historial, citas, pedido = {} }) {
    const momento = ahora(reloj());
    const { libres, texto: lista } = turnosLibres(agenda, momento.fecha, config.diasAdelante || 14);
    const conversacion = historial.slice(-30).map((m) => `${m.rol === 'cliente' ? 'Cliente' : 'Taller'}: ${m.texto}`).join('\n');
    const conocidos = { nombre: s.datos.nombre || null, vehiculo: s.datos.vehiculo || null, placa: s.datos.placa || null, telefono: s.datos.telefono || null };
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
      avisar({ s, texto, aprobada: false, razon: `la IA no respondió (${String(err.message).slice(0, 80)})` });
      return null;
    }
    const v = verificar(crudo, { libres, datos: s.datos, texto, servicio: s.servicio, pedido, propuesta: s.propuesta || null });
    if (!v.ok) {
      console.warn('Agente: decisión rechazada, sigo con reglas', { lead: s.lead, razon: v.razon, accion: crudo && crudo.accion });
      avisar({ s, texto, crudo, aprobada: false, razon: v.razon });
      return null;
    }
    console.log('Agente: decidió', { lead: s.lead, accion: v.decision.accion, turno: v.decision.turno, motivo: v.decision.motivo });
    avisar({ s, texto, crudo, decision: v.decision, aprobada: true });
    return v.decision;
  }

  return { paraQuien, decidir };
}

module.exports = { crearAgente, verificar, pulir, placaValida, instrucciones, turnosLibres };
