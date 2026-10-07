// Conversación de agendamiento por WhatsApp: día → hora → nombre → vehículo y placa → reserva.
// No envía nada por sí solo: devuelve qué mostrarle al cliente y en qué paso queda.
// Kommo solo acepta textos de máximo 80 caracteres en cada mensaje que manda la app,
// y WhatsApp corta los botones a 20 caracteres.
// Pensada para que cualquiera la entienda: textos con día y fecha completos, ejemplos en cada
// pregunta, acepta respuestas escritas a mano y, si no entiende 3 veces, pasa a un asesor.

const config = require('../config');
const { ErrorAgenda, normalizarTelefono } = require('./agenda');
const { ahora, sumarDias, diaSemana, fechaLarga, horaCorta, MESES } = require('./fechas');

const MAX_TEXTO = 80;
const MAX_BOTON = 20;
const DIAS_A_OFRECER = 6;
const MAX_INTENTOS = 3;
const OTRO_DIA = 'Ver otros días';
const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const NO_ES_NOMBRE = new Set([
  'si', 'sii', 'siii', 'no', 'ok', 'okey', 'listo', 'dale', 'gracias', 'hola', 'buenas', 'bueno', 'claro',
  'vale', 'perfecto', 'aja', 'bien', 'buenos dias', 'buenas tardes', 'buenas noches', 'quiero agendar',
]);

// Minúsculas, sin tildes ni signos: "Mañana, miércoles 7" → "manana miercoles 7".
const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const largo = (s) => [...s].length;
function recortar(texto, max = MAX_TEXTO) {
  return largo(texto) <= max ? texto : `${[...texto].slice(0, max - 1).join('')}…`;
}
const mostrarTexto = (texto) => ({ handler: 'show', params: { type: 'text', value: recortar(texto) } });
const mostrarBotones = (texto, botones) => ({
  handler: 'show',
  params: { type: 'buttons', value: recortar(texto), buttons: botones.map((b) => recortar(b, MAX_BOTON)) },
});

const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "Hoy, martes 6" · "Mañana, miércoles 7" · "Jueves 8" · "Lunes 2 de noviembre" (si cambia el mes).
function etiquetaDia(fecha, hoy) {
  const [, m, d] = fecha.split('-').map(Number);
  const nombre = DIAS_LARGOS[diaSemana(fecha)];
  if (fecha === hoy) return `Hoy, ${nombre.toLowerCase()} ${d}`;
  if (fecha === sumarDias(hoy, 1)) return `Mañana, ${nombre.toLowerCase()} ${d}`;
  const base = `${nombre} ${d}`;
  if (m === Number(hoy.slice(5, 7))) return base;
  const conMes = `${base} de ${MESES[m - 1]}`;
  return largo(conMes) <= MAX_BOTON ? conMes : `${base} ${MESES_CORTOS[m - 1]}`;
}

function elegirDia(mensaje, dias, hoy) {
  const t = normalizar(mensaje);
  if (!t) return null;
  const exacto = dias.find((d) => normalizar(d.etiqueta) === t);
  if (exacto) return exacto;
  if (/\bpasado manana\b/.test(t)) return dias.find((d) => d.fecha === sumarDias(hoy, 2)) || null;
  if (/\bmanana\b/.test(t)) return dias.find((d) => d.fecha === sumarDias(hoy, 1)) || null;
  if (/\bhoy\b/.test(t)) return dias.find((d) => d.fecha === hoy) || null;
  const diaSem = NOMBRES_DIA.findIndex((n) => new RegExp(`\\b${n}\\b`).test(t));
  const numero = t.match(/\b([0-3]?\d)\b/);
  if (diaSem < 0 && !numero) return null;
  const porFecha = dias.find(
    (d) => (diaSem < 0 || diaSemana(d.fecha) === diaSem) && (!numero || Number(d.fecha.slice(8)) === Number(numero[1]))
  );
  if (porFecha) return porFecha;
  // Respondió solo con el número de la opción ("2" = segunda de la lista).
  if (diaSem < 0 && t === numero[1] && Number(t) >= 1 && Number(t) <= dias.length) return dias[Number(t) - 1];
  return null;
}

