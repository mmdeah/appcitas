// Atiende cada llamada del bot de Kommo: recupera la conversación, decide qué responder
// y le devuelve a Kommo los mensajes y el estado ({{json.estado}}: esperar, listo o asesor).

const config = require('../config');
const { fechaLarga, horaCorta } = require('./fechas');

// Desde la app Kommo solo acepta instrucciones "show" (mostrar un mensaje), y siempre al menos una.
const mostrar = (value) => ({ handler: 'show', params: { type: 'text', value } });
const NUMEROS = ['1️⃣', '2️⃣', '3️⃣'];
const MAX_TEXTO = 80;

// Kommo no acepta botones armados por la app dentro de un bloque Mensaje ({{json.b1}}), así que:
// - la app manda la confirmación, la pregunta y las opciones numeradas ("1️⃣ Jueves 8");
// - un bloque Mensaje de Kommo con texto y botones fijos ([1] [2] [3], o "escribe tu respuesta")
//   es el que espera al cliente. estado = "botones" o "texto" decide a cuál bloque va.
// Las respuestas finales (cita agendada, pasar a asesor) se mandan directo.
function paraKommo(r) {
  if (r.data.estado !== 'esperar') {
    return { data: r.data, handlers: r.handlers.length ? r.handlers : [mostrar('Un asesor te escribe en un momento 🙌')] };
  }
  const pregunta = r.handlers[r.handlers.length - 1];
  const antes = r.handlers.slice(0, -1).map((h) => mostrar(h.params.value));
  const acuse = r.acuse || '👇';
  if (pregunta.params.type !== 'buttons') {
    return { data: { ...r.data, estado: 'texto' }, handlers: [mostrar(acuse), ...antes, mostrar(pregunta.params.value)] };
  }
  const texto = pregunta.params.value.replace(/\s*Toca una opción 👇$/, '');
  const juntos = `${acuse}\n${texto}`;
  const cabeza = [...juntos].length <= MAX_TEXTO ? [mostrar(juntos)] : [mostrar(acuse), mostrar(texto)];
  const opciones = pregunta.params.buttons.map((b, i) => `${NUMEROS[i]} ${b}`).join('\n');
  return { data: { ...r.data, estado: 'botones' }, handlers: [...cabeza, ...antes, mostrar(opciones)] };
}

// libre: conversación por texto libre (con IA). Se usa cuando el paso llega con Paso = seguir y no hay
// conversación guardada (el cliente ya respondió al mensaje de "pedir datos"), o si ya va en ese modo.
function crearAtencion({ bot, conversaciones, kommo, libre = null }) {
  return async function atender({ data = {}, return_url: direccion }) {
    const lead = String(data.lead || '').replace(/\D/g, '');
    const inicio = String(data.inicio) === 'si';
    const estado = !inicio && lead ? conversaciones.leer(lead) : null;

    let contacto = {};
    if (lead && (!estado || !estado.telefono)) {
      try {
        contacto = await kommo.contactoDelLead(lead);
      } catch (err) {
        console.warn('Kommo: no pude leer el contacto del lead', lead, err.message);
      }
    }

    let r;
    try {
      const usarLibre = libre && ((estado && estado.modo === 'libre') || (!estado && !inicio));
      const motor = usarLibre ? libre : bot;
      r = lead
        ? await motor.responder({ estado, mensaje: data.mensaje, inicio, servicio: data.servicio, contacto, lead })
        : { siguiente: null, handlers: [], data: { estado: 'asesor', motivo: 'sin_lead' } };
    } catch (err) {
      // Nunca dejar el bot de Kommo esperando: si algo falla, pasa al asesor.
      console.error('Bot: error respondiendo al lead', lead, err);
      r = { siguiente: null, handlers: [], data: { estado: 'asesor', motivo: 'error' } };
    }

    if (lead) {
      if (r.siguiente) conversaciones.guardar(lead, r.siguiente);
      else conversaciones.borrar(lead);
    }

    const { data: datos, handlers } = paraKommo(r);
    await kommo.continuar(direccion, { data: datos, execute_handlers: handlers });
    console.log('Kommo: respuesta enviada al bot', { lead, estado: datos.estado, mensajes: handlers.length });

    if (r.cita) {
      const c = r.cita;
      const texto =
        `Cita agendada por el bot (#${c.id}): ${config.servicios[c.servicio].nombre}, ` +
        `${fechaLarga(c.fecha)} a las ${horaCorta(c.hora)}. ` +
        `${c.cliente} · ${c.vehiculo || 'vehículo sin dato'} · placa ${c.placa || 'sin dato'}.`;
      await kommo.nota(lead, texto).catch((err) => console.warn('Kommo: no pude dejar la nota en el lead', lead, err.message));
    }
    return r;
  };
}

module.exports = { crearAtencion, paraKommo };
