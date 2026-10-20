// Servidor web de la agenda. Usa solo módulos que vienen con Node.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { abrir } = require('./db');
const { crearAgenda, ErrorAgenda, ESTADOS } = require('./agenda');
const { ahora, esFecha, lunesDe, sumarDias } = require('./fechas');
const { crearConversaciones } = require('./conversaciones');
const { crearBot } = require('./bot');
const { crearKommo, leerCuerpo } = require('./kommo');
const { crearAtencion } = require('./atencion');
const { crearIA } = require('./ia');
const { crearRecordatorios } = require('./recordatorios');
const { crearReprogramaciones } = require('./reprogramar');
const { crearMemoria } = require('./memoria');
const { crearApi } = require('./api');
const { crearAgente } = require('./agente');
const { crearConversacionLibre } = require('./libre');
const vistas = require('./vistas');
const vistasBot = require('./vistas-bot');
const { crearAjustes } = require('./ajustes');
const { crearSimulador } = require('./simulador');
const { instrucciones: instruccionesIA } = require('./agente');

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

// Se limpian espacios: un espacio de más en Railway dejaba la base fuera del volumen.
if (process.env.DB_PATH) process.env.DB_PATH = process.env.DB_PATH.trim();
const db = abrir(process.env.DB_PATH || undefined);
const ajustes = crearAjustes(db);
ajustes.cargar();
{
  // Al arrancar se dice dónde están los datos y cuántos hay, para notar si se perdieron.
  const { n, activas } = db.prepare(`SELECT count(*) AS n, sum(estado <> 'CANCELADA') AS activas FROM citas`).get();
  console.log(`Base de datos: ${process.env.DB_PATH || '(archivo local por defecto)'} · ${n} citas guardadas (${activas || 0} activas).`);
  // En Railway los datos solo sobreviven a un redespliegue si están dentro del volumen.
  const volumen = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (process.env.RAILWAY_ENVIRONMENT) {
    if (!volumen) console.warn('⚠️ Railway sin volumen: las citas se BORRAN en cada despliegue. Agrega un volumen montado en /data.');
    else if (!String(process.env.DB_PATH || '').startsWith(volumen)) {
      console.warn(`⚠️ DB_PATH no está dentro del volumen (${volumen}): las citas se BORRAN en cada despliegue. Usa DB_PATH=${volumen}/taller.db`);
    }
  }
}
const agenda = crearAgenda(db);
const conversaciones = crearConversaciones(db);
const bot = crearBot(agenda);
const kommo = crearKommo();
const ia = crearIA();
const guardarDecision = db.prepare('INSERT INTO decisiones (lead, mensaje, accion, turno, motivo, aprobada, razon) VALUES (?, ?, ?, ?, ?, ?, ?)');
const agente = crearAgente({
  ia,
  agenda,
  alDecidir: ({ s, texto, crudo, decision, aprobada, razon }) => {
    const d = decision || crudo || {};
    guardarDecision.run(
      s.lead || null,
      String(texto || '').slice(0, 1000),
      d.accion ? String(d.accion).slice(0, 20) : null,
      d.turno ? JSON.stringify(d.turno).slice(0, 100) : null,
      d.motivo ? String(d.motivo).slice(0, 300) : null,
      aprobada ? 1 : 0,
      razon ? String(razon).slice(0, 300) : null
    );
  },
});
const simulador = crearSimulador({ dbReal: db, ia });
const libre = crearConversacionLibre(agenda, { ia, memoria: crearMemoria(db), agente });
console.log(
  !process.env.AGENTE || process.env.AGENTE === 'si' ? 'Agente de IA: encendido para todos los clientes (AGENTE=no para apagarlo).'
  : process.env.AGENTE === 'prueba' ? `Agente de IA: solo para los celulares de prueba (${String(process.env.AGENTE_TELEFONOS || '').split(',').filter(Boolean).length}).`
  : 'Agente de IA: apagado (AGENTE=no); responden las reglas.'
);
const api = crearApi(db);
console.log(api.activa ? 'API de solo lectura activa en /api/citas.' : 'API de solo lectura apagada (variable API_LECTURA_TOKEN).');
const atenderBot = crearAtencion({ bot, conversaciones, kommo, libre });
console.log(ia.activa ? 'IA de OpenRouter activa.' : 'IA sin configurar (OPENROUTER_API_KEY / OPENROUTER_MODEL): se usan solo reglas.');
if (!kommo.activo) console.log('Kommo sin configurar: faltan KOMMO_SECRET y/o KOMMO_TOKEN. El bot no agendará.');
const recordatorios = crearRecordatorios({ agenda, kommo });
if (recordatorios.activo) {
  // Revisa cada 5 minutos; solo actúa el día anterior entre las 7 a. m. y las 6 p. m.
  setInterval(() => recordatorios.revisar().catch((err) => console.error('Recordatorios:', err)), 5 * 60 * 1000).unref();
  recordatorios.revisar().catch((err) => console.error('Recordatorios:', err));
  console.log('Recordatorios activos: 7 a. m. del día anterior (etapa RECORDATORIO de Kommo).');
} else {
  console.log('Recordatorios apagados (variable RECORDATORIOS=si para encenderlos).');
}
// Si el cliente toca "Reprogramar" en el recordatorio, el bot lo pasa a la etapa REPROGRAMAR y aquí se cancela su cita.
const reprogramaciones = crearReprogramaciones({ agenda, kommo });
if (reprogramaciones.activo) {
  setInterval(() => reprogramaciones.revisar(), 2 * 60 * 1000).unref();
  reprogramaciones.revisar();
}
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
  `/calendario?dia=${semanaValida(fecha)}${aviso ? `&aviso=${encodeURIComponent(aviso)}` : ''}`;

