// Simulación con la IA REAL (OpenRouter) de las conversaciones de las capturas, sin tocar la base de datos real.
// Uso:  node --env-file=.env --disable-warning=ExperimentalWarning scripts/simular-agente.js
// Necesita OPENROUTER_API_KEY y OPENROUTER_MODEL en .env (cada corrida cuesta unos centavos de dólar).

const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearConversacionLibre } = require('../src/libre');
const { crearIA } = require('../src/ia');
const { crearAgente } = require('../src/agente');
const { crearMemoria } = require('../src/memoria');

// "Ahora" de la simulación: lunes 19 de octubre de 2026, 7:28 a. m. (como el caso de Omar).
const reloj = () => new Date('2026-10-19T12:28:00Z');

// Cada caso: mensajes del cliente y cómo está la agenda (días bloqueados o citas ya tomadas).
const casos = [
  { nombre: 'José: placa con letra O (NCY O66)', mensajes: ['José Daniel Ñañez\nCamioneta captiva 2012\nPlaca NCY O66\nSabado 24 oct  11 am'] },
  {
    nombre: 'Omar: placa pegada a la hora, hoy lleno, pico y placa el martes',
    bloquear: ['2026-10-19'],
    mensajes: ['omar lopera , ford edge, 2019, GYN9823:30 pm', 'hoy lunes', 'cómo pueden ver el martes tengo pico y placa', 'listo'],
  },
  {
    nombre: 'Alexander: hora ocupada, "ya te confirmo" y vuelve con "tipo 11"',
    citas: [['2026-10-26', '09:00'], ['2026-10-26', '09:30']],
    mensajes: ['Alexander Castro, Suzuki Crooss 2023, LKX983, lunes 26 octubre a las 9:30', 'Ya te confirmo', 'Tipo 11 no tienes cupo?'],
  },
  { nombre: 'Fredy: todo en una línea con errores', mensajes: ['Fredy Valencia tuson i35 modelo 2012 sábado 2:30', 'CQW979'] },
  {
    nombre: 'Dario: días bloqueados, "¿para mañana?" y despedida',
    bloquear: ['2026-10-20', '2026-10-21', '2026-10-22'],
    mensajes: ['Dario Pineda, Chevrolet onix activ 2018, ENT921, jueves a las 9:00 AM', 'Para mañana no tienes en ningún horario?', 'Mañana te confirmaría listo Muchas gracias'],
  },
  { nombre: 'Pedro: mensaje desordenado "tipo 2"', mensajes: ['hola soy pedro, tengo un mazda 2 del 2019 placa KJH456, me sirve el viernes en la tarde tipo 2'] },
  { nombre: 'Cliente del Sandero: pregunta por mantenimiento', mensajes: ['Tengo un sandero cuanto vale el mantenimiento'] },
  { nombre: 'Saludo suelto días después', mensajes: ['Hola buen día'] },
  { nombre: 'Preguntas permitidas: precio, duración y dirección', mensajes: ['cuánto vale la revisión y cuánto se demora? y dónde quedan?'] },
  { nombre: 'Rechaza la hora dos veces', mensajes: ['Laura Gómez, Mazda 2 2020, PLM456, el miércoles', 'no me sirve tan temprano', 'otro más tarde', 'perfecto'] },
  { nombre: 'Broma / fuera de lugar', mensajes: ['jajaja q bot tan malo'] },
];

(async () => {
  const ia = crearIA();
  if (!ia.activa) {
    console.error('Falta OPENROUTER_API_KEY y/o OPENROUTER_MODEL en .env');
    process.exit(1);
  }
  console.log(`Modelo: ${process.env.OPENROUTER_MODEL}\n`);
  for (const caso of casos) {
    const db = abrir(':memory:');
    const agenda = crearAgenda(db, undefined, reloj);
    for (const fecha of caso.bloquear || []) agenda.bloquear({ fecha, motivo: 'simulación' });
    (caso.citas || []).forEach(([fecha, hora], i) =>
      agenda.reservar({ servicio: 'REVISION', fecha, hora, cliente: `Otro ${i}`, telefono: `30000000${10 + i}` }, { forzar: true })
    );
    const agente = crearAgente({ ia, agenda, reloj, modo: 'si' });
    const libre = crearConversacionLibre(agenda, { ia, agente, memoria: crearMemoria(db), reloj });
    console.log(`=== ${caso.nombre} ===`);
    let estado = null;
    for (const mensaje of caso.mensajes) {
      const r = await libre.responder({ estado, mensaje, servicio: 'REVISION', contacto: { telefono: '3001234567' }, lead: '1' });
      console.log(`  Cliente: ${mensaje.replace(/\n/g, ' / ')}`);
      const salida = [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean);
      if (r.estado === 'asesor') console.log(`    (el bot NO responde: pasa a asesor · ${r.data.motivo})`);
      else for (const t of salida) console.log(`    Bot: ${t.replace(/\n/g, ' / ')}`);
      if (r.cita) console.log(`    ✔ CITA: ${r.cita.fecha} ${r.cita.hora} · ${r.cita.cliente} · ${r.cita.vehiculo} · ${r.cita.placa}`);
      console.log(`    [${r.data.decidio === 'ia' ? 'decidió la IA' : 'respondieron las reglas'}]`);
      estado = r.siguiente || r.cerrado || null;
    }
    console.log('');
  }
})();
