// Agendamiento por texto libre: el cliente escribe sus datos como quiera ("soy Juan, Spark 2015
// ABC123, el jueves a las 10") y la app junta lo que falta, revisa la agenda, confirma y guarda.
// La IA (si está configurada) solo ayuda a leer el mensaje; las reglas de abajo funcionan sin ella.

const config = require('../config');
const { ErrorAgenda } = require('./agenda');
const { ahora, sumarDias, diaSemana, diasEntre, fechaLarga, horaCorta, aMinutos, deMinutos, esFecha, esHora } = require('./fechas');
const {
  etiquetaDia,
  listaHoras,
  separarPlaca,
  limpiarNombre,
  telefonoValido,
  normalizar,
  quiereAsesor,
  NO_ES_NOMBRE,
  MAX_TEXTO,
} = require('./bot');

const DIAS_EN_VENTANA = 31;
const MAX_SIN_AVANCE = 3;
const CAMPOS = ['nombre', 'vehiculo', 'placa', 'fecha', 'hora', 'telefono'];
const NOMBRE_CAMPO = {
  nombre: 'tu nombre',
  vehiculo: 'el vehículo (marca, modelo y año)',
  placa: 'la placa',
  fecha: 'el día',
  hora: 'la hora',
  telefono: 'tu celular',
};
const PREGUNTA = {
  nombre: '¿A nombre de quién agendo la cita?',
  vehiculo: '¿Qué vehículo es? Ej: Mazda 3 2018',
  placa: '¿Cuál es la placa? Ej: ABC123',
  telefono: '¿A qué celular te escribimos? Ej: 300 123 4567',
};
const DIAS_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Parte un texto en mensajes de máximo 80 caracteres (límite de Kommo), sin cortar palabras.
function partir(texto) {
  const partes = [];
  for (const linea of String(texto).split('\n')) {
    let actual = '';
    for (const palabra of linea.split(' ')) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if ([...prueba].length > MAX_TEXTO && actual) {
        partes.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    if (actual) partes.push(actual);
  }
  return partes;
}

// "lunes a sábado, de 8:30 a. m. a 3:30 p. m." (según config.horario)
function horarioCitas() {
  const dias = Object.keys(config.horario).map(Number).sort();
  const h = config.horario[dias[0]];
  const rango = dias.length > 1 ? `${DIAS_NOMBRE[dias[0]]} a ${DIAS_NOMBRE[dias[dias.length - 1]]}` : DIAS_NOMBRE[dias[0]];
  return `${rango}, de ${horaCorta(h.desde)} a ${horaCorta(h.hasta)}`;
}

const lista = (cosas) => (cosas.length <= 1 ? cosas.join('') : `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`);

const NOMBRES_DIA_SIN_TILDE = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MESES_SIN_TILDE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Quita placas y años para que sus números no se confundan con días u horas.
const sinPlacaNiAnio = (t) =>
  t.replace(/\b(?!las\b|los\b|del\b)[a-z]{3} ?(\d{3}|\d{2}[a-z])\b/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');

// Día escrito: "hoy", "mañana", "pasado mañana", "el jueves", "jueves 15", "el 14", "14 de octubre".
function fechaEscrita(t, hoy, soloNumero = false) {
  const limpio = sinPlacaNiAnio(t).replace(/\b(de|en|por) la manana\b/g, ' ');
  if (/\bpasado manana\b/.test(limpio)) return sumarDias(hoy, 2);
  if (/\bmanana\b/.test(limpio)) return sumarDias(hoy, 1);
  if (/\bhoy\b/.test(limpio)) return hoy;
  const dia = limpio.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  const num =
    limpio.match(/\bel (?:dia )?(\d{1,2})\b(?!:)/) ||
    limpio.match(new RegExp(`\\b(\\d{1,2}) de (${MESES_SIN_TILDE.join('|')})\\b`)) ||
    (dia && limpio.match(new RegExp(`\\b${dia[1]} (\\d{1,2})\\b(?!:)`))) ||
    (soloNumero && limpio.match(/^(\d{1,2})$/));
  if (!dia && !num) return null;
  for (let i = 0; i <= DIAS_EN_VENTANA; i++) {
    const fecha = sumarDias(hoy, i);
    if (dia && NOMBRES_DIA_SIN_TILDE[diaSemana(fecha)] !== dia[1]) continue;
    if (num && Number(fecha.slice(8)) !== Number(num[1])) continue;
    return fecha;
  }
  return null;
}

// Hora escrita: "10:30", "a las 2", "a las 9 y media", "3 pm", "2 de la tarde". Sin a. m./p. m., de 1 a 6 es tarde.
function horaEscrita(t, soloNumero = false) {
  const limpio = sinPlacaNiAnio(t);
  const sufijo = '(?:\\s*(a m|am|p m|pm|de la manana|de la tarde))?';
  const m =
    limpio.match(new RegExp(`\\b(\\d{1,2}):(\\d{2})\\b${sufijo}`)) ||
    limpio.match(new RegExp(`\\ba las (\\d{1,2})(?: y (media|30))?\\b${sufijo}`)) ||
    limpio.match(/\b(\d{1,2})()\s*(a m|am|p m|pm|de la tarde)\b/) ||
    (soloNumero && limpio.match(new RegExp(`^(\\d{1,2})(?: y (media|30))?${sufijo}$`)));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === 'media' ? 30 : Number(m[2] || 0);
  const suf = m[3] || '';
  if (h > 23 || min > 59) return null;
  if ((suf.startsWith('p') || suf === 'de la tarde') && h < 12) h += 12;
  if (!suf && h >= 1 && h <= 6) h += 12;
  return deMinutos(h * 60 + min);
}

// Reglas sin IA: placa, día y hora cuando el texto los menciona claramente.
function extraerConReglas(texto, s, momento) {
  const t = normalizar(texto);
  const r = {};
  const { placa, resto } = separarPlaca(texto);
  if (placa) r.placa = placa;

  const fecha = fechaEscrita(t, momento.fecha, s.preguntando === 'fecha');
  if (fecha) r.fecha = fecha;
  const hora = horaEscrita(t, s.preguntando === 'hora');
  if (hora) r.hora = hora;

  if (/^(si|sii|siii|dale|listo|ok|okey|confirmo|confirmado|claro|de una|perfecto|correcto|esta bien|asi esta bien|si senor|si senora)\b/.test(t)) {
    r.confirma = true;
  } else if (/^(no|cambia|cambiar|mejor)\b/.test(t)) r.confirma = false;
  if (quiereAsesor(texto)) r.asesor = true;

  // Respuesta directa a lo que se le preguntó.
  if (s.preguntando === 'nombre' && !r.placa) {
    const nombre = limpiarNombre(texto);
    if (nombre) r.nombre = nombre;
  }
  if (s.preguntando === 'vehiculo') {
    const v = resto.replace(/\b(la )?placa( es)?\b:?/i, ' ').trim();
    if (normalizar(v) && !NO_ES_NOMBRE.has(normalizar(v))) r.vehiculo = v.slice(0, 120);
  }
  if (s.preguntando === 'placa' && !r.placa) {
    const suelta = t.replace(/[^a-z0-9]/g, '').toUpperCase();
    if (suelta.length >= 5 && suelta.length <= 7 && /[A-Z]/.test(suelta) && /\d/.test(suelta)) r.placa = suelta;
  }
  if (s.preguntando === 'telefono') {
    const tel = telefonoValido(texto);
    if (tel) r.telefono = tel;
  }
  return r;
}

// Limpia lo que devuelve la IA: solo pasa lo que tiene forma válida.
function limpiarIA(ia, momento) {
  if (!ia || typeof ia !== 'object') return {};
  const r = {};
  if (typeof ia.nombre === 'string') {
    const n = limpiarNombre(ia.nombre);
    if (n) r.nombre = n;
  }
  if (typeof ia.vehiculo === 'string' && ia.vehiculo.trim() && !NO_ES_NOMBRE.has(normalizar(ia.vehiculo))) {
    r.vehiculo = ia.vehiculo.trim().slice(0, 120);
  }
  if (typeof ia.placa === 'string') {
    const p = ia.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z]{3}\d{2}[A-Z0-9]$/.test(p)) r.placa = p;
  }
  if (esFecha(ia.fecha) && diasEntre(momento.fecha, ia.fecha) >= 0 && diasEntre(momento.fecha, ia.fecha) <= 90) r.fecha = ia.fecha;
  if (esHora(ia.hora)) r.hora = ia.hora;
  if (typeof ia.confirma === 'boolean') r.confirma = ia.confirma;
  if (ia.asesor === true) r.asesor = true;
  return r;
}

