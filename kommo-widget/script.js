// Paso "Agendar cita" para el Salesbot de Kommo.
// Cada vez que el bot pasa por este paso, le pregunta UNA vez a la agenda del taller qué sigue.
// Cuando hay que preguntarle algo al cliente, la agenda NO lo manda: deja el texto y los botones en
// {{json.texto}}, {{json.b1}}, {{json.b2}}, {{json.b3}} y sale por:
//   - "Preguntar con botones": a un bloque Mensaje con esos 3 botones (espera la respuesta).
//   - "Preguntar por escrito": a un bloque Mensaje con {{json.texto}} (espera la respuesta).
// La respuesta del cliente (cualquiera) vuelve a un paso Agendar cita con Paso = seguir.
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
            { code: 'botones', title: 'Preguntar con botones' },
            { code: 'texto', title: 'Preguntar por escrito' },
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
              siEstado('botones', 'botones'),
              siEstado('texto', 'texto'),
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
