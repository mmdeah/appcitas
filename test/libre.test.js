const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { abrir } = require('../src/db');
const { crearAgenda } = require('../src/agenda');
const { crearBot } = require('../src/bot');
const { crearConversaciones } = require('../src/conversaciones');
const { crearAtencion } = require('../src/atencion');
const { crearConversacionLibre, fechaEscrita, horaEscrita, partir } = require('../src/libre');

const horario = { desde: '08:30', hasta: '15:30' };
const cfg = {
  horario: { 1: horario, 2: horario, 3: horario, 4: horario, 5: horario, 6: horario },
  intervaloMinutos: 60,
  capacidadPorHora: 2,
  diasAdelante: 14,
  anticipacionMinutos: 120,
  cerrarFestivos: true,
  servicios: { REVISION: {}, SINCRONIZACION: {} },
};
// Martes 6 de octubre de 2026, 8:00 a. m. en Colombia.
const reloj = () => new Date('2026-10-06T13:00:00Z');

let db;
let agenda;
beforeEach(() => {
  db = abrir(':memory:');
  agenda = crearAgenda(db, cfg, reloj);
});

const textos = (r) => [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean);

// Simula una conversación y revisa los límites de Kommo en cada respuesta.
async function charla(libre, mensajes, contacto = { telefono: '300 123 4567' }) {
  let estado = null;
  const respuestas = [];
  for (const mensaje of mensajes) {
    const r = await libre.responder({ estado, mensaje, servicio: 'REVISION', contacto, lead: '55' });
    for (const t of textos(r)) assert.ok([...t].length <= 80, `más de 80: ${t}`);
    assert.ok(r.handlers.length + 1 <= 10);
    respuestas.push(r);
    estado = r.siguiente;
  }
  return respuestas;
}

test('lee días y horas escritos sin confundirlos con placas, años ni modelos', () => {
  const hoy = '2026-10-06';
  const t = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9: ]/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(fechaEscrita(t('Mazda 3 2018, el jueves a las 10:30'), hoy), '2026-10-08');
  assert.equal(fechaEscrita(t('mañana en la mañana'), hoy), '2026-10-07');
  assert.equal(fechaEscrita(t('el 14 porfa'), hoy), '2026-10-14');
  assert.equal(fechaEscrita(t('viernes 16'), hoy), '2026-10-16');
  assert.equal(fechaEscrita(t('16 de octubre'), hoy), '2026-10-16');
  assert.equal(fechaEscrita(t('tengo un spark placa ABC123'), hoy), null);
  assert.equal(horaEscrita(t('el jueves a las 10:30')), '10:30');
  assert.equal(horaEscrita(t('a las 2')), '14:00');
  assert.equal(horaEscrita(t('a las 9 y media')), '09:30');
  assert.equal(horaEscrita(t('3 pm')), '15:00');
  assert.equal(horaEscrita(t('2 de la tarde')), '14:00');
  assert.equal(horaEscrita(t('Spark 2015 ABC123')), null);
  assert.equal(horaEscrita(t('10'), true), '10:00');
});

test('sin IA: toma lo que entiende, pregunta lo que falta y agenda apenas tiene todo', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const [primero, nombre, listo] = await charla(libre, [
    'Hola, quiero la revisión el jueves a las 10:30, placa ABC123',
    'Juan Pérez',
    'Chevrolet Spark 2015',
  ]);
  assert.deepEqual(textos(primero), ['Perfecto 👍 ¿Me dices tu nombre y el vehículo (marca, modelo y año)?']);
  assert.deepEqual(textos(nombre), ['Gracias, Juan 🙌 ¿Qué vehículo es? Ej: Mazda 3 2018']);
  // Con todos los datos agenda de una vez, sin preguntar "¿Confirmo?".
  assert.equal(listo.estado, 'listo');
  assert.match(textos(listo).join('\n'), /Listo, Juan!.*Jueves 8 de octubre a las 10:30 a\. m\..*Chevrolet Spark 2015 · ABC123/s);
  const c = listo.cita;
  assert.deepEqual(
    [c.fecha, c.hora, c.cliente, c.vehiculo, c.placa, c.telefono, c.origen, c.kommo_lead],
    ['2026-10-08', '10:30', 'Juan Pérez', 'Chevrolet Spark 2015', 'ABC123', '573001234567', 'BOT', '55']
  );
});

