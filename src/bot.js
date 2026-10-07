// Conversación de agendamiento por WhatsApp: día → hora → nombre → vehículo y placa → reserva.
// No envía nada por sí solo: devuelve qué mostrarle al cliente y en qué paso queda.
// Kommo solo acepta textos de máximo 80 caracteres en cada mensaje que manda la app,
// y WhatsApp corta los botones a 20 caracteres.
// Pensada para que cualquiera la entienda: textos con día y fecha completos, ejemplos en cada
// pregunta, acepta respuestas escritas a mano y, si no entiende 3 veces, pasa a un asesor.

const config = require('../config');
const { ErrorAgenda, normalizarTelefono } = require('./agenda');
const { ahora, sumarDias, diaSemana, diasEntre, fechaLarga, horaCorta, MESES } = require('./fechas');

const MAX_TEXTO = 80;
const MAX_BOTON = 20;
const MAX_INTENTOS = 3;
// WhatsApp muestra hasta 3 botones por mensaje: 2 sugerencias + "otra".
const DIAS_A_EVALUAR = 5; // de los próximos 5 días con cupo se sugieren los 2 con menos citas
const DIAS_EN_VENTANA = 31; // para reconocer un día escrito a mano
const OTRA_FECHA = 'Otra fecha';
const OTRA_HORA = 'Otra hora';
const OTRO_DIA = 'Otro día';
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
  return (
    dias.find(
      (d) => (diaSem < 0 || diaSemana(d.fecha) === diaSem) && (!numero || Number(d.fecha.slice(8)) === Number(numero[1]))
    ) || null
  );
}

