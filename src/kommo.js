// Conexión con Kommo: valida lo que llega del bot y le responde por la API.
// Llaves en variables de entorno: KOMMO_SECRET (clave secreta) y KOMMO_TOKEN (token de larga duración).

const crypto = require('node:crypto');
const config = require('../config');

const DOMINIO = `${config.kommo.subdominio}.kommo.com`;

// El bot de Kommo firma cada envío con la clave secreta de la integración (JWT HS256).
function verificarToken(token, secreto, momento = Date.now()) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw new Error('token mal formado');
  const [cabecera, cuerpo, firma] = partes;
  const alg = JSON.parse(Buffer.from(cabecera, 'base64url').toString('utf8')).alg;
  if (alg !== 'HS256') throw new Error(`algoritmo no soportado: ${alg}`);
  const esperada = crypto.createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest();
  const recibida = Buffer.from(firma, 'base64url');
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) {
    throw new Error('firma inválida');
  }
  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  const segundos = Math.floor(momento / 1000);
  if (datos.exp && datos.exp < segundos - 60) throw new Error('token vencido');
  if (datos.nbf && datos.nbf > segundos + 60) throw new Error('token aún no válido');
  return datos;
}

// Solo se le responde a la cuenta propia: el token de la API nunca sale hacia otro dominio.
function direccionDeRetornoValida(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === DOMINIO &&
    !u.port &&
    /^\/api\/v4\/(salesbot|marketingbot)\/\d+\/continue\/\d+$/.test(u.pathname)
  );
}

// Kommo puede mandar JSON o formulario con claves tipo data[mensaje].
function leerCuerpo(texto, tipo = '') {
  if (tipo.includes('json')) return JSON.parse(texto || '{}');
  const salida = {};
  for (const [clave, valor] of new URLSearchParams(texto)) {
    const partes = clave.replace(/\]/g, '').split('[');
    let nodo = salida;
    partes.forEach((p, i) => {
      if (i === partes.length - 1) nodo[p] = valor;
      else nodo = nodo[p] = typeof nodo[p] === 'object' && nodo[p] ? nodo[p] : {};
    });
  }
  return salida;
}

function crearKommo({ secreto = process.env.KOMMO_SECRET, token = process.env.KOMMO_TOKEN } = {}) {
  const activo = Boolean(secreto && token);

  async function api(ruta, opciones = {}) {
    const respuesta = await fetch(`https://${DOMINIO}${ruta}`, {
      ...opciones,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!respuesta.ok) throw new Error(`Kommo respondió ${respuesta.status} en ${ruta}`);
    return respuesta.status === 204 ? null : respuesta.json().catch(() => null);
  }

  // Nombre y celular del contacto principal del lead.
  async function contactoDelLead(lead) {
    const datos = await api(`/api/v4/leads/${Number(lead)}?with=contacts`);
    const contactos = datos?._embedded?.contacts || [];
    const principal = contactos.find((c) => c.is_main) || contactos[0];
    if (!principal) return {};
    const contacto = await api(`/api/v4/contacts/${Number(principal.id)}`);
    const telefono = (contacto?.custom_fields_values || []).find((f) => f.field_code === 'PHONE')?.values?.[0]?.value;
    return { nombre: contacto?.name || null, telefono: telefono || null };
  }

  // Le dice al bot qué mostrar y con qué datos seguir ({{json.estado}}, etc.).
  async function continuar(direccion, cuerpo) {
    if (!direccionDeRetornoValida(direccion)) throw new Error('dirección de retorno no permitida');
    const respuesta = await fetch(direccion, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(8000),
    });
    if (!respuesta.ok) {
      throw new Error(`Kommo no aceptó la respuesta del bot (${respuesta.status}): ${(await respuesta.text()).slice(0, 300)}`);
    }
  }

  const nota = (lead, texto) =>
    api('/api/v4/leads/notes', {
      method: 'POST',
      body: JSON.stringify([{ entity_id: Number(lead), note_type: 'common', params: { text: texto } }]),
    });

  return {
    activo,
    verificar: (jwt) => verificarToken(jwt, secreto),
    direccionDeRetornoValida,
    contactoDelLead,
    continuar,
    nota,
    enlaceLead: (lead) => `https://${DOMINIO}/leads/detail/${lead}`,
  };
}

module.exports = { crearKommo, verificarToken, direccionDeRetornoValida, leerCuerpo, DOMINIO };
