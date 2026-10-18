// Reprogramar desde el recordatorio: cuando el cliente toca "Reprogramar", el bot de Kommo le pregunta
// qué otro día le sirve y pasa el lead a la etapa REPROGRAMAR. La app revisa esa etapa cada 2 minutos:
// cancela la cita pendiente del lead (la del recordatorio), deja una nota y lo pasa a LLAMAR para el asesor.

const config = require('../config');
const { fechaLarga, horaCorta } = require('./fechas');

function crearReprogramaciones({ agenda, kommo, nombreEtapa = 'REPROGRAMAR' }) {
  const activo = Boolean(kommo.activo && kommo.leadsEnEtapa);
  let etapa = null;
  let avisado = false;
  let ocupado = false;

  async function revisar() {
    if (!activo || ocupado) return [];
    ocupado = true;
    const canceladas = [];
    try {
      if (!etapa) {
        etapa = await kommo.etapaPorNombre(nombreEtapa);
        if (!etapa) {
          if (!avisado) console.log(`Reprogramar: no hay etapa "${nombreEtapa}" en Kommo; no se revisa.`);
          avisado = true;
          return canceladas;
        }
      }
      for (const lead of await kommo.leadsEnEtapa(etapa)) {
        try {
          // La que se recordó primero; si no hay, la próxima pendiente.
          const pendientes = agenda.citasDelLead(lead);
          const cita = pendientes.find((c) => c.recordada) || pendientes[0];
          if (cita) {
            agenda.cancelar(cita.id);
            canceladas.push(cita.id);
          }
          const texto = cita
            ? `Bot: el cliente pidió reprogramar. Se canceló la cita del ${fechaLarga(cita.fecha)} a las ${horaCorta(cita.hora)}. Cuadra la nueva fecha con él.`
            : 'Bot: el cliente pidió reprogramar, pero no tenía citas pendientes en la agenda.';
          await kommo.nota(lead, texto).catch((err) => console.warn('Reprogramar: no pude dejar la nota', lead, err.message));
          await kommo.moverLead(lead, config.kommo.etapaAsesor);
          console.log('Reprogramar: cita cancelada y lead a LLAMAR', { lead, cita: cita ? cita.id : null });
        } catch (err) {
          console.warn('Reprogramar: no pude procesar el lead, reintento en un rato', { lead, error: err.message });
        }
      }
    } catch (err) {
      console.warn('Reprogramar: no pude revisar la etapa:', err.message);
    } finally {
      ocupado = false;
    }
    return canceladas;
  }

  return { activo, revisar };
}

module.exports = { crearReprogramaciones };
