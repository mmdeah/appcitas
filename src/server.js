// Servidor web de la agenda. Usa solo módulos que vienen con Node.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { abrir } = require('./db');
const { crearAgenda, ErrorAgenda, ESTADOS } = require('./agenda');
const { ahora, esFecha, lunesDe } = require('./fechas');
const { crearConversaciones } = require('./conversaciones');
const { crearBot } = require('./bot');
const { crearKommo, leerCuerpo } = require('./kommo');
const { crearAtencion } = require('./atencion');
const vistas = require('./vistas');

const CLAVE = process.env.ADMIN_PASSWORD;
const SECRETO = process.env.SESSION_SECRET;
if (!CLAVE || !SECRETO) {
  console.error(
    'Faltan las variables ADMIN_PASSWORD y/o SESSION_SECRET. En tu computador van en .env; en Railway, en la pestaña Variables del servicio.'
  );
  process.exit(1);
}
const COOKIE_SEGURA = process.env.COOKIE_SECURE === 'true';
const DURACION_SESION = 30 * 24 * 60 * 60; // 30 días, en segundos

const db = abrir(process.env.DB_PATH || undefined);
const agenda = crearAgenda(db);
const conversaciones = crearConversaciones(db);
const bot = crearBot(agenda);
const kommo = crearKommo();
const atenderBot = crearAtencion({ bot, conversaciones, kommo });
if (!kommo.activo) console.log('Kommo sin configurar: faltan KOMMO_SECRET y/o KOMMO_TOKEN. El bot no agendará.');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'));

const CABECERAS = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

// ---------- Sesión ----------
const firmar = (valor) => crypto.createHmac('sha256', SECRETO).update(valor).digest('base64url');
const nuevaSesion = () => {
  const vence = String(Date.now() + DURACION_SESION * 1000);
  return `${vence}.${firmar(vence)}`;
};
const cookieSesion = (valor, segundos) =>
  `sesion=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${segundos}${COOKIE_SEGURA ? '; Secure' : ''}`;

function leerCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '')
      .split(';')
      .map((p) => p.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, v.join('=')])
  );
}

function sesionValida(req) {
  const [vence, firma] = (leerCookies(req).sesion || '').split('.');
  if (!vence || !firma) return false;
  const esperada = Buffer.from(firmar(vence));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida) && Number(vence) > Date.now();
}

const huella = (texto) => crypto.createHash('sha256').update(String(texto)).digest();
const claveCorrecta = (intento) => crypto.timingSafeEqual(huella(intento), huella(CLAVE));

// Máximo 5 intentos fallidos de clave cada 15 minutos por dirección.
const intentos = new Map();
function demasiadosIntentos(ip) {
  const recientes = (intentos.get(ip) || []).filter((t) => Date.now() - t < 15 * 60 * 1000);
  intentos.set(ip, recientes);
  return recientes.length >= 5;
}
const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();

// ---------- Utilidades HTTP ----------
function leerTexto(req) {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    req.setEncoding('utf8');
    req.on('data', (parte) => {
      cuerpo += parte;
      if (cuerpo.length > 20000) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(cuerpo));
    req.on('error', reject);
  });
}

const leerFormulario = async (req) => Object.fromEntries(new URLSearchParams(await leerTexto(req)));


function html(res, estado, contenido, extra = {}) {
  res.writeHead(estado, { 'Content-Type': 'text/html; charset=utf-8', ...CABECERAS, ...extra });
  res.end(contenido);
}

function json(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(datos));
}

function ir(res, destino, extra = {}) {
  res.writeHead(303, { Location: destino, ...extra });
  res.end();
}

const semanaValida = (valor) => (esFecha(valor) ? valor : ahora().fecha);
const alCalendario = (fecha, aviso) =>
  `/calendario?semana=${lunesDe(semanaValida(fecha))}${aviso ? `&aviso=${encodeURIComponent(aviso)}` : ''}${fecha ? `#d-${fecha}` : ''}`;

