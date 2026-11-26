// Sube a la app la documentación en vigor de \\servidor\datos\Documentos\FLOTA\ACTUAL elegida a mano en
// seleccion-servidor-25nov.json (matrícula → carpeta y [archivo, tipo]). 25/11/2026, Facu: «verifica si hay
// documentación en el servidor y súbela a la aplicación para tenerla actualizada».
//
// Uso (desde la carpeta del proyecto, en el PC de la oficina, que ve \\servidor):
//   node scripts/subir-docs-servidor.cjs <clave.json> scripts/seleccion-servidor-25nov.json          → SIMULACRO
//   node scripts/subir-docs-servidor.cjs <clave.json> scripts/seleccion-servidor-25nov.json hacer    → sube
//
// El ARCHIVO va a Google Cloud Storage (bucket bonany-flota-documentos); en Firestore solo su ficha (pequeña):
// NO se gasta la cuota de la base con los archivos. No se sube lo que ya está (misma huella sha256 en la app).
// Cada archivo: se sube → se vuelve a bajar del almacén y se compara la huella → solo entonces se crea la ficha.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const BASE_DATOS = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8';
const BUCKET = 'bonany-flota-documentos';
const SERVIDOR = '//servidor/datos/Documentos/FLOTA/ACTUAL';
const HACER = process.argv[4] === 'hacer';
const CATEGORIA = {
  'ATP': 'ATP', 'ITV': 'ITV', 'FICHA TECNICA': 'Ficha técnica', 'PERMISO CIRCULACION': 'Permiso de circulación', 'POLIZA': 'Póliza',
  'TACOGRAFO': 'Tacógrafo', 'CARGA Y DESCARGA': 'Carga y descarga', 'CERT. CONFORMIDAD': 'Otro',
};
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const app = initializeApp({ credential: cert(require(path.resolve(process.argv[2]))) });
const db = getFirestore(app, BASE_DATOS);
const bucket = getStorage(app).bucket(BUCKET);
const SEL = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const norm = (m) => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const limpio = (n) => String(n || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120);

(async () => {
  const vehs = (await db.collection('vehicles').select('matricula', 'baja').get()).docs.filter((d) => !d.get('baja'));
  // Huellas de lo que ya hay (campo sha256 de las fichas: lo pone la migración y esta subida). Sin leer archivos.
  const ya = new Map((await db.collection('documents').select('sha256', 'name').get()).docs
    .filter((d) => d.get('sha256')).map((d) => [d.get('sha256'), d.get('name')]));
  console.log(`${HACER ? 'SUBIENDO' : 'SIMULACRO'} · ${vehs.length} vehículos en la flota · ${ya.size} documentos con huella en la app\n`);
  let nuevos = 0, repetidos = 0, problemas = 0, mb = 0;
  for (const [mat, { carpeta, docs }] of Object.entries(SEL)) {
    const v = vehs.filter((d) => norm(d.get('matricula')) === mat);
    if (v.length !== 1) { console.log(`!! ${mat}: ${v.length} fichas en la flota → no toco este vehículo`); problemas++; continue; }
    for (const [rel, codigo] of docs) {
      // «carpeta» puede ser una ruta completa (p. ej. papeles escaneados en la oficina) en vez de una del servidor.
      const ruta = /^([A-Za-z]:|\/\/)/.test(carpeta) ? `${carpeta}/${rel}` : `${SERVIDOR}/${carpeta}/${rel}`;
      const categoria = CATEGORIA[codigo] || 'Otro';
      if (!fs.existsSync(ruta)) { console.log(`!! ${mat} ${categoria}: NO EXISTE ${rel}`); problemas++; continue; }
      const datos = fs.readFileSync(ruta);
      const h = sha(datos);
      const nombre = path.basename(rel);
      if (ya.has(h)) { console.log(`=  ${mat} ${categoria.padEnd(24)} ya está en la app: «${ya.get(h)}»`); repetidos++; continue; }
      if (datos.length > 25 * 1024 * 1024) { console.log(`!! ${mat} ${categoria}: más de 25 MB`); problemas++; continue; }
      ya.set(h, nombre); nuevos++; mb += datos.length / 1048576;
      if (!HACER) { console.log(`+  ${mat} ${categoria.padEnd(24)} ${String(Math.round(datos.length / 1024)).padStart(6)} KB  ${nombre}`); continue; }
      const tipo = MIME[path.extname(nombre).toLowerCase()] || 'application/octet-stream';
      const destino = `vehiculos/${v[0].id}/${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${limpio(nombre)}`;
      const f = bucket.file(destino);
      await f.save(datos, { contentType: tipo, resumable: false });
      const [vuelta] = await f.download();
      if (sha(vuelta) !== h) { await f.delete({ ignoreNotFound: true }); console.log(`XX ${mat} ${nombre}: no cuadra en el almacén`); problemas++; continue; }
      await db.collection('documents').add({
        vehicleId: v[0].id, name: nombre, type: tipo, size: datos.length, categoria, sha256: h,
        url: '', isChunked: false, storagePath: destino, uploadedAt: FieldValue.serverTimestamp(),
        // Escaneos de la oficina (carpeta con ruta completa) ≠ papeles del servidor: que la ficha diga de dónde vienen.
        ...(ruta.startsWith(SERVIDOR)
          ? { subidoPor: 'Servidor FLOTA (Claude, 25/11/2026)', origen: `FLOTA/ACTUAL/${carpeta}/${rel}` }
          : { subidoPor: `Escaneado en la oficina (Claude, ${new Date().toLocaleDateString('es-ES')})`, origen: `escaneo: ${rel}` }),
      });
      console.log(`OK ${mat} ${categoria.padEnd(24)} ${String(Math.round(datos.length / 1024)).padStart(6)} KB  ${nombre}`);
    }
  }
  console.log(`\nNuevos: ${nuevos} (${mb.toFixed(1)} MB) · ya estaban: ${repetidos} · problemas: ${problemas}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