test('la conversación real: un mensaje en líneas con "mañana 10 am" agenda de una vez', async () => {
  const media = crearAgenda(db, { ...cfg, intervaloMinutos: 30 }, reloj);
  const libre = crearConversacionLibre(media, { reloj });
  const [listo] = await charla(libre, ['David Perlaza\nNissan Tiida\nABC133\nMañana 10 am']);
  assert.equal(listo.estado, 'listo');
  assert.deepEqual(
    [listo.cita.cliente, listo.cita.vehiculo, listo.cita.placa, listo.cita.fecha, listo.cita.hora],
    ['David Perlaza', 'Nissan Tiida', 'ABC133', '2026-10-07', '10:00']
  );
  // Si le preguntaron nombre y vehículo, los toma de dos líneas aunque traigan el año.
  const [, ambos] = await charla(libre, ['el viernes a las 9 placa XYZ789', 'David Perlaza\nNissan Versa 2010']);
  assert.equal(ambos.estado, 'listo');
  assert.deepEqual([ambos.cita.cliente, ambos.cita.vehiculo], ['David Perlaza', 'Nissan Versa 2010']);
});

test('con IA: lee el mensaje, agenda y la respuesta suena natural sin cambiar los datos', async () => {
  const ia = {
    activa: true,
    extraer: async () => ({ nombre: 'Ana Gómez', vehiculo: 'Renault Duster 2019', placa: 'jkl-456', fecha: '2026-10-09', hora: '14:30', asesor: false }),
    redactar: async ({ borrador }) => `¡Hola Ana! ${borrador}`,
  };
  const libre = crearConversacionLibre(agenda, { ia, reloj });
  const [listo] = await charla(libre, ['soy ana, duster 2019 jkl456, el viernes tipo 2:30 de la tarde']);
  assert.equal(listo.estado, 'listo');
  assert.equal(listo.cita.placa, 'JKL456');
  // La confirmación va con el texto fijo; la IA solo redacta las preguntas.
  assert.match(textos(listo)[0], /^✅ ¡Listo, Ana!/);
  const [pregunta] = await charla(crearConversacionLibre(agenda, { ia: { ...ia, extraer: async () => ({ nombre: 'Ana Gómez' }) }, reloj }), ['soy ana']);
  assert.match(textos(pregunta)[0], /^¡Hola Ana!/);
  // El paso a asesor también va con el texto fijo.
  const [asesor] = await charla(crearConversacionLibre(agenda, { ia: { ...ia, extraer: async () => ({}) }, reloj }), ['hola']);
  assert.deepEqual(textos(asesor), ['Dame un momento, ya te escribe un asesor 🙌']);

  // Si la IA cambia una hora, se usa el texto original.
  const tramposa = { ...ia, redactar: async ({ borrador }) => borrador.replace('2:30', '4:00') };
  const aviso = console.warn;
  console.warn = () => {};
  try {
    const [otra] = await charla(crearConversacionLibre(agenda, { ia: { ...tramposa, extraer: async () => ({ nombre: 'Luis', vehiculo: 'Kia Rio', placa: 'QWE123', fecha: '2026-10-09', hora: '14:30' }) }, reloj }), ['hola']);
    assert.match(textos(otra).join(' '), /2:30 p\. m\./);
    // Si la IA cambia el día, también se usa el texto original.
    const otroDia = { ...tramposa, redactar: async ({ borrador }) => borrador.replace(/viernes/gi, 'Sábado') };
    const [dia] = await charla(crearConversacionLibre(agenda, { ia: { ...otroDia, extraer: async () => ({ nombre: 'Eva', vehiculo: 'Kia Rio', placa: 'ASD123', fecha: '2026-10-09', hora: '13:30' }) }, reloj }), ['hola']);
    assert.match(textos(dia).join(' '), /viernes/i);
  } finally {
    console.warn = aviso;
  }
});

test('guarda el historial de la conversación para darle contexto a la IA', async () => {
  const vistos = [];
  const ia = {
    activa: true,
    extraer: async ({ historial }) => { vistos.push(historial.length); return {}; },
    redactar: async () => null,
  };
  const libre = crearConversacionLibre(agenda, { ia, reloj });
  const r = await charla(libre, ['el jueves a las 10:30 placa ABC123', 'Juan']);
  assert.deepEqual(vistos, [0, 2]);
  assert.equal(r[1].siguiente.historial.length, 4);
  assert.equal(r[1].siguiente.historial[2].texto, 'Juan');
});

