// Memoria de la conversación por lead: guarda cada mensaje (del cliente y del taller) en la base,
// para que la IA tenga el contexto completo aunque la conversación anterior ya haya terminado.

function crearMemoria(db) {
  const sql = {
    agregar: db.prepare('INSERT INTO mensajes (lead, rol, texto) VALUES (?, ?, ?)'),
    ultimos: db.prepare('SELECT rol, texto, creado FROM mensajes WHERE lead = ? ORDER BY id DESC LIMIT ?'),
  };
  return {
    agregar(lead, rol, texto) {
      const t = String(texto || '').trim();
      if (lead && t) sql.agregar.run(String(lead), rol, t.slice(0, 2000));
    },
    // Los últimos mensajes del lead, del más viejo al más nuevo.
    ultimos: (lead, cuantos = 30) => (lead ? sql.ultimos.all(String(lead), cuantos).reverse() : []),
  };
}

module.exports = { crearMemoria };
