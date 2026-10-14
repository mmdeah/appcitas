// Recordatorio el día anterior a la cita: desde las 7 a. m. la app pasa cada lead con cita
// mañana a la etapa RECORDATORIO de Kommo; el bot de esa etapa manda la plantilla de WhatsApp.

const config = require('../config');
const { ahora, sumarDias } = require('./fechas');

// La etapa se busca por nombre en el embudo (o se fija con la variable KOMMO_ETAPA_RECORDATORIO).
function crearRecordatorios({ agenda, kommo, etapa = process.env.KOMMO_ETAPA_RECORDATORIO, nombreEtapa = 'RECORDATORIO', reloj = () => new Date() }) {
  const activo = Boolean(kommo.activo);
  let ocupado = false;

  async function revisar() {
    if (!activo || ocupado) return [];
    const momento = ahora(reloj());
    const { desde, hasta } = config.recordatorio;
    if (momento.hora < desde || momento.hora >= hasta) return [];
    ocupado = true;
    const enviados = [];
    try {
      const pendientes = agenda.paraRecordar(sumarDias(momento.fecha, 1));
      if (!pendientes.length) return enviados;
      if (!etapa) {
        etapa = await kommo.etapaPorNombre(nombreEtapa);
        if (!etapa) {
          console.warn(`Recordatorio: no encontré la etapa "${nombreEtapa}" en el embudo de Kommo`);
          return enviados;
        }
      }
      const yaMovidos = new Set();
      for (const cita of pendientes) {
        try {
          // Un lead con dos citas mañana recibe un solo recordatorio.
          if (!yaMovidos.has(cita.kommo_lead)) await kommo.moverLead(cita.kommo_lead, etapa);
          yaMovidos.add(cita.kommo_lead);
          agenda.marcarRecordada(cita.id);
          enviados.push(cita.id);
          console.log('Recordatorio: lead a RECORDATORIO', { lead: cita.kommo_lead, cita: cita.id, fecha: cita.fecha, hora: cita.hora });
        } catch (err) {
          console.warn('Recordatorio: no pude mover el lead, reintento en un rato', { lead: cita.kommo_lead, error: err.message });
        }
      }
    } finally {
      ocupado = false;
    }
    return enviados;
  }

  return { activo, revisar };
}

module.exports = { crearRecordatorios };
