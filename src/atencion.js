// Atiende cada llamada del bot de Kommo: recupera la conversación, decide qué responder
// y le devuelve a Kommo los mensajes y el estado ({{json.estado}}: esperar, listo o asesor).

const config = require('../config');
const { fechaLarga, horaCorta } = require('./fechas');

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

    await kommo.continuar(direccion, { data: r.data, execute_handlers: r.handlers });
    console.log('Kommo: respuesta enviada al bot', { lead, estado: r.data.estado, mensajes: r.handlers.length });

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

module.exports = { crearAtencion };
