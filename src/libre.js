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
// Si un mensaje no aporta nada (otro tema, no se entiende), se pasa a un asesor de una vez.
const MAX_SIN_AVANCE = 1;
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
  if ([...String(texto)].length <= MAX_TEXTO) return [String(texto)];
  // Primero se intenta cortar entre frases (después de ?, ! o un emoji), no a mitad de "a. m.".
  const frases = String(texto).split(/(?<=[?!]|\p{Extended_Pictographic})\s+/u);
  if (frases.length > 1 && frases.every((f) => [...f].length <= MAX_TEXTO)) return empacarFrases(frases);
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

// ¿La versión redactada conserva todos los datos del borrador? (horas, precios, placas, números de día)
function conservaDatos(base, nuevo) {
  if (!nuevo || [...nuevo].length > 500) return false;
  const datos = base.match(/\d{1,2}:\d{2}|\$[\d.]+|\b[A-Z]{3}\d{2}[A-Z0-9]\b|\b\d{1,2}\b/g) || [];
  const limpio = nuevo.replace(/\s+/g, ' ');
  // Días de la semana y meses también deben quedar iguales.
  const sinTilde = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const palabras = sinTilde(base).match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana|hoy|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/g) || [];
  const nuevoSinTilde = sinTilde(limpio);
  if (!palabras.every((p) => new RegExp(`\\b${p}\\b`).test(nuevoSinTilde))) return false;
  return datos.every((d) => new RegExp(`(^|[^\\d])${d.replace(/[$.]/g, '\\$&')}([^\\d]|$)`).test(limpio));
}

// Junta frases con espacio en mensajes de hasta 80 caracteres.
function empacarFrases(frases) {
  const mensajes = [];
  for (const f of frases) {
    const ultimo = mensajes[mensajes.length - 1];
    if (ultimo !== undefined && [...`${ultimo} ${f}`].length <= MAX_TEXTO) mensajes[mensajes.length - 1] = `${ultimo} ${f}`;
    else mensajes.push(f);
  }
  return mensajes;
}

// Junta líneas en mensajes de hasta 80 caracteres (menos burbujas en el WhatsApp del cliente).
function empacar(lineas) {
  const mensajes = [];
  for (const linea of lineas) {
    const ultimo = mensajes[mensajes.length - 1];
    const junto = `${ultimo}\n${linea}`;
    if (ultimo !== undefined && [...junto].length <= MAX_TEXTO) mensajes[mensajes.length - 1] = junto;
    else mensajes.push(linea);
  }
  return mensajes;
}

// "de 8:30 a. m. a 11:00 a. m. y a las 2:00 p. m." (horas seguidas se juntan en un rango)
function rangosDeHoras(horas) {
  if (!horas.length) return '';
  const ordenadas = [...horas].sort();
  const pasos = ordenadas.slice(1).map((h, i) => aMinutos(h) - aMinutos(ordenadas[i]));
  const paso = pasos.length ? Math.min(...pasos) : 0;
  const grupos = [];
  for (const h of ordenadas) {
    const g = grupos[grupos.length - 1];
    if (g && aMinutos(h) - aMinutos(g[g.length - 1]) === paso) g.push(h);
    else grupos.push([h]);
  }
  return lista(grupos.map((g) => (g.length === 1 ? 'a las ' + horaCorta(g[0]) : 'de ' + horaCorta(g[0]) + ' a ' + horaCorta(g[g.length - 1]))));
}

// "jueves 8"
const diaCorto = (fecha) => `${DIAS_NOMBRE[diaSemana(fecha)]} ${Number(fecha.slice(8))}`;

