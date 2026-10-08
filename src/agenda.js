// Motor de citas: qué horas están libres, reservar sin cruces, cancelar y bloquear.
// Lo usa la app web y, más adelante, el bot de WhatsApp.

const config = require('../config');
const { ahora, sumarDias, diaSemana, diasEntre, aMinutos, deMinutos, esFecha, esHora } = require('./fechas');
const { esFestivo } = require('./festivos');

const ESTADOS = ['AGENDADA', 'CONFIRMADA', 'LLEGO', 'NO_ASISTIO', 'CANCELADA'];

class ErrorAgenda extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

// Celulares de Colombia: 10 dígitos que empiezan por 3 → se les agrega el 57.
function normalizarTelefono(texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  return digitos.length === 10 && digitos.startsWith('3') ? `57${digitos}` : digitos;
}

const textoOpcional = (valor, max) => String(valor || '').trim().slice(0, max) || null;

function crearAgenda(db, cfg = config, reloj = () => new Date()) {
  const sql = {
    citasDelDia: db.prepare(`SELECT * FROM citas WHERE fecha = ? AND estado <> 'CANCELADA' ORDER BY hora, puesto`),
    // Cupo por bloque de una hora: 9:00 y 9:30 comparten los mismos puestos.
    puestosOcupados: db.prepare(`SELECT puesto FROM citas WHERE fecha = ? AND substr(hora, 1, 2) = ? AND estado <> 'CANCELADA'`),
    cita: db.prepare(`SELECT * FROM citas WHERE id = ?`),
    insertar: db.prepare(`
      INSERT INTO citas (servicio, fecha, hora, puesto, cliente, telefono, vehiculo, placa, notas, origen, kommo_lead)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`),
    cambiarEstado: db.prepare(`UPDATE citas SET estado = ? WHERE id = ? RETURNING *`),
    bloqueosDelDia: db.prepare(`SELECT * FROM bloqueos WHERE fecha = ? ORDER BY hora`),
    bloquear: db.prepare(`INSERT INTO bloqueos (fecha, hora, motivo) VALUES (?, ?, ?) RETURNING *`),
    desbloquear: db.prepare(`DELETE FROM bloqueos WHERE id = ? RETURNING *`),
    todasLasCitas: db.prepare(`SELECT * FROM citas ORDER BY fecha, hora, puesto`),
    todosLosBloqueos: db.prepare(`SELECT * FROM bloqueos ORDER BY fecha, hora`),
  };

  function horasDeAtencion(fecha) {
    const h = cfg.horario[diaSemana(fecha)];
    if (!h) return [];
    const horas = [];
    for (let m = aMinutos(h.desde); m <= aMinutos(h.hasta); m += cfg.intervaloMinutos) horas.push(deMinutos(m));
    return horas;
  }

  function motivoDeCierre(fecha, bloqueos) {
    if (cfg.cerrarFestivos && esFestivo(fecha)) return 'Festivo';
    const todoElDia = bloqueos.find((b) => !b.hora);
    if (todoElDia) return todoElDia.motivo || 'Bloqueado';
    if (!cfg.horario[diaSemana(fecha)]) return 'Sin atención';
    return null;
  }

  // Bloque de una hora al que pertenece un turno ("09:30" → "09"). La capacidad es por bloque.
  const bloque = (hora) => hora.slice(0, 2);

  // Minutos que faltan desde "ahora" hasta esa fecha y hora (negativo si ya pasó).
  const minutosHasta = (fecha, hora, momento) =>
    diasEntre(momento.fecha, fecha) * 1440 + aMinutos(hora) - aMinutos(momento.hora);

  // Lo que el bot puede ofrecer: con anticipación suficiente y dentro de los días permitidos.
  const dentroDelPlazo = (fecha, hora, momento) =>
    minutosHasta(fecha, hora, momento) >= cfg.anticipacionMinutos &&
    diasEntre(momento.fecha, fecha) <= cfg.diasAdelante;

  // Estado completo de un día: cada hora con sus citas, bloqueos y cupos libres.
  function dia(fecha) {
    const momento = ahora(reloj());
    const bloqueos = sql.bloqueosDelDia.all(fecha);
    const cierre = motivoDeCierre(fecha, bloqueos);
    const citas = sql.citasDelDia.all(fecha);
    const deAtencion = horasDeAtencion(fecha);
    // También se muestran citas en horas fuera del horario (agendadas a mano).
    const horas = [...new Set([...deAtencion, ...citas.map((c) => c.hora)])].sort();

    return {
      fecha,
      cierre,
      bloqueoDelDia: bloqueos.find((b) => !b.hora) || null,
      esHoy: fecha === momento.fecha,
      pasado: fecha < momento.fecha,
      totalCitas: citas.length,
      cupos: cierre ? 0 : new Set(deAtencion.map(bloque)).size * cfg.capacidadPorHora,
      horas: horas.map((hora) => {
        const citasDeLaHora = citas.filter((c) => c.hora === hora);
        const citasDelBloque = citas.filter((c) => bloque(c.hora) === bloque(hora));
        const bloqueo = bloqueos.find((b) => b.hora === hora) || null;
        const enHorario = deAtencion.includes(hora);
        const pasada = minutosHasta(fecha, hora, momento) < 0;
        const libres =
          cierre || bloqueo || !enHorario || pasada ? 0 : Math.max(0, cfg.capacidadPorHora - citasDelBloque.length);
        return { hora, citas: citasDeLaHora, bloqueo, enHorario, pasada, libres };
      }),
    };
  }

  // Semana desde el lunes indicado. El domingo solo aparece si tiene horario o citas.
  function semana(lunes) {
    return Array.from({ length: 7 }, (_, i) => dia(sumarDias(lunes, i))).filter(
      (d) => cfg.horario[diaSemana(d.fecha)] || d.totalCitas > 0
    );
  }

  // Horas que el bot puede ofrecer en una fecha.
  function horasLibres(fecha) {
    const momento = ahora(reloj());
    return dia(fecha)
      .horas.filter((h) => h.libres > 0 && dentroDelPlazo(fecha, h.hora, momento))
      .map(({ hora, libres }) => ({ hora, libres }));
  }

  // Próximos días con al menos una hora libre (para la lista de días del bot).
  function diasConCupo(cantidad = 5) {
    const hoy = ahora(reloj()).fecha;
    const dias = [];
    for (let i = 0; i <= cfg.diasAdelante && dias.length < cantidad; i++) {
      const fecha = sumarDias(hoy, i);
      const horas = horasLibres(fecha);
      if (horas.length) dias.push({ fecha, horas: horas.length });
    }
    return dias;
  }

  function validar(datos) {
    const servicio = String(datos.servicio || '');
    if (!cfg.servicios[servicio]) throw new ErrorAgenda('DATOS', 'Elige un servicio.');
    if (!esFecha(datos.fecha)) throw new ErrorAgenda('DATOS', 'La fecha no es válida.');
    if (!esHora(datos.hora)) throw new ErrorAgenda('DATOS', 'La hora no es válida.');
    const cliente = textoOpcional(datos.cliente, 120);
    if (!cliente) throw new ErrorAgenda('DATOS', 'Escribe el nombre del cliente.');
    const telefono = normalizarTelefono(datos.telefono);
    if (telefono.length < 10 || telefono.length > 15) {
      throw new ErrorAgenda('DATOS', 'El teléfono debe tener entre 10 y 15 dígitos.');
    }
    const placa = String(datos.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null;
    return {
      servicio,
      fecha: datos.fecha,
      hora: datos.hora,
      cliente,
      telefono,
      vehiculo: textoOpcional(datos.vehiculo, 120),
      placa,
      notas: textoOpcional(datos.notas, 1000),
      kommoLead: /^\d+$/.test(String(datos.kommoLead || '')) ? String(datos.kommoLead) : null,
    };
  }

  // Reserva una cita. "forzar" permite agendar aunque la hora esté llena, bloqueada o fuera de horario.
  function reservar(datos, { origen = 'MANUAL', forzar = false } = {}) {
    const c = validar(datos);
    db.exec('BEGIN IMMEDIATE');
    try {
      const ocupados = sql.puestosOcupados.all(c.fecha, bloque(c.hora)).map((r) => r.puesto);
      if (!forzar) {
        const d = dia(c.fecha);
        const h = d.horas.find((x) => x.hora === c.hora);
        if (d.cierre) throw new ErrorAgenda('CERRADO', `Ese día no hay citas (${d.cierre.toLowerCase()}).`);
        if (!h || !h.enHorario) throw new ErrorAgenda('CERRADO', 'Esa hora está fuera del horario de citas.');
        if (h.bloqueo) throw new ErrorAgenda('CERRADO', 'Esa hora está bloqueada.');
        if (origen === 'BOT' && !dentroDelPlazo(c.fecha, c.hora, ahora(reloj()))) {
          throw new ErrorAgenda('FUERA_DE_PLAZO', 'Esa hora ya no se puede agendar.');
        }
        if (ocupados.length >= cfg.capacidadPorHora) throw new ErrorAgenda('LLENO', 'Esa hora ya está llena.');
      }
      let puesto = 1;
      while (ocupados.includes(puesto)) puesto++;
      const cita = sql.insertar.get(
        c.servicio, c.fecha, c.hora, puesto, c.cliente, c.telefono, c.vehiculo, c.placa, c.notas, origen, c.kommoLead
      );
      db.exec('COMMIT');
      return cita;
    } catch (err) {
      db.exec('ROLLBACK');
      if (/UNIQUE/.test(err.message)) throw new ErrorAgenda('LLENO', 'Esa hora se acaba de ocupar.');
      throw err;
    }
  }

  function cambiarEstado(id, estado) {
    if (!ESTADOS.includes(estado)) throw new ErrorAgenda('DATOS', 'Estado no válido.');
    let cita;
    try {
      cita = sql.cambiarEstado.get(estado, id);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) {
        throw new ErrorAgenda('LLENO', 'Ese horario ya lo ocupó otra cita. Agenda una cita nueva.');
      }
      throw err;
    }
    if (!cita) throw new ErrorAgenda('NO_EXISTE', 'La cita no existe.');
    return cita;
  }

  function bloquear({ fecha, hora, motivo }) {
    if (!esFecha(fecha)) throw new ErrorAgenda('DATOS', 'La fecha no es válida.');
    if (hora && !esHora(hora)) throw new ErrorAgenda('DATOS', 'La hora no es válida.');
    return sql.bloquear.get(fecha, hora || null, textoOpcional(motivo, 200));
  }

  return {
    dia,
    semana,
    horasLibres,
    diasConCupo,
    reservar,
    cambiarEstado,
    cancelar: (id) => cambiarEstado(id, 'CANCELADA'),
    bloquear,
    desbloquear: (id) => sql.desbloquear.get(id) || null,
    cita: (id) => sql.cita.get(id) || null,
    // Copia completa de los datos, para descargar como respaldo.
    exportar: () => ({ citas: sql.todasLasCitas.all(), bloqueos: sql.todosLosBloqueos.all() }),
    servicios: cfg.servicios,
  };
}

module.exports = { crearAgenda, ErrorAgenda, ESTADOS, normalizarTelefono };
