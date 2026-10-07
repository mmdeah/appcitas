// Atiende cada llamada del bot de Kommo: recupera la conversación, decide qué responder
// y le devuelve a Kommo los mensajes y el estado ({{json.estado}}: esperar, listo o asesor).

const config = require('../config');
const { fechaLarga, horaCorta } = require('./fechas');

// Desde la app Kommo solo acepta instrucciones "show" (mostrar un mensaje), y siempre al menos una.
const mostrar = (value) => ({ handler: 'show', params: { type: 'text', value } });
const RELLENO_BOTONES = ['Hablar con asesor', 'Otro día'];

// Cuando hay que esperar al cliente, la app manda un mensaje corto de confirmación ("Perfecto, el jueves 8 👍")
// y la pregunta va en los datos ({{json.texto}}, {{json.b1}}, {{json.b2}}, {{json.b3}}) para que la envíe
// un bloque Mensaje de Kommo, que es el que sí espera la respuesta.
// estado = "botones" (3 botones) o "texto" (respuesta escrita). Las respuestas finales se mandan directo.
function paraKommo(r) {
  if (r.data.estado !== 'esperar') {
    return { data: r.data, handlers: r.handlers.length ? r.handlers : [mostrar('Un asesor te escribe en un momento 🙌')] };
  }
  const pregunta = r.handlers[r.handlers.length - 1];
  const antes = r.handlers.slice(0, -1);
  const datos = { ...r.data, texto: pregunta.params.value };
  if (pregunta.params.type === 'buttons') {
    const botones = [...pregunta.params.buttons];
    for (const extra of RELLENO_BOTONES) if (botones.length < 3 && !botones.includes(extra)) botones.push(extra);
    Object.assign(datos, { estado: 'botones', b1: botones[0], b2: botones[1], b3: botones[2] });
  } else {
    datos.estado = 'texto';
  }
  return { data: datos, handlers: [mostrar(r.acuse || '👇'), ...antes] };
}

function crearAtencion({ bot, conversaciones, kommo }) {
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
      r = lead
        ? bot.responder({ estado, mensaje: data.mensaje, inicio, servicio: data.servicio, contacto, lead })
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
