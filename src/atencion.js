// Atiende cada llamada del bot de Kommo: recupera la conversación, decide qué responder
// y le devuelve a Kommo los mensajes y el estado ({{json.estado}}: esperar, listo o asesor).

const config = require('../config');
const { fechaLarga, horaCorta } = require('./fechas');

// Kommo rechaza una respuesta sin instrucciones; cuando no hay nada que mostrar por esta vía
// se manda una que el cliente no ve: la etiqueta "agenda-bot" en el lead.
const ETIQUETA_SILENCIOSA = { handler: 'action', params: { name: 'set_tag', params: { type: 2, value: 'agenda-bot' } } };
const RELLENO_BOTONES = ['Hablar con asesor', 'Otro día'];

// Cuando hay que esperar al cliente, la pregunta NO se manda desde la app: va en los datos
// ({{json.texto}}, {{json.b1}}, {{json.b2}}, {{json.b3}}) para que la envíe un bloque Mensaje de Kommo,
// que es el que sí espera la respuesta. estado = "botones" (3 botones) o "texto" (respuesta escrita).
// Las respuestas finales (cita agendada, pasar a asesor) sí se mandan directo.
function paraKommo(r) {
  if (r.data.estado !== 'esperar') {
    return { data: r.data, handlers: r.handlers.length ? r.handlers : [ETIQUETA_SILENCIOSA] };
  }
  const textos = r.handlers.filter((h) => h.handler === 'show').map((h) => h.params.value);
  const conBotones = r.handlers.find((h) => h.params && h.params.type === 'buttons');
  const datos = { ...r.data, texto: textos.join('\n\n') };
  if (conBotones) {
    const botones = [...conBotones.params.buttons];
    for (const extra of RELLENO_BOTONES) if (botones.length < 3 && !botones.includes(extra)) botones.push(extra);
    Object.assign(datos, { estado: 'botones', b1: botones[0], b2: botones[1], b3: botones[2] });
  } else {
    datos.estado = 'texto';
  }
  return { data: datos, handlers: [ETIQUETA_SILENCIOSA] };
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
