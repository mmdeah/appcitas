// Guarda en qué paso va cada cliente que agenda por el bot (un registro por lead de Kommo).

const VIGENCIA_DIAS = 3; // una conversación abandonada se olvida después de 3 días

function crearConversaciones(db) {
  const sql = {
    leer: db.prepare(
      `SELECT datos FROM conversaciones WHERE lead = ? AND actualizada >= datetime('now', '-${VIGENCIA_DIAS} days')`
    ),
    guardar: db.prepare(`
      INSERT INTO conversaciones (lead, datos, actualizada) VALUES (?, ?, datetime('now'))
      ON CONFLICT (lead) DO UPDATE SET datos = excluded.datos, actualizada = excluded.actualizada`),
    borrar: db.prepare('DELETE FROM conversaciones WHERE lead = ?'),
  };

  return {
    leer(lead) {
      const fila = sql.leer.get(String(lead));
      return fila ? JSON.parse(fila.datos) : null;
    },
    guardar: (lead, datos) => sql.guardar.run(String(lead), JSON.stringify(datos)),
    borrar: (lead) => sql.borrar.run(String(lead)),
  };
}

module.exports = { crearConversaciones };
