// Lectura de los mensajes del cliente con un modelo de IA de OpenRouter.
// La IA SOLO extrae datos (nombre, vehículo, placa, día, hora, si confirma); nunca decide cupos
// ni agenda: eso lo hace la agenda. Si la IA falla o tarda, la conversación sigue con reglas.
// Variables: OPENROUTER_API_KEY y OPENROUTER_MODEL (por ejemplo un modelo ":free").

const { fechaLarga } = require('./fechas');

const URL = 'https://openrouter.ai/api/v1/chat/completions';

function instrucciones({ hoy, hora, servicio }) {
  return [
    'Extraes datos para agendar una cita en un taller mecánico de Cali, Colombia.',
    `Hoy es ${fechaLarga(hoy)} (${hoy}) y son las ${hora}. Servicio: ${servicio}.`,
    'Responde SOLO con un objeto JSON con estas claves:',
    '- "nombre": nombre de la persona (string o null).',
    '- "vehiculo": marca, modelo y año si los dice (string o null). No incluyas la placa.',
    '- "placa": placa del vehículo, solo letras y números en mayúscula (string o null).',
    '- "fecha": día que quiere la cita en formato YYYY-MM-DD (convierte "mañana", "el jueves", "el 14"; si no dice día, null).',
    '- "hora": hora en formato HH:MM de 24 horas ("a las 2 de la tarde" = "14:00"; si solo dice "en la tarde" o no dice, null).',
    '- "confirma": true si acepta o confirma lo que se le propuso, false si lo rechaza o pide cambiar algo, null si no aplica.',
    '- "asesor": true si pide hablar con una persona o asesor; si no, false.',
    'No inventes nada: si un dato no está en el mensaje, usa null.',
  ].join('\n');
}

function crearIA({ clave = process.env.OPENROUTER_API_KEY, modelo = process.env.OPENROUTER_MODEL, espera = 20000 } = {}) {
  const activa = Boolean(clave && modelo);

  async function pedir(cuerpo) {
    return fetch(URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clave}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://appcitas.up.railway.app',
        'X-Title': 'Agenda del taller',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(espera),
    });
  }

  // Devuelve el objeto con los datos o null si no se pudo.
  async function extraer({ mensaje, conocido = {}, pregunta = '', historial = [], hoy, hora, servicio }) {
    const conversacion = historial.slice(-12).map((m) => `${m.rol === 'cliente' ? 'Cliente' : 'Taller'}: ${m.texto}`).join('\n');
    if (!activa) return null;
    const cuerpo = {
      model: modelo,
      temperature: 0,
      messages: [
        { role: 'system', content: instrucciones({ hoy, hora, servicio }) },
        {
          role: 'user',
          content: `Conversación hasta ahora:\n${conversacion || '(inicio)'}\n\nDatos que ya tenemos: ${JSON.stringify(conocido)}\nÚltimo mensaje del taller: "${pregunta}"\nMensaje nuevo del cliente: "${mensaje}"`,
        },
      ],
    };
    let r = await pedir({ ...cuerpo, response_format: { type: 'json_object' } });
    if (r.status === 400) r = await pedir(cuerpo); // algunos modelos gratis no aceptan response_format
    if (!r.ok) throw new Error(`OpenRouter respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const respuesta = await r.json();
    const contenido = respuesta?.choices?.[0]?.message?.content || '';
    const json = contenido.match(/\{[\s\S]*\}/);
    return json ? JSON.parse(json[0]) : null;
  }

  // Reescribe un borrador para que suene natural. Devuelve el texto o null.
  async function redactar({ borrador, historial = [], servicio = '' }) {
    if (!activa || !borrador) return null;
    const conversacion = historial.slice(-12).map((m) => `${m.rol === 'cliente' ? 'Cliente' : 'Taller'}: ${m.texto}`).join('\n');
    const r = await pedir({
      model: modelo,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: [
            'Eres David, asesor de Automotriz Online SD, un taller mecánico en Cali. Le escribes por WhatsApp a un cliente que está agendando su cita.',
            `Servicio: ${servicio}.`,
            'Te doy un BORRADOR con lo que hay que decir. Reescríbelo natural, cálido y breve, como lo escribiría una persona por WhatsApp.',
            'Reglas: conserva EXACTAMENTE todos los datos (días, fechas, horas, precios, placas, nombres, dirección). No inventes nada, no ofrezcas otros horarios ni prometas nada que no esté en el borrador.',
            'Máximo 3 frases cortas. Si el borrador es un resumen en líneas, mantenlo en líneas. Como mucho 2 emojis. Tutea. Responde SOLO con el texto del mensaje.',
          ].join('\n'),
        },
        { role: 'user', content: `Conversación hasta ahora:\n${conversacion || '(inicio)'}\n\nBORRADOR:\n${borrador}` },
      ],
    });
    if (!r.ok) throw new Error(`OpenRouter respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const texto = (await r.json())?.choices?.[0]?.message?.content || '';
    return texto.trim().replace(/^["'«]|["'»]$/g, '').trim() || null;
  }

  return { activa, extraer, redactar };
}

module.exports = { crearIA, instrucciones };