test('si la IA falla, sigue con reglas sin romperse', async () => {
  const ia = { activa: true, extraer: async () => { throw new Error('caída'); } };
  const libre = crearConversacionLibre(agenda, { ia, reloj });
  const aviso = console.warn;
  console.warn = () => {};
  try {
    const [r] = await charla(libre, ['el viernes a las 9 y media, placa XYZ789']);
    assert.equal(r.estado, 'esperar');
    assert.deepEqual([r.siguiente.datos.fecha, r.siguiente.datos.hora, r.siguiente.datos.placa], ['2026-10-09', '09:30', 'XYZ789']);
  } finally {
    console.warn = aviso;
  }
});

test('hora ocupada o día sin cupo: propone opciones reales', async () => {
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-08', hora: '10:30', cliente: 'X', telefono: '3000000001' });
  agenda.reservar({ servicio: 'REVISION', fecha: '2026-10-08', hora: '10:30', cliente: 'Y', telefono: '3000000002' });
  const libre = crearConversacionLibre(agenda, { reloj });
  const [ocupada] = await charla(libre, ['el jueves a las 10:30']);
  assert.deepEqual(textos(ocupada), ['A las 10:30 a. m. ya no tenemos cupo el jueves 8.', 'Tenemos disponible 8:30, 9:30 u 11:30 a. m. ¿Cuál prefieres?']);
  assert.equal(ocupada.siguiente.preguntando, 'hora');

  const [domingo] = await charla(libre, ['el domingo']);
  assert.deepEqual(textos(domingo), ['El domingo 11 no atendemos.', 'Tenemos disponible el viernes 9, sábado 10 o martes 13. ¿Cuál prefieres?']);
  assert.equal(domingo.siguiente.preguntando, 'fecha');
  assert.equal(domingo.siguiente.datos.fecha, null);
});

test('pide asesor o el mensaje no aporta nada: pasa a asesor de una vez', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const [asesor] = await charla(libre, ['quiero hablar con un asesor']);
  assert.equal(asesor.estado, 'asesor');
  const [r] = await charla(libre, ['jaja']);
  assert.equal(r.estado, 'asesor');
  assert.equal(r.data.motivo, 'no_entendio');
  // Si ya iba agendando y se va por otro lado, también se corta.
  const [, otroTema] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123', '¿y cuánto cuesta el cambio de aceite?']);
  assert.equal(otroTema.estado, 'asesor');
});

test('"Sábado 9 am" es el sábado a las 9, no el día 9', async () => {
  // Martes 13 de octubre de 2026, 9 p. m. (como la prueba real).
  const reloj13 = () => new Date('2026-10-14T02:00:00Z');
  const libre = crearConversacionLibre(crearAgenda(db, { ...cfg, intervaloMinutos: 30 }, reloj13), { reloj: reloj13 });
  const [listo] = await charla(libre, ['Mario Rincón\nCQW979\nNissan March\nSábado 9 am']);
  assert.equal(listo.estado, 'listo');
  assert.deepEqual([listo.cita.fecha, listo.cita.hora], ['2026-10-17', '09:00']);
  // Si falta el día, lo pregunta claro.
  const [dia] = await charla(libre, ['Mario Rincón, Nissan March, CQW979, a las 9 am']);
  assert.match(textos(dia).join(' '), /¿Para qué día te agendo a las 9:00 a\. m\.\? Tengo espacio mañana miércoles 14, el jueves 15 o el viernes 16\./);
});

test('Kommo con Paso = seguir y sin conversación guardada usa el texto libre', async () => {
  const enviados = [];
  const kommo = { contactoDelLead: async () => ({ telefono: '3001112233' }), continuar: async (u, c) => enviados.push(c), nota: async () => {} };
  const atender = crearAtencion({
    bot: crearBot(agenda, { reloj }),
    conversaciones: crearConversaciones(db),
    kommo,
    libre: crearConversacionLibre(agenda, { reloj }),
  });
  const log = console.log;
  console.log = () => {};
  try {
    await atender({ data: { lead: '9', inicio: 'no', servicio: 'REVISION', mensaje: 'Pedro, Kia Rio 2020 placa QWE123, mañana a las 2' }, return_url: 'x' });
    await atender({ data: { lead: '9', inicio: 'no', mensaje: 'si' }, return_url: 'x' });
  } finally {
    console.log = log;
  }
  // Sin IA el nombre no se puede sacar de una frase larga: lo pregunta.
  assert.equal(enviados[0].data.estado, 'texto');
  // Nunca se le escribe al cliente nada distinto de mensajes "show"; al pasar a asesor solo se termina el bot.
  for (const e of enviados) for (const h of e.execute_handlers) assert.ok(h.handler === 'show' || (h.handler === 'goto' && h.params.type === 'finish'));
});

