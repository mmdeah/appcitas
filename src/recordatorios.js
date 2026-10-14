// Recordatorio el día anterior a la cita: desde las 7 a. m. la app pasa cada lead con cita
// mañana a la etapa RECORDATORIO de Kommo; el bot de esa etapa manda la plantilla de WhatsApp.

const config = require('../config');
const { ahora, sumarDias } = require('./fechas');

function crearRecordatorios({ agenda, kommo, etapa = process.env.KOMMO_ETAPA_RECORDATORIO, reloj = () => new Date() }) {
  const activo = Boolean(kommo.activo && etapa);
  let ocupado = false;

  async function revisar() {
    if (!activo || ocupado) return [];
    const momento = ahora(reloj());
    const { desde, hasta } = config.recordatorio;
    if (momento.hora < desde || momento.hora >= hasta) return [];
    ocupado = true;
    const enviados = [];
    try {
      const yaMovidos = new Set();
      for (const cita of agenda.paraRecordar(sumarDias(momento.fecha, 1))) {
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