function crearConversacionLibre(agenda, { ia = null, reloj = () => new Date() } = {}) {
  const resultado = (estado, siguiente, textos, extra = {}) => {
    const mensajes = textos.flatMap(partir).map((value) => ({ handler: 'show', params: { type: 'text', value } }));
    return {
      estado,
      siguiente,
      acuse: estado === 'esperar' ? mensajes[0].params.value : undefined,
      handlers: estado === 'esperar' ? mensajes.slice(1).length ? mensajes.slice(1) : [mensajes[0]] : mensajes,
      data: { estado, paso: siguiente ? siguiente.preguntando || 'confirmar' : undefined, ...extra.data },
      ...extra,
    };
  };
  const esperar = (s, textos) => {
    // Si solo hay un mensaje, va completo como pregunta y el acuse es un emoji.
    const r = resultado('esperar', s, textos);
    if (textos.flatMap(partir).length === 1) r.acuse = '✍️';
    return r;
  };
  const asesor = (texto, motivo) => resultado('asesor', null, [texto], { data: { motivo } });

  // Horas libres de un día ordenadas por cercanía a la que pidió.
  const horasCercanas = (fecha, hora, cuantas = 3) =>
    agenda
      .horasLibres(fecha)
      .map((h) => h.hora)
      .sort((a, b) => Math.abs(aMinutos(a) - aMinutos(hora)) - Math.abs(aMinutos(b) - aMinutos(hora)) || a.localeCompare(b))
      .slice(0, cuantas)
      .sort();

  const diasConCupoTexto = (hoy, cuantos = 3) =>
    agenda
      .diasConCupo(cuantos)
      .map(({ fecha }) => etiquetaDia(fecha, hoy).replace(/^Hoy, /, 'hoy ').replace(/^Mañana, /, 'mañana ').toLowerCase());

  function resumen(s) {
    const d = s.datos;
    const servicio = config.servicios[s.servicio].nombre;
    return [
      'Te agendo así 👇',
      `🔧 ${servicio}`,
      `📅 ${mayuscula(fechaLarga(d.fecha))}, ${horaCorta(d.hora)}`,
      `🚗 ${d.vehiculo} · ${d.placa}`,
      `👤 ${d.nombre}`,
      '¿Confirmo la cita? Responde SÍ o dime qué cambio ✍️',
    ];
  }

  function guardar(s) {
    const d = s.datos;
    try {
      const cita = agenda.reservar(
        { servicio: s.servicio, fecha: d.fecha, hora: d.hora, cliente: d.nombre, telefono: d.telefono, vehiculo: d.vehiculo, placa: d.placa, kommoLead: s.lead },
        { origen: 'BOT' }
      );
      const servicio = config.servicios[cita.servicio];
      return resultado('listo', null, [
        `✅ ¡Listo, ${cita.cliente.split(/\s+/)[0]}! Agendé tu ${servicio.nombre}.`,
        `📅 ${mayuscula(fechaLarga(cita.fecha))} a las ${horaCorta(cita.hora)}`,
        `📍 ${config.direccion}. ¡Te esperamos! 🙌`,
      ], {
        cita,
        data: { cita: String(cita.id), nombre: cita.cliente, servicio: servicio.nombre, fecha: fechaLarga(cita.fecha), hora: horaCorta(cita.hora) },
      });
    } catch (err) {
      if (!(err instanceof ErrorAgenda)) throw err;
      if (['LLENO', 'CERRADO', 'FUERA_DE_PLAZO'].includes(err.codigo)) {
        const otras = horasCercanas(d.fecha, d.hora);
        const sig = { ...s, confirmando: false, preguntando: 'hora', datos: { ...d, hora: null } };
        if (!otras.length) return esperar({ ...sig, preguntando: 'fecha', datos: { ...sig.datos, fecha: null } }, ['Ese horario se acaba de ocupar 😕 ¿Qué otro día te sirve?']);
        return esperar(sig, ['Ese horario se acaba de ocupar 😕', `Tengo libre: ${listaHoras(otras)}. ¿Cuál prefieres?`]);
      }
      if (err.codigo === 'DATOS' && /tel[eé]fono/i.test(err.message)) {
        return esperar({ ...s, confirmando: false, preguntando: 'telefono', datos: { ...d, telefono: null } }, [PREGUNTA.telefono]);
      }
      return asesor('Tuve un problema agendando. Un asesor te escribe 🙌', err.codigo);
    }
  }

  // Revisa los datos y decide qué decir. "s" ya trae los datos combinados.
  function decidir(s, avance) {
    const momento = ahora(reloj());
    const d = { ...s.datos };
    const avisos = [];

    // El día pedido tiene que tener cupo.
    if (d.fecha && !agenda.horasLibres(d.fecha).length) {
      avisos.push(`El ${fechaLarga(d.fecha)} no tengo cupo 😕`);
      d.fecha = null;
      d.hora = null;
    }
    // La hora pedida tiene que estar libre ese día.
    if (d.fecha && d.hora && !agenda.horasLibres(d.fecha).some((h) => h.hora === d.hora)) {
      const otras = horasCercanas(d.fecha, d.hora);
      avisos.push(`A las ${horaCorta(d.hora)} no tengo cupo ese día 😕`);
      d.hora = null;
      const sig = { ...s, datos: d, preguntando: 'hora', confirmando: false, sinAvance: 0 };
      return esperar(sig, [...avisos, `Tengo libre: ${listaHoras(otras)}. ¿Cuál prefieres?`]);
    }

    const faltan = CAMPOS.filter((c) => !d[c]);
    if (faltan.length) {
      const sinAvance = avance ? 0 : (s.sinAvance || 0) + 1;
      if (sinAvance >= MAX_SIN_AVANCE) return asesor('No logré entenderte 🙈 Un asesor te escribe para ayudarte 🙌', 'no_entendio');
      const sig = { ...s, datos: d, preguntando: faltan[0], confirmando: false, sinAvance };
      const saludo = avance && d.nombre && !s.saludado ? `Gracias, ${d.nombre.split(/\s+/)[0]} 🙌` : avance ? 'Anotado ✍️' : 'No te entendí 🙈';
      if (d.nombre) sig.saludado = true;
      const textos = [...avisos, saludo];
      if (faltan.length > 2) {
        textos.push(`Para agendarte me falta: ${lista(faltan.map((c) => NOMBRE_CAMPO[c]))} ✍️`);
      } else if (faltan[0] === 'fecha') {
        textos.push(`¿Qué día te queda bien? Tengo cupo ${lista(diasConCupoTexto(momento.fecha))}.`);
        if (faltan.includes('hora')) textos.push(`Las citas son de ${horarioCitas()}.`);
      } else if (faltan[0] === 'hora') {
        const libres = agenda.horasLibres(d.fecha).map((h) => h.hora);
        textos.push(`¿A qué hora el ${fechaLarga(d.fecha)}?`, `Horas libres: ${listaHoras(libres)}`);
      } else {
        textos.push(PREGUNTA[faltan[0]]);
        if (faltan.length === 2) textos.push(`Y también ${NOMBRE_CAMPO[faltan[1]]}.`);
      }
      return esperar(sig, textos);
    }

    const sig = { ...s, datos: d, preguntando: null, confirmando: true, sinAvance: 0 };
    return esperar(sig, [...avisos, ...resumen(sig)]);
  }

  // estado: lo guardado (o null si es el primer mensaje con los datos).
  async function responder({ estado, mensaje, servicio, contacto = {}, lead }) {
    const momento = ahora(reloj());
    const s = estado && estado.modo === 'libre'
      ? { ...estado, datos: { ...estado.datos } }
      : {
          modo: 'libre',
          lead: lead ? String(lead) : null,
          servicio: config.servicios[String(servicio || '').toUpperCase()] ? String(servicio).toUpperCase() : 'REVISION',
          datos: { telefono: telefonoValido(contacto.telefono) },
          preguntando: null,
          confirmando: false,
          sinAvance: 0,
        };
    const texto = String(mensaje || '').trim();

    let deIA = {};
    if (ia && ia.activa && texto) {
      try {
        deIA = limpiarIA(
          await ia.extraer({
            mensaje: texto,
            conocido: Object.fromEntries(CAMPOS.map((c) => [c, s.datos[c] || null])),
            pregunta: s.ultimaPregunta || '',
            hoy: momento.fecha,
            hora: momento.hora,
            servicio: config.servicios[s.servicio].nombre,
          }),
          momento
        );
      } catch (err) {
        console.warn('IA: no pude leer el mensaje, sigo con reglas:', err.message);
      }
    }
    const deReglas = extraerConReglas(texto, s, momento);
    // La placa y la hora escritas claramente las detectan bien las reglas; el resto, mejor la IA.
    const nuevo = {
      nombre: deIA.nombre || deReglas.nombre,
      vehiculo: deIA.vehiculo || deReglas.vehiculo,
      placa: deReglas.placa || deIA.placa,
      fecha: deIA.fecha || deReglas.fecha,
      hora: deReglas.hora || deIA.hora,
      telefono: deReglas.telefono,
    };
    const confirma = deReglas.confirma ?? deIA.confirma;
    if (deReglas.asesor || deIA.asesor) return asesor('Listo, le aviso a un asesor para que te escriba 🙌', 'pidio_asesor');

    const antes = JSON.stringify(s.datos);
    for (const [campo, valor] of Object.entries(nuevo)) if (valor) s.datos[campo] = valor;
    const cambio = JSON.stringify(s.datos) !== antes;

    let r;
    if (s.confirmando && !cambio) {
      if (confirma === true) r = guardar(s);
      else if (confirma === false) {
        r = esperar({ ...s, confirmando: false, preguntando: null }, ['Claro 😊 ¿Qué quieres cambiar? Escríbeme el dato correcto.']);
      } else {
        const sinAvance = (s.sinAvance || 0) + 1;
        r = sinAvance >= MAX_SIN_AVANCE
          ? asesor('No logré entenderte 🙈 Un asesor te escribe para ayudarte 🙌', 'no_entendio')
          : esperar({ ...s, sinAvance }, ['¿Confirmo la cita? Responde SÍ o dime qué quieres cambiar ✍️']);
      }
    } else {
      r = decidir(s, cambio);
    }
    if (r.siguiente) r.siguiente.ultimaPregunta = r.handlers.map((h) => h.params.value).join(' ').slice(0, 300);
    return r;
  }

  return { responder };
}

module.exports = { crearConversacionLibre, extraerConReglas, fechaEscrita, horaEscrita, limpiarIA, partir, horarioCitas };