// "8:30, 9:30, 10:30 am · 2:30, 3:30 pm"
function listaHoras(horas) {
  const am = horas.filter((h) => Number(h.slice(0, 2)) < 12).map((h) => h.replace(/^0/, ''));
  const pm = horas
    .filter((h) => Number(h.slice(0, 2)) >= 12)
    .map((h) => {
      const [hh, mm] = h.split(':').map(Number);
      return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')}`;
    });
  return [am.length ? `${am.join(', ')} am` : '', pm.length ? `${pm.join(', ')} pm` : ''].filter(Boolean).join(' · ');
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

  // Sugiere 2 días: los que tienen menos citas entre los próximos con cupo (o los más cercanos a "cercaDe").
  function ofrecerDias(s, aviso, cercaDe) {
    const hoy = ahora(reloj()).fecha;
    const disponibles = agenda.diasConCupo(DIAS_EN_VENTANA).map(({ fecha }) => ({ fecha, etiqueta: etiquetaDia(fecha, hoy) }));
    if (!disponibles.length) {
      return asesor('No tengo cupos libres en los próximos días. Un asesor te escribe 🙌', 'sin_cupos');
    }
    const sugeridos = cercaDe
      ? [...disponibles].sort(
          (a, b) => Math.abs(diasEntre(cercaDe, a.fecha)) - Math.abs(diasEntre(cercaDe, b.fecha)) || a.fecha.localeCompare(b.fecha)
        )
      : disponibles
          .slice(0, DIAS_A_EVALUAR)
          .map((d) => ({ ...d, citas: agenda.dia(d.fecha).totalCitas }))
          .sort((a, b) => a.citas - b.citas || a.fecha.localeCompare(b.fecha));
    const elegidos = sugeridos.slice(0, 2).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const botones = elegidos.map((d) => d.etiqueta);
    if (disponibles.length > elegidos.length) botones.push(OTRA_FECHA);
    const servicio = config.servicios[s.servicio].corto.toLowerCase();
    const texto = aviso || `¿Qué día te queda bien para la ${servicio}? Toca una opción 👇`;
    return esperar(
      { ...s, paso: 'dia', dias: disponibles, sugeridos: elegidos.map((d) => d.fecha), fecha: null, hora: null },
      [mostrarBotones(texto, botones)]
    );
  }

  const pedirDiaEscrito = (s, aviso) =>
    esperar({ ...s, paso: 'dia_escrito' }, [mostrarTexto(aviso || 'Escríbeme qué día te queda bien. Ej: viernes 16 o el 20')]);

  // Sugiere 2 horas: las que tienen más cupo libre (a igual cupo, las más temprano).
  function ofrecerHoras(s, aviso) {
    const libres = agenda.horasLibres(s.fecha);
    if (!libres.length) return ofrecerDias(s, 'Ese día ya se llenó 😕 Toca otra opción 👇');
    const elegidas = [...libres]
      .sort((a, b) => b.libres - a.libres || a.hora.localeCompare(b.hora))
      .slice(0, 2)
      .map((h) => h.hora)
      .sort();
    const botones = [...elegidas.map(horaCorta), libres.length > elegidas.length ? OTRA_HORA : OTRO_DIA];
    const texto = aviso || `¿A qué hora el ${fechaLarga(s.fecha)}? Toca una opción 👇`;
    return esperar({ ...s, paso: 'hora', horas: libres.map((h) => h.hora) }, [mostrarBotones(texto, botones)]);
  }

  const pedirHoraEscrita = (s, aviso) =>
    esperar({ ...s, paso: 'hora_escrita' }, [
      mostrarTexto(aviso || 'Escríbeme la hora que prefieres. Ej: 10:30 👇'),
      mostrarTexto(`Horas libres: ${listaHoras(s.horas)}`),
    ]);

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
        return ofrecerHoras({ ...s, hora: null }, 'Esa hora se acaba de ocupar 😕 Toca otra opción 👇');
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
    if (!['dia', 'dia_escrito'].includes(s.paso) && quiereOtroDia(mensaje)) return ofrecerDias(avanzar(s));

    switch (s.paso) {
      case 'dia': {
        const t = normalizar(mensaje);
        if (t.startsWith(normalizar(OTRA_FECHA)) || quiereOtroDia(mensaje)) return pedirDiaEscrito(avanzar(s));
        // Respondió con el número de la opción ("2" = segundo botón), si no es un día del mes de la lista.
        if (/^[1-3]$/.test(t) && !s.dias.some((d) => Number(d.fecha.slice(8)) === Number(t))) {
          const fecha = (s.sugeridos || [])[Number(t) - 1];
          if (fecha) return ofrecerHoras(avanzar({ ...s, fecha }));
          return pedirDiaEscrito(avanzar(s));
        }
        // Acepta el botón o cualquier día con cupo escrito a mano ("el jueves", "mañana", "el 14").
        const dia = elegirDia(mensaje, s.dias, ahora(reloj()).fecha);
        if (!dia) return noEntendi(s, (x) => ofrecerDias(x, 'No te entendí 🙈 Toca una de las opciones 👇'));
        return ofrecerHoras(avanzar({ ...s, fecha: dia.fecha }));
      }
      case 'dia_escrito': {
        const hoy = ahora(reloj()).fecha;
        const dia = elegirDia(mensaje, s.dias, hoy);
        if (dia) return ofrecerHoras(avanzar({ ...s, fecha: dia.fecha }));
        // ¿Pidió un día que existe pero no tiene cupo (domingo, festivo, lleno, muy lejos)? Ofrece los más cercanos.
        const calendario = Array.from({ length: DIAS_EN_VENTANA + 1 }, (_, i) => {
          const fecha = sumarDias(hoy, i);
          return { fecha, etiqueta: etiquetaDia(fecha, hoy) };
        });
        const pedido = elegirDia(mensaje, calendario, hoy);
        if (pedido) return ofrecerDias(avanzar(s), 'Ese día no tengo cupo 😕 Te propongo estos. Toca una opción 👇', pedido.fecha);
        return noEntendi(s, (x) => pedirDiaEscrito(x, 'No te entendí 🙈 Escríbeme el día. Ej: viernes 16 o el 20'));
      }
      case 'hora': {
        if (normalizar(mensaje).startsWith(normalizar(OTRA_HORA))) return pedirHoraEscrita(avanzar(s));
        // Acepta el botón o cualquier hora libre escrita a mano ("10:30", "a las 2").
        const hora = elegirHora(mensaje, s.horas);
        if (!hora) return noEntendi(s, (x) => ofrecerHoras(x, 'No te entendí 🙈 Toca una de las opciones 👇'));
        return pedirNombre(avanzar({ ...s, hora }));
      }
      case 'hora_escrita': {
        const hora = elegirHora(mensaje, s.horas);
        if (!hora) return noEntendi(s, (x) => pedirHoraEscrita(x, 'No te entendí 🙈 Escríbeme la hora. Ej: 10:30 👇'));
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

module.exports = { crearBot, elegirDia, elegirHora, etiquetaDia, listaHoras, separarPlaca, limpiarNombre, MAX_TEXTO };