test('parte textos largos en mensajes de 80 caracteres sin cortar palabras', () => {
  const partes = partir('Para agendarte me falta: tu nombre, el vehículo (marca, modelo y año), la placa, el día y la hora ✍️');
  assert.ok(partes.length === 2);
  for (const p of partes) assert.ok([...p].length <= 80);
});

test('todo en una línea: separa nombre, vehículo, día y hora (caso real)', async () => {
  // Martes 13 de octubre de 2026, 10 p. m.
  const reloj13 = () => new Date('2026-10-14T03:00:00Z');
  const libre = crearConversacionLibre(crearAgenda(db, { ...cfg, intervaloMinutos: 30 }, reloj13), { reloj: reloj13 });
  const [r] = await charla(libre, ['Fredy Valencia tuson i35 modelo 2012 sábado 2:30']);
  assert.deepEqual(
    [r.siguiente.datos.nombre, r.siguiente.datos.vehiculo, r.siguiente.datos.fecha, r.siguiente.datos.hora],
    ['Fredy Valencia', 'tuson i35 2012', '2026-10-17', '14:30']
  );
  assert.equal(r.siguiente.preguntando, 'placa');
  // Si pidió nombre y placa y llegan juntos, toma los dos.
  const [, ambos] = await charla(libre, ['tucson 2012 el sábado a las 3', 'Fredy Valencia CQW979']);
  assert.equal(ambos.estado, 'listo');
  assert.deepEqual([ambos.cita.cliente, ambos.cita.placa], ['Fredy Valencia', 'CQW979']);
});

test('preguntas comunes en medio de la conversación: responde y sigue con la cita', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const [primero, donde] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123', '¿dónde quedan?']);
  assert.equal(primero.estado, 'esperar');
  assert.equal(donde.estado, 'esperar');
  assert.match(textos(donde)[0], /Av\. 6 Norte #18-22/);
  assert.match(textos(donde).join(' '), /¿Qué día y a qué hora/);
  assert.doesNotMatch(textos(donde).join(' '), /No te entendí|Perfecto/);

  const [precio] = await charla(libre, ['cuánto vale la revisión? el jueves a las 10:30, Ana Ruiz, Kia Rio 2020, QWE123']);
  assert.equal(precio.estado, 'listo');

  const [soloPrecio] = await charla(libre, ['¿cuánto cuesta?']);
  assert.match(textos(soloPrecio)[0], /\$60\.000/);
});

test('las citas del mismo cliente quedan todas activas', async () => {
  const libre = crearConversacionLibre(agenda, { reloj });
  const [a] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123, el jueves a las 10:30']);
  const [b] = await charla(libre, ['Juan Pérez, Kia Rio 2020, QWE123, el viernes a las 9:30']);
  assert.equal(agenda.cita(a.cita.id).estado, 'AGENDADA');
  assert.equal(agenda.cita(b.cita.id).estado, 'AGENDADA');
});

test('a Kommo le llega estado "listo" al agendar y "asesor" al pasar a asesor (decide la salida del bot)', async () => {
  const { paraKommo } = require('../src/atencion');
  const libre = crearConversacionLibre(agenda, { reloj });
  const [listo] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123, el jueves a las 10:30']);
  assert.equal(listo.data.estado, 'listo');
  assert.equal(paraKommo(listo).data.estado, 'listo');
  assert.equal(listo.data.cita, String(listo.cita.id));
  const [asesor] = await charla(libre, ['jaja']);
  assert.equal(paraKommo(asesor).data.estado, 'asesor');
  assert.equal(asesor.data.motivo, 'no_entendio');
});

