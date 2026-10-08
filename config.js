// Datos del taller. Todo lo que cambia cómo se reparten las citas está aquí.

module.exports = {
  negocio: 'Automotriz Online SD',
  direccion: 'Av. 6 Norte #18-22, B/ Granada, Cali',
  zonaHoraria: 'America/Bogota',

  // Cuenta de Kommo (autoonlinesdclientes.kommo.com). Las llaves van en variables de entorno.
  kommo: { subdominio: 'autoonlinesdclientes' },

  // Horas en las que puede EMPEZAR una cita, por día de la semana
  // (0 = domingo, 1 = lunes … 6 = sábado). Un día que no aparece no recibe citas.
  // "hasta" es la última hora de inicio. Turnos cada 30 min (8:30, 9:00, 9:30…).
  horario: {
    1: { desde: '08:30', hasta: '15:30' },
    2: { desde: '08:30', hasta: '15:30' },
    3: { desde: '08:30', hasta: '15:30' },
    4: { desde: '08:30', hasta: '15:30' },
    5: { desde: '08:30', hasta: '15:30' },
    6: { desde: '08:30', hasta: '15:30' },
  },
  intervaloMinutos: 30,

  // Cuántos vehículos se pueden recibir dentro de la misma hora (9:00 y 9:30 cuentan juntos).
  capacidadPorHora: 2,

  // Límites para lo que agenda el bot (las citas que pones tú a mano no los usan).
  diasAdelante: 14, // hasta cuántos días en el futuro se puede agendar
  anticipacionMinutos: 120, // no ofrecer horas que empiezan en menos de 2 horas

  // Los festivos de Colombia se calculan solos y no reciben citas.
  cerrarFestivos: true,

  servicios: {
    REVISION: {
      nombre: 'Revisión General Preventiva',
      corto: 'Revisión',
      precio: 'Precio: $60.000',
      duracionMinutos: 45,
    },
    SINCRONIZACION: {
      nombre: 'Sincronización',
      corto: 'Sincronización',
      precio: 'Desde $180.000 (automóviles) y $210.000 (camionetas)',
      duracionMinutos: 240,
    },
  },
};