// ---------- Rutas ----------
async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname;
  const metodo = req.method;

  if (metodo === 'GET' && ruta === '/salud') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  // API de solo lectura para otras aplicaciones (con token propio, sin sesión).
  if (metodo === 'GET' && ruta === '/api/citas') {
    const r = api.citas(req, url.searchParams);
    return json(res, r.estado, r.datos);
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
    // Mes del día elegido (semanas de lunes a domingo) y el detalle de ese día.
    const fecha = semanaValida(url.searchParams.get('dia') || url.searchParams.get('semana'));
    const inicio = lunesDe(`${fecha.slice(0, 8)}01`);
    const celdas = [];
    for (let i = 0; i < 42; i++) {
      const f = sumarDias(inicio, i);
      if (i % 7 === 0 && i > 0 && f.slice(0, 7) > fecha.slice(0, 7)) break;
      celdas.push(agenda.dia(f));
    }
    return html(res, 200, vistas.calendario({
      fecha,
      celdas,
      seleccionado: agenda.dia(fecha),
      semana: agenda.semana(lunesDe(fecha)),
      aviso: url.searchParams.get('aviso'),
    }));
  }

  // ---------- Sección Bot ----------
  if (metodo === 'GET' && ruta === '/bot') {
    const hoy = db.prepare(`SELECT count(*) AS n, sum(aprobada = 0) AS frenadas FROM decisiones WHERE date(creado, '-5 hours') = ?`).get(ahora().fecha);
    return html(res, 200, vistasBot.botConfig({
      ajustes: ajustes.actuales(),
      estado: { iaActiva: ia.activa, modelo: process.env.OPENROUTER_MODEL, recordatorios: recordatorios.activo },
      instrucciones: instruccionesIA({ hoy: ahora().fecha, hora: ahora().hora, servicio: 'REVISION' }),
      aviso: url.searchParams.get('aviso'),
      estadisticas: { hoy: hoy.n || 0, frenadasHoy: hoy.frenadas || 0 },
    }));
  }
  if (metodo === 'POST' && ruta === '/bot/ajustes') {
    const r = ajustes.guardarFormulario(await leerFormulario(req));
    if (r.ok) return ir(res, `/bot?aviso=${encodeURIComponent('Cambios guardados. Ya se están usando.')}`);
    return html(res, 422, vistasBot.botConfig({
      ajustes: ajustes.actuales(),
      estado: { iaActiva: ia.activa, modelo: process.env.OPENROUTER_MODEL, recordatorios: recordatorios.activo },
      instrucciones: instruccionesIA({ hoy: ahora().fecha, hora: ahora().hora, servicio: 'REVISION' }),
      errores: r.errores,
      estadisticas: { hoy: 0, frenadasHoy: 0 },
    }));
  }
  if (metodo === 'GET' && ruta === '/bot/simulador') {
    return html(res, 200, vistasBot.botSimulador({ sesion: simulador.sesion(), ejemplos: simulador.EJEMPLOS, iaActiva: ia.activa }));
  }
  if (metodo === 'POST' && ruta === '/bot/simulador') {
    const { mensaje } = await leerFormulario(req);
    try {
      await simulador.enviar(mensaje);
    } catch (err) {
      console.error('Simulador:', err);
    }
    return ir(res, '/bot/simulador#ultimo');
  }
  if (metodo === 'POST' && ruta === '/bot/simulador/reiniciar') {
    simulador.nuevaSesion();
    return ir(res, '/bot/simulador');
  }
  if (metodo === 'GET' && ruta === '/bot/conversaciones') {
    const lista = db.prepare(`
      SELECT m.lead, max(m.creado) AS ultimo, count(*) AS mensajes,
        (SELECT texto FROM mensajes x WHERE x.lead = m.lead AND x.rol = 'cliente' ORDER BY x.id DESC LIMIT 1) AS texto,
        (SELECT count(*) FROM decisiones d WHERE d.lead = m.lead AND d.aprobada = 0) AS frenadas,
        (SELECT count(*) FROM decisiones d WHERE d.lead = m.lead AND d.accion = 'cortar' AND d.aprobada = 1) AS cortes
      FROM mensajes m GROUP BY m.lead ORDER BY ultimo DESC LIMIT 100`).all();
    return html(res, 200, vistasBot.botConversaciones({ lista }));
  }
  const deConversacion = ruta.match(/^\/bot\/conversaciones\/([\w-]{1,40})$/);
  if (metodo === 'GET' && deConversacion) {
    const lead = deConversacion[1];
    // Mensajes y decisiones en el orden en que pasaron (la decisión va justo antes de la respuesta del bot).
    const mensajes = db.prepare('SELECT id, rol, texto, creado FROM mensajes WHERE lead = ? ORDER BY id DESC LIMIT 200').all(lead).reverse();
    const decisiones = db.prepare('SELECT * FROM decisiones WHERE lead = ? ORDER BY id DESC LIMIT 200').all(lead).reverse();
    const eventos = [];
    let i = 0;
    for (const m of mensajes) {
      eventos.push({ tipo: 'mensaje', ...m });
      if (m.rol === 'cliente') {
        // La decisión de ese mensaje del cliente (si la hubo).
        while (i < decisiones.length && decisiones[i].mensaje !== m.texto && decisiones[i].creado < m.creado) i++;
        if (i < decisiones.length && decisiones[i].mensaje === m.texto) eventos.push({ tipo: 'decision', ...decisiones[i++] });
      }
    }
    return html(res, 200, vistasBot.botConversacion({ lead, eventos }));
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