test('caso real Dario: pedir cupo para mañana no es preguntar el horario, y "mañana te confirmo" cierra amable', async () => {
  // Martes 13 de octubre, 10 p. m.
  const reloj13 = () => new Date('2026-10-14T03:08:00Z');
  const media = crearAgenda(db, { ...cfg, intervaloMinutos: 30 }, reloj13);
  const libre = crearConversacionLibre(media, { reloj: reloj13 });
  const [, manana, adios] = await charla(libre, [
    'Dario Pineda, Chevrolet onix activ 2018, ENT921',
    'Para mañana no tienes en ningún horario?',
    'Mañana te confirmaría listo Muchas gracias',
  ]);
  assert.doesNotMatch(textos(manana).join(' '), /Atendemos/);
  assert.equal(manana.siguiente.datos.fecha, '2026-10-14');
  assert.equal(adios.estado, 'asesor');
  assert.equal(adios.data.motivo, 'despedida');
  assert.match(textos(adios)[0], /Cuando quieras/);
  // Preguntar el horario de atención sí lo responde, en frases completas.
  const [, horario] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123', '¿cuál es su horario de atención?']);
  assert.deepEqual(textos(horario).slice(0, 2), ['🕘 Atendemos de lunes a sábado, de 8 a. m. a 5 p. m.', 'Las citas son de 8:30 a. m. a 3:30 p. m.']);
});

test('memoria: la IA recibe lo hablado antes con el lead (aunque la conversación anterior terminó) y sus citas', async () => {
  const { crearMemoria } = require('../src/memoria');
  const memoria = crearMemoria(db);
  const vistos = [];
  const ia = {
    activa: true,
    extraer: async ({ historial, citas }) => { vistos.push({ n: historial.length, citas }); return {}; },
    redactar: async () => null,
  };
  const libre = crearConversacionLibre(agenda, { ia, memoria, reloj });
  // Primera conversación: agenda y termina.
  const [listo] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123, el jueves a las 10:30']);
  assert.equal(listo.estado, 'listo');
  // Conversación nueva (sin estado guardado): igual ve lo de antes y la cita que ya tiene.
  await charla(libre, ['hola, otra pregunta']);
  assert.equal(vistos[1].n, 2);
  assert.match(vistos[1].citas[0], /jueves 8 de octubre/);
  assert.deepEqual(memoria.ultimos('55').map((m) => m.rol), ['cliente', 'taller', 'cliente', 'taller']);
});

test('no repite el mismo mensaje: si iba a decir lo mismo otra vez, pasa a asesor', async () => {
  agenda.bloquear({ fecha: '2026-10-08', motivo: 'Lleno' });
  const libre = crearConversacionLibre(agenda, { reloj });
  const [primero, otraVez, tercera] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123, el jueves a las 9:30', 'el jueves entonces', 'el jueves porfa']);
  assert.equal(primero.estado, 'esperar');
  assert.match(textos(primero).join(' '), /^El jueves 8 ya no tenemos cupos disponibles\./);
  assert.doesNotMatch(textos(primero).join(' '), /😕|qué pena|\bUy\b|Juan/);
  // La segunda vez no dice lo mismo: avisa que sigue lleno y que siguen esos días.
  assert.match(textos(otraVez).join(' '), /^El jueves 8 tampoco tenemos cupos disponibles\. Seguimos teniendo/);
  // Si ya no hay nada nuevo que decir, no insiste: pasa a asesor.
  assert.equal(tercera.estado, 'asesor');
  assert.equal(tercera.data.motivo, 'repetido');
});

