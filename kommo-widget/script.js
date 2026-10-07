// Paso "Agendar cita" para el Salesbot de Kommo.
// Cada vez que el bot pasa por este paso, le pregunta UNA vez a la agenda del taller qué mostrar.
// La espera de la respuesta del cliente la hace un bloque normal de Kommo ("Pausa: hasta recibir mensaje")
// conectado a la salida "Esperar respuesta", que luego vuelve a un paso Agendar cita con Paso = seguir.
//
//   Agendar cita (inicio) ─ Esperar respuesta ─► Pausa ─► Agendar cita (seguir) ─ Esperar respuesta ─► (misma Pausa)
//        │ Cita agendada / Pasar a asesor                     │ Cita agendada / Pasar a asesor
define([], function () {
  return function () {
    var self = this;
    var URL_POR_DEFECTO = 'https://appcitas.up.railway.app/kommo/bot';

    function urlAgenda() {
      var ajustes = (self.get_settings && self.get_settings()) || {};
      var url = String(ajustes.url_agenda || '').trim();
      return url || URL_POR_DEFECTO;
    }

    function siEstado(valor, salida) {
      return {
        handler: 'conditions',
        params: {
          logic: 'and',
          conditions: [{ term1: '{{json.estado}}', term2: valor, operation: '=' }],
          result: [{ handler: 'exits', params: { value: salida } }]
        }
      };
    }

    this.callbacks = {
      settings: function () { return true; },
      init: function () { return true; },
      bind_actions: function () { return true; },
      render: function () { return true; },
      onSave: function () { return true; },
      destroy: function () {},

      salesbotDesignerSettings: function () {
        return {
          exits: [
            { code: 'esperar', title: 'Esperar respuesta' },
            { code: 'listo', title: 'Cita agendada' },
            { code: 'asesor', title: 'Pasar a asesor' }
          ]
        };
      },

      onSalesbotDesignerSave: function (handler_code, params) {
        var servicio = String((params && params.servicio) || 'REVISION').trim().toUpperCase();
        var paso = String((params && params.paso) || 'inicio').trim().toLowerCase();
        var inicio = paso === 'seguir' ? 'no' : 'si';
        return JSON.stringify([
          {
            question: [
              {
                handler: 'widget_request',
                params: {
                  url: urlAgenda(),
                  data: { lead: '{{lead.id}}', mensaje: '{{message_text}}', servicio: servicio, inicio: inicio }
                }
              },
              { handler: 'goto', params: { type: 'question', step: 1 } }
            ],
            require: []
          },
          {
            question: [
              siEstado('esperar', 'esperar'),
              siEstado('listo', 'listo'),
              { handler: 'exits', params: { value: 'asesor' } }
            ],
            require: []
          }
        ]);
      }
    };

    return this;
  };
});
