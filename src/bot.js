// Conversación de agendamiento por WhatsApp: día → hora → nombre → vehículo y placa → reserva.
// No envía nada por sí solo: devuelve qué mostrarle al cliente y en qué paso queda.
// Kommo solo acepta textos de máximo 80 caracteres en cada mensaje que manda la app.

const config = require('../config');
const { ErrorAgenda, normalizarTelefono } = require('./agenda');
const { ahora, sumarDias, diaSemana, fechaLarga, horaCorta } = require('./fechas');

const MAX_TEXTO = 80;
const DIAS_A_OFRECER = 6;
const OTRO_DIA = 'Otro día';
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

// Minúsculas, sin tildes ni signos: "Mañana · Mié 7 oct" → "manana mie 7 oct".
const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function recortar(texto) {
  const letras = [...texto];
  return letras.length <= MAX_TEXTO ? texto : `${letras.slice(0, MAX_TEXTO - 1).join('')}…`;
}
const mostrarTexto = (texto) => ({ handler: 'show', params: { type: 'text', value: recortar(texto) } });
const mostrarBotones = (texto, botones) => ({
  handler: 'show',
  params: { type: 'buttons', value: recortar(texto), buttons: botones },
});

const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function etiquetaDia(fecha, hoy) {
  const [, m, d] = fecha.split('-').map(Number);
  const base = `${DIAS_CORTOS[diaSemana(fecha)]} ${d} ${MESES_CORTOS[m - 1]}`;
  if (fecha === hoy) return `Hoy · ${base}`;
  if (fecha === sumarDias(hoy, 1)) return `Mañana · ${base}`;
  return base;
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
      (d) =>
        (diaSem < 0 || diaSemana(d.fecha) === diaSem) && (!numero || Number(d.fecha.slice(8)) === Number(numero[1]))
    ) || null
  );
}

function elegirHora(mensaje, horas) {
  const t = normalizar(mensaje);
  const exacta = horas.find((h) => normalizar(horaCorta(h)) === t);
  if (exacta) return exacta;
  const m = t.match(/\b(\d{1,2})(?:[: ]?(\d{2}))?\s*(a m|am|p m|pm)?\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? null : Number(m[2]);
  if (m[3] && m[3].startsWith('p') && h < 12) h += 12;
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
    .replace(/\bplaca\b:?/i, ' ')
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
  if (nombre.length < 2 || nombre.length > 60 || /\d{4,}/.test(nombre)) return null;
  return nombre;
}

function telefonoValido(texto) {
  const t = normalizarTelefono(texto);
  return /^573\d{9}$/.test(t) ? t : null;
}

const quiereAsesor = (mensaje) => /\b(asesor|humano|persona|cancelar)\b/.test(normalizar(mensaje));

function crearBot(agenda, { reloj = () => new Date() } = {}) {
  const esperar = (estado, handlers) => ({ estado: 'esperar', siguiente: estado, handlers, data: { estado: 'esperar', paso: estado.paso } });
  const asesor = (texto, motivo) => ({
    estado: 'asesor',
    siguiente: null,
    handlers: [mostrarTexto(texto)],
    data: { estado: 'asesor', motivo },
  });

  function ofrecerDias(s, aviso) {
    const hoy = ahora(reloj()).fecha;
    const dias = agenda.diasConCupo(DIAS_A_OFRECER).map(({ fecha }) => ({ fecha, etiqueta: etiquetaDia(fecha, hoy) }));
    if (!dias.length) {
      return asesor('No tengo cupos libres en los próximos días. Un asesor te escribe 🙌', 'sin_cupos');
    }
    const servicio = config.servicios[s.servicio].corto.toLowerCase();
    const texto = aviso || `¿Qué día te queda bien para la ${servicio}? 👇`;
    return esperar(
      { ...s, paso: 'dia', dias },
      [mostrarBotones(texto, dias.map((d) => d.etiqueta))]
    );
  }

  function ofrecerHoras(s, aviso) {
    const horas = agenda.horasLibres(s.fecha).map((h) => h.hora);
    if (!horas.length) return ofrecerDias(s, 'Ese día ya no tiene cupos 😕 Elige otro 👇');
    const texto = aviso || `Horas libres el ${fechaLarga(s.fecha)} 👇`;
    return esperar({ ...s, paso: 'hora', horas }, [mostrarBotones(texto, [...horas.map(horaCorta), OTRO_DIA])]);
  }

  function pedirSiguienteDato(s) {
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
        return ofrecerHoras({ ...s, hora: null }, 'Esa hora se acaba de ocupar 😕 Elige otra 👇');
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
      };
      return ofrecerDias(s);
    }

    const s = estado;
    if (quiereAsesor(mensaje)) return asesor('Listo, le aviso a un asesor para que te escriba 🙌', 'pidio_asesor');

    switch (s.paso) {
      case 'dia': {
        const hoy = ahora(reloj()).fecha;
        const dia = elegirDia(mensaje, s.dias, hoy);
        if (!dia) return ofrecerDias(s, 'No te entendí 🙈 Elige un día de la lista 👇');
        return ofrecerHoras({ ...s, fecha: dia.fecha });
      }
      case 'hora': {
        if (normalizar(mensaje).startsWith(normalizar(OTRO_DIA))) return ofrecerDias({ ...s, fecha: null });
        const hora = elegirHora(mensaje, s.horas);
        if (!hora) return ofrecerHoras(s, 'No te entendí 🙈 Elige una hora de la lista 👇');
        return esperar({ ...s, hora, paso: 'nombre' }, [mostrarTexto('¿A nombre de quién agendo la cita?')]);
      }
      case 'nombre': {
        const nombre = limpiarNombre(mensaje);
        if (!nombre) return esperar(s, [mostrarTexto('¿Me escribes tu nombre, por favor?')]);
        return esperar({ ...s, nombre, paso: 'vehiculo' }, [
          mostrarTexto('¿Qué vehículo es y cuál es la placa? Ej: Mazda 3 2018, ABC123'),
        ]);
      }
      case 'vehiculo': {
        const { placa, resto } = separarPlaca(mensaje);
        if (!placa) {
          return esperar({ ...s, vehiculo: resto.slice(0, 120) || null, paso: 'placa' }, [
            mostrarTexto('¿Y la placa? Ej: ABC123'),
          ]);
        }
        return pedirSiguienteDato({ ...s, vehiculo: resto.slice(0, 120) || null, placa });
      }
      case 'placa': {
        const { placa } = separarPlaca(mensaje);
        const suelta = normalizar(mensaje).replace(/[^a-z0-9]/g, '').toUpperCase();
        const valida = placa || (suelta.length >= 5 && suelta.length <= 7 ? suelta : null);
        if (!valida) return esperar(s, [mostrarTexto('¿Me confirmas la placa? Son 3 letras y 3 números, ej: ABC123')]);
        return pedirSiguienteDato({ ...s, placa: valida });
      }
      case 'telefono': {
        const telefono = telefonoValido(mensaje);
        if (!telefono) return esperar(s, [mostrarTexto('Escríbeme el celular con sus 10 dígitos, ej: 300 123 4567')]);
        return reservar({ ...s, telefono });
      }
      default:
        return ofrecerDias({ ...s, paso: null });
    }
  }

  return { responder };
}

module.exports = { crearBot, elegirDia, elegirHora, separarPlaca, limpiarNombre, MAX_TEXTO };