test('simulación de casos raros: fechas con mes, placa correcta, otros servicios, "sí" y celular en el nombre', async () => {
  const una = async (mensajes) => charla(crearConversacionLibre(crearAgenda(abrir(':memory:'), { ...cfg, intervaloMinutos: 30 }, reloj), { reloj }), mensajes);
  // "20 de diciembre" NO es el 20 de este mes: está fuera del plazo y así se dice.
  const [lejos] = await una(['Ana Ruiz, Renault Logan 2017, LKJ321, el 20 de diciembre a las 10']);
  assert.equal(lejos.estado, 'esperar');
  assert.match(textos(lejos)[0], /20 de diciembre todavía no tiene agenda abierta/);
  // Una fecha que ya pasó se dice que ya pasó.
  const [pasada] = await una(['Ana Ruiz, Renault Logan 2017, LKJ321, el 2 de octubre a las 10']);
  assert.match(textos(pasada)[0], /ya pasó/);
  // La placa es la que va después de "placa", no el modelo de la moto.
  const [moto] = await una(['Carlos, moto AKT 125, placa ABC12D, el viernes a las 11']);
  assert.equal(moto.siguiente.datos.placa, 'ABC12D');
  // Otro servicio, repuestos o varios carros: asesor.
  assert.equal((await una(['cuánto vale el cambio de aceite?']))[0].data.motivo, 'otro_servicio');
  assert.equal((await una(['tienen pastillas de freno para un duster?']))[0].data.motivo, 'otro_servicio');
  assert.equal((await una(['quiero agendar dos carros el viernes a las 9']))[0].data.motivo, 'varios_vehiculos');
  assert.equal((await una(['quiero hablar con alguien']))[0].data.motivo, 'pidio_asesor');
  // "Sí" cuando se ofrecieron varios días: pregunta cuál.
  const [, si] = await una(['Laura, Mazda 2 2020, PLM456, el domingo a las 10', 'sí']);
  assert.equal(si.estado, 'esperar');
  assert.match(textos(si)[0], /^¿Cuál día te sirve: el /);
  // El celular dentro del mensaje no impide reconocer el nombre.
  const [marta] = await una(['Marta 3105551234, Ford Fiesta 2014, MNB987, el jueves a las 2']);
  assert.equal(marta.estado, 'listo');
  assert.equal(marta.cita.cliente, 'Marta');
  // Fuera del horario de citas se dice el horario.
  const [tarde] = await una(['Ana Ruiz, Renault Logan 2017, LKJ321, el viernes a las 6 pm']);
  assert.match(textos(tarde)[0], /^Las citas son de 8:30 a\. m\. a 3:30 p\. m\./);
});

test('con IA: si el mensaje es raro o fuera de lugar y no trae datos, corta y pasa a asesor; si trae datos, sigue', async () => {
  const ia = (extra) => ({ activa: true, extraer: async () => extra, redactar: async () => null });
  // Fuera de lugar sin datos: corta.
  const [raro] = await charla(crearConversacionLibre(agenda, { ia: ia({ fuera_de_lugar: true }), reloj }), ['mi perro se comió el control jajaja']);
  assert.equal(raro.estado, 'asesor');
  assert.equal(raro.data.motivo, 'fuera_de_lugar');
  // La IA dice "raro" pero el mensaje trae datos de la cita: se sigue agendando (no se pierde un cliente).
  const [conDatos] = await charla(crearConversacionLibre(agenda, { ia: ia({ fuera_de_lugar: true }), reloj }), ['Juan Pérez, Mazda 3 2018, ABC123, el jueves a las 10:30']);
  assert.equal(conDatos.estado, 'listo');
  // Pregunta normal (dirección): no se corta.
  const [donde] = await charla(crearConversacionLibre(agenda, { ia: ia({ fuera_de_lugar: true }), reloj }), ['¿dónde quedan?']);
  assert.equal(donde.estado, 'esperar');
});

test('al cortar no se le escribe nada al cliente: termina el bot, pasa el lead a LLAMAR y deja nota', async () => {
  const enviados = [];
  const movidos = [];
  const notas = [];
  const kommo = {
    contactoDelLead: async () => ({ telefono: '3001112233' }),
    continuar: async (u, c) => enviados.push(c),
    nota: async (lead, texto) => notas.push(texto),
    moverLead: async (lead, etapa) => movidos.push([lead, etapa]),
  };
  const atender = crearAtencion({ bot: crearBot(agenda, { reloj }), conversaciones: crearConversaciones(db), kommo, libre: crearConversacionLibre(agenda, { reloj }) });
  const log = console.log;
  console.log = () => {};
  try {
    await atender({ data: { lead: '77', inicio: 'no', mensaje: 'jajaja' }, return_url: 'x' });
  } finally {
    console.log = log;
  }
  assert.deepEqual(enviados[0].execute_handlers, [{ handler: 'goto', params: { type: 'finish', step: 0 } }]);
  assert.deepEqual(movidos, [['77', 105739403]]);
  assert.match(notas[0], /no respondió/);
});

test('sugiere la hora más temprana y un "sí" la acepta', async () => {
  const libre = crearConversacionLibre(crearAgenda(db, { ...cfg, intervaloMinutos: 30 }, reloj), { reloj });
  const [pregunta, si] = await charla(libre, ['Juan Pérez, Mazda 3 2018, ABC123, el jueves', 'sí']);
  assert.match(textos(pregunta).join(' '), /Te sugiero a las 8:30 a\. m\., que es lo más temprano/);
  assert.equal(si.estado, 'listo');
  assert.equal(si.cita.hora, '08:30');
});
