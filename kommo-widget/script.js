// Paso "Agendar cita" para el Salesbot de Kommo.
// El bot le pregunta a la agenda del taller qué mostrar, espera la respuesta del cliente
// y repite hasta que la cita queda guardada ("Cita agendada") o hace falta un asesor ("Pasar a asesor").
define([], function () {
  return function () {
    var self = this;
    var URL_POR_DEFECTO = 'https://appcitas.up.railway.app/kommo/bot';

    function urlAgenda() {
      var ajustes = (self.get_settings && self.get_settings()) || {};
      var url = String(ajustes.url_agenda || '').trim();
      return url || URL_POR_DEFECTO;
    }

    // inicio = 'si' la primera vez (empieza de cero); 'no' en cada respuesta del cliente.
    function consultarAgenda(inicio, servicio) {
      return {
        handler: 'widget_request',
        params: {
          url: urlAgenda(),
          data: { lead: '{{lead.id}}', mensaje: '{{message_text}}', servicio: servicio, inicio: inicio }
        }
      };
    }

    function irA(tipo, paso) {
      return { handler: 'goto', params: { type: tipo, step: paso } };
    }

    function siEstado(valor, resultado) {
      return {
        handler: 'conditions',
        params: {
          logic: 'and',
          conditions: [{ term1: '{{json.estado}}', term2: valor, operation: '=' }],
          result: [resultado]
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
            { code: 'listo', title: 'Cita agendada' },
            { code: 'asesor', title: 'Pasar a asesor' }
          ]
        };
      },

      onSalesbotDesignerSave: function (handler_code, params) {
        var servicio = String((params && params.servicio) || 'REVISION').trim().toUpperCase();
        return JSON.stringify([
          // 0: primera consulta a la agenda
          { question: [consultarAgenda('si', servicio), irA('question', 1)], require: [] },
          // 1: según lo que respondió la agenda: esperar un mensaje NUEVO del cliente, terminar o pasar a asesor
          {
            question: [
              siEstado('esperar', { handler: 'wait_answer', params: { type: 'question', step: 2 } }),
              siEstado('listo', { handler: 'exits', params: { value: 'listo' } }),
              { handler: 'exits', params: { value: 'asesor' } }
            ],
            require: []
          },
          // 2: el cliente respondió: se le pasa a la agenda
          { question: [consultarAgenda('no', servicio), irA('question', 1)], require: [] }
        ]);
      }
    };

    return this;
  };
});