// "8:30, 9:30 u 11:30 a. m." · "11:30 a. m. o 2:00 p. m." (alternativas, con "o")
function opcionesDeHora(horas) {
  const sinSufijo = (h) => horaCorta(h).replace(/ [ap]\. m\.$/, '');
  const sufijo = (h) => (Number(h.slice(0, 2)) < 12 ? 'a. m.' : 'p. m.');
  const grupos = [];
  for (const h of [...horas].sort()) {
    const g = grupos[grupos.length - 1];
    if (g && sufijo(g[0]) === sufijo(h)) g.push(h);
    else grupos.push([h]);
  }
  const partes = grupos.map((g) => g.map(sinSufijo).map((t, i) => (i === g.length - 1 ? `${t} ${sufijo(g[0])}` : t)));
  const todas = partes.flat();
  if (todas.length <= 1) return todas.join('');
  const ultima = todas[todas.length - 1];
  const o = /^(8|11)\b/.test(ultima) || /^o/i.test(ultima) ? 'u' : 'o';
  return `${todas.slice(0, -1).join(', ')} ${o} ${ultima}`;
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
    // "viernes 16" es el día 16, pero "sábado 9 am" es la hora.
    (dia && limpio.match(new RegExp(`\\b${dia[1]} (\\d{1,2})\\b(?!:|\\s*(?:a m|am|p m|pm|y media|de la))`))) ||
    (soloNumero && limpio.match(/^(\d{1,2})$/));
  if (!dia && !num) return null;
  const buscar = (conNumero) => {
    for (let i = 0; i <= DIAS_EN_VENTANA; i++) {
      const fecha = sumarDias(hoy, i);
      if (dia && NOMBRES_DIA_SIN_TILDE[diaSemana(fecha)] !== dia[1]) continue;
      if (conNumero && num && Number(fecha.slice(8)) !== Number(num[1])) continue;
      return fecha;
    }
    return null;
  };
  // Si el día de la semana y el número no cuadran, manda el día de la semana.
  return buscar(true) || (dia ? buscar(false) : null);
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

const MARCAS = new RegExp('\\b(' + [
  'chevrolet', 'chevy', 'mazda', 'renault', 'kia', 'nissan', 'toyota', 'hyundai', 'ford', 'volkswagen', 'vw', 'suzuki', 'mitsubishi',
  'honda', 'bmw', 'mercedes', 'audi', 'peugeot', 'citroen', 'fiat', 'jeep', 'dodge', 'ram', 'subaru', 'skoda', 'seat', 'byd', 'jac',
  'dfsk', 'changan', 'chery', 'mg', 'ssangyong', 'volvo', 'isuzu', 'hino', 'foton', 'great wall', 'jmc', 'kymco', 'yamaha', 'bajaj',
  'akt', 'tvs', 'spark', 'aveo', 'sail', 'onix', 'tracker', 'captiva', 'optra', 'cruze', 'duster', 'logan', 'sandero', 'stepway',
  'kwid', 'clio', 'picanto', 'rio', 'sportage', 'soluto', 'cerato', 'tiida', 'versa', 'march', 'sentra', 'kicks', 'frontier',
  'hilux', 'corolla', 'fortuner', 'prado', 'yaris', 'tucson', 'accent', 'creta', 'santa fe', 'i10', 'i25', 'swift', 'vitara',
  'fiesta', 'escape', 'ecosport', 'gol', 'jetta', 'tiguan', 'cx ?\\d+', 'bt ?50',
].join('|') + ')\\b');
const ES_VEHICULO = (t) => MARCAS.test(t) || /\b(19|20)\d{2}\b/.test(t) || /\b(carro|camioneta|moto|vehiculo|modelo)\b/.test(t);

// Preguntas comunes que el bot responde sin cortar la conversación.
function preguntaFrecuente(texto, servicio) {
  const t = normalizar(texto);
  const s = config.servicios[servicio] || config.servicios.REVISION;
  // Precio o duración de OTRO servicio (aceite, frenos…): eso lo responde un asesor.
  const otroServicio = /\b(aceite|latoneria|pintura|frenos?|llantas?|alineacion|balanceo|lavado|bateria|embrague|suspension|aire|scanner|escaner|diagnostico)\b/.test(t);
  const respuestas = [];
  if (/\b(donde|direccion|ubicad\w*|ubicacion|como llego|como llegar|en que parte|que barrio)\b/.test(t)) {
    respuestas.push(`📍 Estamos en la ${config.direccion}.`);
  }
  if (!otroServicio && /\b(cuanto (vale|cuesta|es|sale|cobran)|precio|valor|costo)\b/.test(t)) {
    respuestas.push(`💰 ${s.nombre}: ${String(s.precio).replace(/^Precio:\s*/i, '')}.`.replace(/\.\.$/, '.'));
  }
  if (/\b(horario|a que hora (abren|cierran|atienden)|hasta que hora|que dias (atienden|trabajan|abren)|abren el|atienden el)\b/.test(t)) {
    respuestas.push('🕘 Atendemos de lunes a sábado, de 8 a. m. a 5 p. m. Las citas son de 8:30 a. m. a 3:30 p. m.');
  }
  if (!otroServicio && /\b(cuanto (dura|demora|se demora|tarda|se tarda)|duracion|cuanto tiempo)\b/.test(t)) {
    const min = s.duracionMinutos;
    respuestas.push(`⏱️ La ${s.corto.toLowerCase()} dura aprox. ${min >= 60 ? `${min / 60} horas` : `${min} minutos`}.`);
  }
  return respuestas.join(' ') || null;
}

// Corta el día y la hora que vengan pegados al vehículo: "Kia Rio 2020 el sábado a las 2:30" → "Kia Rio 2020".
function sinDiaNiHora(texto) {
  const corte = String(texto).search(
    /\s(el\s+|este\s+|para\s+el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[nñ]ana|hoy|pasado)\b|\s(a\s+las\s+)?\d{1,2}(:\d{2}|\s*(am|pm|a\.?\s?m|p\.?\s?m))\b|\sa\s+las\s+\d/i
  );
  return corte > 0 ? String(texto).slice(0, corte) : String(texto);
}

// Si la parte empieza con un nombre en mayúscula antes del vehículo, los separa:
// "Fredy Valencia tuson i35 2012" → nombre "Fredy Valencia", vehículo "tuson i35 2012".
function nombreYVehiculo(texto) {
  const palabras = String(texto).trim().split(/\s+/);
  let i = 0;
  while (
    i < palabras.length &&
    i < 4 &&
    /^\p{Lu}\p{Ll}+$/u.test(palabras[i]) &&
    !MARCAS.test(normalizar(palabras[i])) &&
    !NO_ES_NOMBRE.has(normalizar(palabras[i]))
  ) i++;
  if (i < 2 || i >= palabras.length) return { nombre: null, vehiculo: texto };
  const nombre = limpiarNombre(palabras.slice(0, i).join(' '));
  return nombre ? { nombre, vehiculo: palabras.slice(i).join(' ') } : { nombre: null, vehiculo: texto };
}

// Separa un mensaje en partes (líneas, comas, punto y coma) y reconoce nombre y vehículo por su forma.
// Ej: "David Perlaza / Nissan Tiida 2015 / ABC133 / mañana 10 am".
function porPartes(texto) {
  const r = {};
  const partes = String(texto).split(/[\n;,]+/).map((p) => p.trim()).filter(Boolean);
  for (const parte of partes) {
    // "Nombre: David", "Vehículo: Mazda 3"…
    const etiqueta = normalizar(parte).match(/^(nombre|placa|vehiculo|carro|moto|modelo|dia|fecha|hora)\b/);
    const valor = etiqueta ? parte.replace(/^[^\s:]+\s*:?\s*/, '').trim() : parte;
    const v = normalizar(valor);
    if (!v) continue;
    if (etiqueta && etiqueta[1] === 'nombre') {
      const n = limpiarNombre(valor);
      if (n) r.nombre = n;
      continue;
    }
    const { placa, resto } = separarPlaca(valor);
    const sinPlaca = normalizar(resto).replace(/\b(la )?placa( es)?\b/g, ' ').trim();
    if (!sinPlaca) continue; // solo era la placa
    const esDiaUHora = fechaEscrita(v, '2000-01-03') || horaEscrita(v) || /^(hoy|manana|pasado manana)\b/.test(v);
    if (esDiaUHora && !ES_VEHICULO(sinPlaca)) continue;
    if ((etiqueta && ['vehiculo', 'carro', 'moto', 'modelo'].includes(etiqueta[1])) || ES_VEHICULO(sinPlaca)) {
      if (!r.vehiculo) {
        // "Fredy Valencia tucson i35 modelo 2012 sábado 2:30": nombre adelante, día y hora atrás.
        const { nombre, vehiculo } = nombreYVehiculo(resto);
        if (nombre && !r.nombre) r.nombre = nombre;
        const limpio = sinDiaNiHora(vehiculo)
          .replace(/\b(la )?placa( es)?\b:?/i, ' ')
          .replace(/^\s*(tengo|es|mi carro es|mi vehiculo es|mi vehículo es)\s+(un|una)?\s*/i, '')
          .replace(/\bmodelo\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
        if (limpio) r.vehiculo = limpio.slice(0, 120);
      }
      continue;
    }
    const pareceFrase = /(tarde|manana|noche|dia|hora|semana|revision|sincronizacion|cita|agendar|quiero|puedo|necesito|gracias|hola|buenas|cuanto|precio|donde)/.test(v);
    if (!placa && !r.nombre && !pareceFrase && /^[a-z ]+$/.test(v) && v.split(' ').length <= 4 && !NO_ES_NOMBRE.has(v)) {
      const n = limpiarNombre(valor);
      if (n) r.nombre = n;
    }
  }
  return r;
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

  // Nombre y vehículo por la forma de cada línea o parte del mensaje (sin pisar lo que ya se tiene).
  const partes = porPartes(texto);
  if (partes.nombre && (!s.datos.nombre || s.preguntando === 'nombre')) r.nombre = partes.nombre;
  if (partes.vehiculo && (!s.datos.vehiculo || s.preguntando === 'vehiculo')) r.vehiculo = partes.vehiculo;

  // Respuesta directa a lo que se le preguntó.
  // "Fredy Valencia CQW979": se quita la placa y lo que queda es el nombre.
  if (s.preguntando === 'nombre' && !r.nombre && resto) {
    const nombre = limpiarNombre(resto);
    if (nombre) r.nombre = nombre;
  }
  if (s.preguntando === 'vehiculo' && !r.vehiculo) {
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
    const r = resultado('esperar', s, textos);
    if (textos.flatMap(partir).length === 1) r.handlers = []; // un solo mensaje: va completo, sin repetir
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

  // "hoy martes 13", "mañana miércoles 14", "el jueves 15".
  const diasConCupoTexto = (hoy, cuantos = 3) =>
    agenda
      .diasConCupo(cuantos)
      .map(({ fecha }) => (fecha === hoy ? 'hoy ' : fecha === sumarDias(hoy, 1) ? 'mañana ' : 'el ') + diaCorto(fecha));
  const unaU = (cosas) => (cosas.length <= 1 ? cosas.join('') : `${cosas.slice(0, -1).join(', ')} o ${cosas[cosas.length - 1]}`);

  function resumen(s) {
    const d = s.datos;
    const servicio = config.servicios[s.servicio].nombre;
    return empacar([
      'Te agendo así 👇',
      `🔧 ${servicio}`,
      `📅 ${mayuscula(fechaLarga(d.fecha))}, ${horaCorta(d.hora)}`,
      `🚗 ${d.vehiculo} · ${d.placa}`,
      `👤 ${d.nombre}`,
      '¿Confirmo la cita? Responde SÍ o dime qué cambio ✍️',
    ]);
  }

  function guardar(s) {
    const d = s.datos;
    try {
      const cita = agenda.reservar(
        { servicio: s.servicio, fecha: d.fecha, hora: d.hora, cliente: d.nombre, telefono: d.telefono, vehiculo: d.vehiculo, placa: d.placa, kommoLead: s.lead },
        { origen: 'BOT' }
      );
      // Si venía de "Reprogramar" en el recordatorio, la cita recordada queda cancelada.
      for (const vieja of agenda.cancelarOtrasDelLead(cita.kommo_lead, cita.id)) {
        console.log('Cita reprogramada: cancelo la anterior', { lead: cita.kommo_lead, id: vieja.id, fecha: vieja.fecha, hora: vieja.hora });
      }
      const servicio = config.servicios[cita.servicio];
      return resultado('listo', null, empacar([
        `✅ ¡Listo, ${cita.cliente.split(/\s+/)[0]}! Agendé tu ${servicio.nombre}.`,
        `📅 ${mayuscula(fechaLarga(cita.fecha))} a las ${horaCorta(cita.hora)}`,
        `🚗 ${cita.vehiculo || ''} · ${cita.placa || ''}`.replace(/^🚗  · $/, ''),
        `📍 ${config.direccion}. ¡Te esperamos! 🙌`,
        'Si necesitas cambiar algo, escríbeme por aquí.',
      ]), {
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
  function decidir(s, avance, { conPregunta = false } = {}) {
    const momento = ahora(reloj());
    const d = { ...s.datos };
    const avisos = [];

    // Saludo corto según lo que pasó con este mensaje.
    const primerNombre = d.nombre ? d.nombre.split(/\s+/)[0] : '';
    const saludo = conPregunta ? '' : !avance ? 'No te entendí 🙈' : primerNombre && !s.saludado ? `Gracias, ${primerNombre} 🙌` : 'Perfecto 👍';
    const marcarSaludo = (sig) => (primerNombre ? { ...sig, saludado: true } : sig);

    // El día pedido tiene que tener cupo: si no, se proponen los 3 días con cupo más cercanos.
    if (d.fecha && !agenda.horasLibres(d.fecha).length) {
      const pedido = d.fecha;
      const cercanos = agenda
        .diasConCupo(DIAS_EN_VENTANA)
        .map((x) => x.fecha)
        .sort((a, b) => Math.abs(diasEntre(pedido, a)) - Math.abs(diasEntre(pedido, b)) || a.localeCompare(b))
        .slice(0, 3)
        .sort();
      d.fecha = null;
      d.hora = null;
      const sig = marcarSaludo({ ...s, datos: d, preguntando: 'fecha', confirmando: false, sinAvance: 0 });
      if (!cercanos.length) return asesor('Por ahora no tengo cupos libres. Un asesor te escribe 🙌', 'sin_cupos');
      const dias = cercanos.map((f) => `el ${diaCorto(f)}`);
      const opciones = dias.length > 1 ? `${dias.slice(0, -1).join(', ')} o ${dias[dias.length - 1]}` : dias[0];
      return esperar(sig, [`El ${fechaLarga(pedido)} no tengo cupo 😕 ¿Te sirve ${opciones}?`]);
    }
    // La hora pedida tiene que estar libre ese día: se ofrecen las más cercanas.
    if (d.fecha && d.hora && !agenda.horasLibres(d.fecha).some((h) => h.hora === d.hora)) {
      const otras = horasCercanas(d.fecha, d.hora);
      const pedida = d.hora;
      d.hora = null;
      const sig = marcarSaludo({ ...s, datos: d, preguntando: 'hora', confirmando: false, sinAvance: 0 });
      const intro = avance && primerNombre && !s.saludado ? `Gracias, ${primerNombre} 🙌 ` : '';
      return esperar(sig, [
        `${intro}A las ${horaCorta(pedida)} ya no tengo cupo el ${diaCorto(d.fecha)} 😕 ¿Te sirve ${opcionesDeHora(otras)}?`,
      ]);
    }

    const faltan = CAMPOS.filter((c) => !d[c]);
    if (faltan.length) {
      const sinAvance = avance ? 0 : (s.sinAvance || 0) + 1;
      if (sinAvance >= MAX_SIN_AVANCE) return asesor('Dame un momento, ya te escribe un asesor 🙌', 'no_entendio');
      const sig = marcarSaludo({ ...s, datos: d, preguntando: faltan[0], confirmando: false, sinAvance });
      let pregunta;
      if (faltan.length > 2) {
        pregunta = `Para agendarte me falta ${lista(faltan.map((c) => NOMBRE_CAMPO[c]))} ✍️`;
      } else if (faltan[0] === 'fecha') {
        const dias = unaU(diasConCupoTexto(momento.fecha));
        pregunta = faltan.includes('hora')
          ? `¿Qué día y a qué hora te queda bien? Tengo espacio ${dias}, de ${horaCorta(config.horario[1]?.desde || '08:30')} a ${horaCorta(config.horario[1]?.hasta || '15:30')}.`
          : `¿Para qué día te agendo${d.hora ? ` a las ${horaCorta(d.hora)}` : ''}? Tengo espacio ${dias}.`;
      } else if (faltan[0] === 'hora') {
        const libres = agenda.horasLibres(d.fecha).map((h) => h.hora);
        pregunta = `¿A qué hora te queda bien el ${diaCorto(d.fecha)}? Tengo libre ${rangosDeHoras(libres)}.`;
      } else if (faltan.length === 2) {
        pregunta = `¿Me dices ${NOMBRE_CAMPO[faltan[0]]} y ${NOMBRE_CAMPO[faltan[1]]}?`;
      } else {
        pregunta = PREGUNTA[faltan[0]];
      }
      return esperar(sig, [[...avisos, saludo, pregunta].filter(Boolean).join(' ')]);
    }

    // Con todos los datos y el turno libre, se agenda de una vez y se le confirma al cliente.
    return guardar({ ...s, datos: d, preguntando: null, confirmando: false, sinAvance: 0 });
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
    const historial = Array.isArray(s.historial) ? s.historial : [];

    let deIA = {};
    if (ia && ia.activa && texto) {
      try {
        deIA = limpiarIA(
          await ia.extraer({
            mensaje: texto,
            conocido: Object.fromEntries(CAMPOS.map((c) => [c, s.datos[c] || null])),
            pregunta: s.ultimaPregunta || '',
            historial,
            hoy: momento.fecha,
            hora: momento.hora,
            servicio: config.servicios[s.servicio].nombre,
          }),
          momento
        );
        console.log('IA: datos leídos', { lead: s.lead, campos: Object.keys(deIA) });
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
          ? asesor('Dame un momento, ya te escribe un asesor 🙌', 'no_entendio')
          : esperar({ ...s, sinAvance }, ['¿Confirmo la cita? Responde SÍ o dime qué quieres cambiar ✍️']);
      }
    } else {
      // Si preguntó algo común (dirección, precio, horario, duración), se le responde y se sigue con la cita.
      const respuesta = preguntaFrecuente(texto, s.servicio);
      r = decidir(s, cambio || Boolean(respuesta), { conPregunta: Boolean(respuesta) && !cambio });
      if (respuesta && r.estado === 'esperar') {
        const antes = [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean);
        const shows = [...partir(respuesta), ...antes].map((value) => ({ handler: 'show', params: { type: 'text', value } }));
        r.acuse = shows[0].params.value;
        r.handlers = shows.slice(1);
      }
    }
    // La IA redacta las preguntas para que suenen naturales; si cambia algún dato, se usa el texto original.
    // La confirmación de la cita y el paso a asesor van siempre con el texto fijo (sin cambios de la IA).
    const base = [r.acuse, ...r.handlers.map((h) => h.params.value)].filter(Boolean).join('\n');
    let final = base;
    if (ia && ia.activa && ia.redactar && r.estado === 'esperar') {
      try {
        const natural = await ia.redactar({ borrador: base, historial: [...historial, { rol: 'cliente', texto }], servicio: config.servicios[s.servicio].nombre });
        if (natural && conservaDatos(base, natural)) final = natural;
        else if (natural) console.warn('IA: la redacción cambió datos, uso el texto original');
      } catch (err) {
        console.warn('IA: no pude redactar, uso el texto original:', err.message);
      }
    }
    if (final !== base) {
      const mensajes = empacarFrases(final.split(/\n+/).flatMap(partir));
      const shows = mensajes.map((value) => ({ handler: 'show', params: { type: 'text', value } }));
      if (r.estado === 'esperar') {
        r.acuse = shows[0].params.value;
        r.handlers = shows.slice(1);
      } else {
        r.handlers = shows;
      }
    }

    // Historial de la conversación (lo último), para darle contexto a la IA en el siguiente mensaje.
    if (r.siguiente) {
      r.siguiente.historial = [...historial, { rol: 'cliente', texto }, { rol: 'taller', texto: final }].slice(-20);
      r.siguiente.ultimaPregunta = final.slice(0, 300);
    }
    return r;
  }

  return { responder };
}

module.exports = { crearConversacionLibre, preguntaFrecuente, extraerConReglas, porPartes, fechaEscrita, horaEscrita, limpiarIA, partir, horarioCitas };