// ---------- Rutas ----------
async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname;
  const metodo = req.method;

  if (metodo === 'GET' && ruta === '/salud') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (metodo === 'GET' && ruta === '/app.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(CSS);
  }

  if (metodo === 'POST' && ruta === '/kommo/bot') {
    if (!kommo.activo) return json(res, 503, { error: 'Kommo sin configurar' });
    let cuerpo = {};
    try {
      cuerpo = leerCuerpo(await leerTexto(req), req.headers['content-type'] || '');
      console.log('Kommo: llegó consulta del bot', {
        tipo: req.headers['content-type'],
        campos: Object.keys(cuerpo),
        lead: cuerpo.data?.lead,
        inicio: cuerpo.data?.inicio,
      });
      kommo.verificar(cuerpo.token);
    } catch (err) {
      console.warn('Kommo: petición rechazada:', err.message);
      return json(res, 401, { error: 'no autorizado' });
    }
    if (!kommo.direccionDeRetornoValida(cuerpo.return_url)) {
      console.warn('Kommo: dirección de retorno no permitida:', String(cuerpo.return_url).slice(0, 200));
      return json(res, 400, { error: 'return_url no permitida' });
    }
    json(res, 200, {});
    atenderBot(cuerpo).catch((err) => console.error('Kommo: error atendiendo el bot:', err));
    return;
  }

  if (ruta === '/login') {
    if (metodo === 'GET') return html(res, 200, vistas.login());
    if (metodo === 'POST') {
      const ip = ipDe(req);
      if (demasiadosIntentos(ip)) return html(res, 429, vistas.login('Demasiados intentos. Espera 15 minutos.'));
      const { clave = '' } = await leerFormulario(req);
      if (!claveCorrecta(clave)) {
        intentos.get(ip).push(Date.now());
        return html(res, 401, vistas.login('Clave incorrecta.'));
      }
      intentos.delete(ip);
      return ir(res, '/calendario', { 'Set-Cookie': cookieSesion(nuevaSesion(), DURACION_SESION) });
    }
  }

  if (!sesionValida(req)) return ir(res, '/login');

  if (metodo === 'POST' && ruta === '/salir') return ir(res, '/login', { 'Set-Cookie': cookieSesion('', 0) });
  if (metodo === 'GET' && ruta === '/') return ir(res, '/calendario');

  if (metodo === 'GET' && ruta === '/calendario') {
    const lunes = lunesDe(semanaValida(url.searchParams.get('semana')));
    return html(res, 200, vistas.calendario({ dias: agenda.semana(lunes), lunes, aviso: url.searchParams.get('aviso') }));
  }

  if (metodo === 'GET' && ruta === '/exportar') {
    const copia = { exportado: new Date().toISOString(), ...agenda.exportar() };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="citas-${ahora().fecha}.json"`,
      ...CABECERAS,
    });
    return res.end(JSON.stringify(copia, null, 2));
  }

  if (metodo === 'GET' && ruta === '/citas/nueva') {
    const fecha = url.searchParams.get('fecha');
    return html(res, 200, vistas.citaNueva({ valores: { fecha: esFecha(fecha) ? fecha : ahora().fecha, hora: url.searchParams.get('hora') } }));
  }

  if (metodo === 'POST' && ruta === '/citas') {
    const datos = await leerFormulario(req);
    try {
      const cita = agenda.reservar(datos, { origen: 'MANUAL', forzar: datos.forzar === 'on' });
      return ir(res, alCalendario(cita.fecha, `Cita de ${cita.cliente} guardada.`));
    } catch (err) {
      if (!(err instanceof ErrorAgenda)) throw err;
      return html(res, 422, vistas.citaNueva({ valores: datos, error: err.message }));
    }
  }

  const deCita = ruta.match(/^\/citas\/(\d+)(\/estado)?$/);
  if (deCita) {
    const cita = agenda.cita(Number(deCita[1]));
    if (!cita) return html(res, 404, vistas.noEncontrado());
    if (metodo === 'GET' && !deCita[2]) return html(res, 200, vistas.citaDetalle(cita, { aviso: url.searchParams.get('aviso') }));
    if (metodo === 'POST' && deCita[2]) {
      const { estado } = await leerFormulario(req);
      try {
        if (!ESTADOS.includes(estado)) throw new ErrorAgenda('DATOS', 'Estado no válido.');
        const nueva = agenda.cambiarEstado(cita.id, estado);
        if (estado === 'CANCELADA') return ir(res, alCalendario(nueva.fecha, `Cita de ${nueva.cliente} cancelada.`));
        return ir(res, `/citas/${cita.id}?aviso=${encodeURIComponent('Estado actualizado.')}`);
      } catch (err) {
        if (!(err instanceof ErrorAgenda)) throw err;
        return html(res, 409, vistas.citaDetalle(cita, { error: err.message }));
      }
    }
  }

  if (metodo === 'POST' && ruta === '/bloqueos') {
    const datos = await leerFormulario(req);
    try {
      agenda.bloquear(datos);
      return ir(res, alCalendario(datos.fecha, datos.hora ? 'Hora bloqueada.' : 'Día bloqueado.'));
    } catch (err) {
      if (!(err instanceof ErrorAgenda)) throw err;
      return ir(res, alCalendario(datos.semana, err.message));
    }
  }

  const deBloqueo = ruta.match(/^\/bloqueos\/(\d+)\/borrar$/);
  if (metodo === 'POST' && deBloqueo) {
    const borrado = agenda.desbloquear(Number(deBloqueo[1]));
    const datos = await leerFormulario(req);
    return ir(res, alCalendario(borrado ? borrado.fecha : datos.semana, borrado ? 'Bloqueo quitado.' : null));
  }

  return html(res, 404, vistas.noEncontrado());
}

const PUERTO = Number(process.env.PORT) || 3200;

http
  .createServer((req, res) => {
    atender(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) html(res, 500, vistas.error());
      else res.end();
    });
  })
  .listen(PUERTO, () => console.log(`Agenda del taller en http://localhost:${PUERTO}`));