function elegirHora(mensaje, horas) {
  const t = normalizar(mensaje);
  const exacta = horas.find((h) => normalizar(horaCorta(h)) === t);
  if (exacta) return exacta;
  const m = t.match(/\b(\d{1,2})(?:[: ]?(\d{2}))?\s*(a m|am|p m|pm|de la tarde|de la manana)?\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? null : Number(m[2]);
  const tarde = m[3] && (m[3].startsWith('p') || m[3] === 'de la tarde');
  if (tarde && h < 12) h += 12;
  if (!m[3] && h >= 1 && h <= 6) h += 12; // "a las 2" → 2 p. m.
  return (
    horas.find((x) => {
      const [hh, mm] = x.split(':').map(Number);
      return hh === h && (min === null || mm === min);
    }) || null
  );
}

// Placas de Colombia: carro ABC123, moto ABC12D.
function separarPlaca(texto) {
  const m = String(texto || '').match(/\b([A-Za-z]{3})[\s-]?(\d{3}|\d{2}[A-Za-z])\b/);
  if (!m) return { placa: null, resto: String(texto || '').trim() };
  const resto = String(texto)
    .replace(m[0], ' ')
    .replace(/\b(la )?placa( es)?\b:?/i, ' ')
    .replace(/\s*[,;:.-]+\s*$/g, '')
    .replace(/^\s*[,;:.-]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { placa: `${m[1]}${m[2]}`.toUpperCase(), resto };
}

function limpiarNombre(texto) {
  const nombre = String(texto || '')
    .replace(/^\s*(hola[,!.\s]*)?(me llamo|mi nombre es|soy|a nombre de)\s+/i, '')
    .replace(/[.!]+$/, '')
    .trim();
  if (nombre.length < 2 || nombre.length > 60 || /\d{4,}|@|https?:/i.test(nombre)) return null;
  if (NO_ES_NOMBRE.has(normalizar(nombre))) return null;
  return nombre;
}

function telefonoValido(texto) {
  const t = normalizarTelefono(texto);
  return /^573\d{9}$/.test(t) ? t : null;
}

const quiereAsesor = (mensaje) => /\b(asesor|humano|persona|cancelar)\b/.test(normalizar(mensaje));
const quiereOtroDia = (mensaje) =>
  /\b(otro dia|otros dias|otra fecha|cambiar (el dia|la fecha|de dia|de fecha)|ver otros dias)\b/.test(normalizar(mensaje));

function crearBot(agenda, { reloj = () => new Date() } = {}) {
  const esperar = (estado, handlers) => ({
    estado: 'esperar',
    siguiente: estado,
    handlers,
    data: { estado: 'esperar', paso: estado.paso },
  });
  const asesor = (texto, motivo) => ({
    estado: 'asesor',
    siguiente: null,
    handlers: [mostrarTexto(texto)],
    data: { estado: 'asesor', motivo },
  });

  // Cada vez que no entiende suma un intento; a la tercera pasa a un asesor.
  function noEntendi(s, repetir) {
    const fallos = (s.fallos || 0) + 1;
    if (fallos >= MAX_INTENTOS) {
      return asesor('No logré entenderte 🙈 Un asesor te escribe para ayudarte 🙌', 'no_entendio');
    }
    return repetir({ ...s, fallos });
  }
  const avanzar = (s) => ({ ...s, fallos: 0 });

  function ofrecerDias(s, aviso) {
    const hoy = ahora(reloj()).fecha;
    const dias = agenda.diasConCupo(DIAS_A_OFRECER).map(({ fecha }) => ({ fecha, etiqueta: etiquetaDia(fecha, hoy) }));
    if (!dias.length) {
      return asesor('No tengo cupos libres en los próximos días. Un asesor te escribe 🙌', 'sin_cupos');
    }
    const servicio = config.servicios[s.servicio].corto.toLowerCase();
    const texto = aviso || `¿Qué día te queda bien para la ${servicio}? Toca el botón y elige un día 👇`;
    return esperar({ ...s, paso: 'dia', dias, fecha: null, hora: null }, [
      mostrarBotones(texto, dias.map((d) => d.etiqueta)),
    ]);
  }

  function ofrecerHoras(s, aviso) {
    const horas = agenda.horasLibres(s.fecha).map((h) => h.hora);
    if (!horas.length) return ofrecerDias(s, 'Ese día ya se llenó 😕 Toca el botón y elige otro día 👇');
    const texto = aviso || `Horas libres el ${fechaLarga(s.fecha)}. Toca el botón y elige una 👇`;
    return esperar({ ...s, paso: 'hora', horas }, [mostrarBotones(texto, [...horas.map(horaCorta), OTRO_DIA])]);
  }

  const pedirNombre = (s) => esperar({ ...s, paso: 'nombre' }, [mostrarTexto('¿A nombre de quién agendo la cita? Escríbeme tu nombre 😊')]);
  const pedirVehiculo = (s) =>
    esperar({ ...s, paso: 'vehiculo' }, [mostrarTexto('¿Qué vehículo es y cuál es la placa? Ej: Mazda 3 2018, ABC123')]);

  function pedirSiguienteDato(s) {
    if (!s.placa) {
      return esperar({ ...s, paso: 'placa' }, [mostrarTexto('¿Y la placa? Son 3 letras y 3 números. Ej: ABC123')]);
    }
    if (!s.vehiculo) {
      return esperar({ ...s, paso: 'modelo' }, [mostrarTexto('¿Qué marca y modelo es tu vehículo? Ej: Mazda 3 2018')]);
    }
    if (!s.telefono) {
      return esperar({ ...s, paso: 'telefono' }, [mostrarTexto('¿A qué celular te escribimos? Ej: 300 123 4567')]);
    }
    return reservar(s);
  }

  function reservar(s) {
    try {
      const cita = agenda.reservar(
        {
          servicio: s.servicio,
          fecha: s.fecha,
          hora: s.hora,
          cliente: s.nombre,
          telefono: s.telefono,
          vehiculo: s.vehiculo,
          placa: s.placa,
          kommoLead: s.lead,
        },
        { origen: 'BOT' }
      );
      const servicio = config.servicios[cita.servicio];
      const primerNombre = cita.cliente.split(/\s+/)[0].slice(0, 20);
      return {
        estado: 'listo',
        siguiente: null,
        cita,
        handlers: [
          mostrarTexto(`✅ ¡Listo, ${primerNombre}! Agendé tu ${servicio.nombre}.`),
          mostrarTexto(`📅 ${mayuscula(fechaLarga(cita.fecha))} a las ${horaCorta(cita.hora)}`),
          mostrarTexto(`📍 ${config.direccion}. ¡Te esperamos! 🙌`),
        ],
        data: {
          estado: 'listo',
          cita: String(cita.id),
          nombre: cita.cliente,
          servicio: servicio.nombre,
          fecha: fechaLarga(cita.fecha),
          hora: horaCorta(cita.hora),
          vehiculo: cita.vehiculo || '',
          placa: cita.placa || '',
        },
      };
    } catch (err) {
      if (!(err instanceof ErrorAgenda)) throw err;
      if (err.codigo === 'DATOS' && /tel[eé]fono/i.test(err.message)) {
        return esperar({ ...s, telefono: null, paso: 'telefono' }, [
          mostrarTexto('Ese número no me sirve 🙈 Escríbeme tu celular, ej: 300 123 4567'),
        ]);
      }
      if (['LLENO', 'CERRADO', 'FUERA_DE_PLAZO'].includes(err.codigo)) {
        return ofrecerHoras({ ...s, hora: null }, 'Esa hora se acaba de ocupar 😕 Toca el botón y elige otra 👇');
      }
      return asesor('Tuve un problema agendando. Un asesor te escribe 🙌', err.codigo);
    }
  }

  // estado: lo guardado de la conversación (o null); inicio: true si el cliente acaba de entrar al paso.
  function responder({ estado, mensaje, inicio, servicio, contacto = {}, lead }) {
    if (inicio || !estado) {
      const s = {
        lead: lead ? String(lead) : null,
        servicio: config.servicios[String(servicio || '').toUpperCase()] ? String(servicio).toUpperCase() : 'REVISION',
        telefono: telefonoValido(contacto.telefono),
        nombreKommo: contacto.nombre || null,
        // Kommo puede entregar el mensaje que arrancó el paso (p. ej. "Quiero agendar") como si fuera
        // la primera respuesta del cliente. Se recuerda para ignorarlo esa única vez.
        mensajeInicial: String(mensaje || ''),
      };
      return ofrecerDias(s);
    }

    let s = estado;
    if ('mensajeInicial' in s) {
      const { mensajeInicial, ...resto } = s;
      s = resto;
      if (mensajeInicial && normalizar(mensaje) === normalizar(mensajeInicial)) {
        return { estado: 'esperar', siguiente: s, handlers: [], data: { estado: 'esperar', paso: s.paso } };
      }
    }
    if (quiereAsesor(mensaje)) return asesor('Listo, le aviso a un asesor para que te escriba 🙌', 'pidio_asesor');
    if (s.paso !== 'dia' && quiereOtroDia(mensaje)) return ofrecerDias(avanzar(s));

    switch (s.paso) {
      case 'dia': {
        const dia = elegirDia(mensaje, s.dias, ahora(reloj()).fecha);
        if (!dia) {
          return noEntendi(s, (x) => ofrecerDias(x, 'No te entendí 🙈 Toca el botón de abajo y elige un día de la lista 👇'));
        }
        return ofrecerHoras(avanzar({ ...s, fecha: dia.fecha }));
      }
      case 'hora': {
        const hora = elegirHora(mensaje, s.horas);
        if (!hora) {
          return noEntendi(s, (x) => ofrecerHoras(x, 'No te entendí 🙈 Toca el botón de abajo y elige una hora 👇'));
        }
        return pedirNombre(avanzar({ ...s, hora }));
      }
      case 'nombre': {
        const nombre = limpiarNombre(mensaje);
        if (!nombre) {
          return noEntendi(s, (x) => esperar(x, [mostrarTexto('Escríbeme solo tu nombre, por favor. Ej: Juan Pérez')]));
        }
        return pedirVehiculo(avanzar({ ...s, nombre }));
      }
      case 'vehiculo': {
        const { placa, resto } = separarPlaca(mensaje);
        const vehiculo = normalizar(resto) && !NO_ES_NOMBRE.has(normalizar(resto)) ? resto.slice(0, 120) : null;
        if (!placa && !vehiculo) {
          return noEntendi(s, (x) => esperar(x, [mostrarTexto('Escríbeme el vehículo y la placa. Ej: Mazda 3 2018, ABC123')]));
        }
        return pedirSiguienteDato(avanzar({ ...s, vehiculo, placa }));
      }
      case 'placa': {
        const { placa } = separarPlaca(mensaje);
        const suelta = normalizar(mensaje).replace(/[^a-z0-9]/g, '').toUpperCase();
        const valida = placa || (suelta.length >= 5 && suelta.length <= 7 && /[A-Z]/.test(suelta) && /\d/.test(suelta) ? suelta : null);
        if (!valida) {
          return noEntendi(s, (x) => esperar(x, [mostrarTexto('Escríbeme la placa: 3 letras y 3 números. Ej: ABC123')]));
        }
        return pedirSiguienteDato(avanzar({ ...s, placa: valida }));
      }
      case 'modelo': {
        const { resto } = separarPlaca(mensaje);
        if (!normalizar(resto) || NO_ES_NOMBRE.has(normalizar(resto))) {
          return noEntendi(s, (x) => esperar(x, [mostrarTexto('Escríbeme la marca y el modelo. Ej: Mazda 3 2018')]));
        }
        return pedirSiguienteDato(avanzar({ ...s, vehiculo: resto.slice(0, 120) }));
      }
      case 'telefono': {
        const telefono = telefonoValido(mensaje);
        if (!telefono) {
          return noEntendi(s, (x) => esperar(x, [mostrarTexto('Escríbeme el celular con sus 10 dígitos. Ej: 300 123 4567')]));
        }
        return reservar(avanzar({ ...s, telefono }));
      }
      default:
        return ofrecerDias(avanzar(s));
    }
  }

  return { responder };
}

module.exports = { crearBot, elegirDia, elegirHora, etiquetaDia, separarPlaca, limpiarNombre, MAX_TEXTO };
