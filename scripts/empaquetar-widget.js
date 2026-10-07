// Arma el .zip del widget para subirlo a Kommo (Ajustes → Integraciones → tu integración).
// Genera los 5 logos que pide Kommo y comprime todo solo con Node.  Uso: npm run widget

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CARPETA = path.join(__dirname, '..', 'kommo-widget');
const SALIDA = path.join(__dirname, '..', 'dist', 'agenda-del-taller-widget.zip');

// ---------- Logos: calendario blanco sobre verde ----------
const VERDE = [13, 107, 91, 255];
const BLANCO = [255, 255, 255, 255];

function dibujarLogo(ancho, alto) {
  const lado = Math.round(Math.min(ancho, alto) * 0.62);
  const izq = Math.round((ancho - lado) / 2);
  const arriba = Math.round((alto - lado) / 2);
  const borde = Math.max(2, Math.round(lado * 0.08));
  const cabecera = Math.round(lado * 0.26);
  const cuadro = Math.max(2, Math.round(lado * 0.13));

  return (x, y) => {
    const dx = x - izq;
    const dy = y - arriba;
    if (dx < 0 || dy < 0 || dx >= lado || dy >= lado) return VERDE;
    if (dx < borde || dx >= lado - borde || dy >= lado - borde || dy < cabecera) return BLANCO;
    // Cuadrícula de días: 3 columnas x 2 filas.
    const cuerpoAlto = lado - borde - cabecera;
    for (let fila = 0; fila < 2; fila++) {
      for (let col = 0; col < 3; col++) {
        const cx = borde + ((col + 1) * (lado - 2 * borde)) / 4 - cuadro / 2;
        const cy = cabecera + ((fila + 1) * cuerpoAlto) / 3 - cuadro / 2;
        if (dx >= cx && dx < cx + cuadro && dy >= cy && dy < cy + cuadro) return BLANCO;
      }
    }
    return VERDE;
  };
}

function png(ancho, alto) {
  const pintar = dibujarLogo(ancho, alto);
  const fila = ancho * 4 + 1;
  const crudo = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) Buffer.from(pintar(x, y)).copy(crudo, y * fila + 1 + x * 4);
  }
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.writeUInt8(8, 8); // 8 bits por canal
  ihdr.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', zlib.deflateSync(crudo)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Zip ----------
function zip(archivos) {
  const fechaDos = ((2026 - 1980) << 9) | (10 << 5) | 6;
  const partes = [];
  const central = [];
  let desplazamiento = 0;

  for (const { nombre, datos } of archivos) {
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const comprimido = zlib.deflateRawSync(datos);
    const crc = zlib.crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(fechaDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nombreBuf, comprimido);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(8, 10);
    entrada.writeUInt16LE(0, 12);
    entrada.writeUInt16LE(fechaDos, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(comprimido.length, 20);
    entrada.writeUInt32LE(datos.length, 24);
    entrada.writeUInt16LE(nombreBuf.length, 28);
    entrada.writeUInt32LE(desplazamiento, 42);
    central.push(entrada, nombreBuf);

    desplazamiento += local.length + nombreBuf.length + comprimido.length;
  }

  const centralBuf = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(centralBuf.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, centralBuf, fin]);
}

const leer = (ruta) => fs.readFileSync(path.join(CARPETA, ruta));
const archivos = [
  { nombre: 'manifest.json', datos: leer('manifest.json') },
  { nombre: 'script.js', datos: leer('script.js') },
  { nombre: 'i18n/es.json', datos: leer('i18n/es.json') },
  { nombre: 'i18n/en.json', datos: leer('i18n/en.json') },
  { nombre: 'images/logo_main.png', datos: png(400, 272) },
  { nombre: 'images/logo.png', datos: png(130, 100) },
  { nombre: 'images/logo_small.png', datos: png(108, 108) },
  { nombre: 'images/logo_medium.png', datos: png(240, 84) },
  { nombre: 'images/logo_min.png', datos: png(84, 84) },
];

// Que los JSON estén bien escritos antes de empaquetar.
for (const a of archivos.filter((x) => x.nombre.endsWith('.json'))) JSON.parse(a.datos.toString('utf8'));

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, zip(archivos));
console.log(`Widget listo: ${path.relative(process.cwd(), SALIDA)} (${archivos.length} archivos)`);
