// Pasa los documentos VIEJOS (archivo troceado en documents/<id>/chunks, o entero en «url») a Google Cloud Storage
// (bucket bonany-flota-documentos) y deja en Firestore solo la ficha con storagePath. 25/11/2026.
//
// Uso (desde la carpeta del proyecto):
//   node scripts/migrar-docs-viejos.cjs <clave-cuenta-servicio.json>          → SIMULACRO: no lee trozos ni escribe nada
//   node scripts/migrar-docs-viejos.cjs <clave-cuenta-servicio.json> hacer    → migra
//
// OJO CUOTA: la base (Firestore Enterprise, tope gratis diario) cobra ~1 unidad de lectura por cada 4 KB. Leer los trozos
// cuesta ~150 unidades por trozo de 600 KB. El simulacro calcula el total y NO se migra si pasa de LIMITE_UNIDADES.
// Hacerlo por la MAÑANA (la cuota se reinicia a las 9:00 de España), una sola vez.
//
// Por cada documento: lee el archivo → lo sube al almacén → lo vuelve a bajar del almacén y compara la huella (sha256) →
// solo entonces cambia la ficha (storagePath, url '', isChunked false, categoria, sha256) y borra los trozos.
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const BASE = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8';
const BUCKET = 'bonany-flota-documentos';
const LIMITE_UNIDADES = 30000;
const HACER = process.argv[3] === 'hacer';

const app = initializeApp({ credential: cert(require(require('path').resolve(process.argv[2]))) });
const db = getFirestore(app, BASE);
const bucket = getStorage(app).bucket(BUCKET);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bytesDeDataUrl = (s) => Buffer.from(s.slice(s.indexOf(',') + 1), 'base64');
const limpio = (n) => String(n || 'documento').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120);

// Tipo de los que no lo dicen en el nombre (comprobado a ojo el 25/11: las tres son la ficha técnica / tarjeta ITV).
const CATEGORIA_A_MANO = { '6830MFW.pdf': 'Ficha técnica', '9151KWJ.pdf': 'Ficha técnica', '8855JCY.pdf': 'Ficha técnica' };
const POR_NOMBRE = [
  [/PERMISO/, 'Permiso de circulación'], [/FICHA|FITXA|FICHE|TARJETA ITV/, 'Ficha técnica'], [/POLIZA|SEGURO|\bPOL\b/, 'Póliza'],
  [/TACOGRAF/, 'Tacógrafo'], [/\bATP\b|ATP_|_ATP/, 'ATP'], [/CARGA Y DESCARGA|CARREGA/, 'Carga y descarga'], [/\bITV\b/, 'ITV'],
];
function categoria(nombre) {
  if (CATEGORIA_A_MANO[nombre]) return CATEGORIA_A_MANO[nombre];
  const n = String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  for (const [re, c] of POR_NOMBRE) if (re.test(n)) return c;
  return 'Otro';
}

(async () => {
  // Solo campos pequeños (NO «url», que en los muy viejos lleva el archivo entero).
  const snap = await db.collection('documents').select('name', 'vehicleId', 'type', 'isChunked', 'totalChunks', 'storagePath', 'size').get();
  const viejos = snap.docs.filter((d) => !d.get('storagePath'));
  const unidades = viejos.reduce((s, d) => s + (d.get('isChunked') ? (d.get('totalChunks') || 1) * 150 : 300), 0);
  console.log(`${snap.size} documentos; ${viejos.length} viejos por migrar; lectura estimada ≈ ${unidades} unidades (límite ${LIMITE_UNIDADES}).`);
  for (const d of viejos) console.log(`  - ${d.get('name')} (${d.get('isChunked') ? d.get('totalChunks') + ' trozos' : 'en url'}) → ${categoria(d.get('name'))}`);
  if (!HACER) { console.log('\nSIMULACRO: no se ha leído ningún trozo ni escrito nada.'); return; }
  if (unidades > LIMITE_UNIDADES) { console.log('PARO: se pasaría del límite de lectura.'); process.exitCode = 1; return; }

  let ok = 0, problemas = 0;
  for (const d of viejos) {
    const nombre = d.get('name');
    try {
      let datos;
      if (d.get('isChunked')) {
        const trozos = (await d.ref.collection('chunks').get()).docs.map((c) => c.data()).sort((a, b) => a.index - b.index);
        if (trozos.length !== d.get('totalChunks')) {
          console.log(`!! ${nombre}: ROTO (${trozos.length} de ${d.get('totalChunks')} trozos). No se toca: revisar a mano.`);
          problemas++; continue;
        }
        datos = bytesDeDataUrl(trozos.map((c) => c.data).join(''));
      } else {
        const url = (await d.ref.get()).get('url');
        if (!url) { console.log(`!! ${nombre}: sin archivo. No se toca.`); problemas++; continue; }
        datos = bytesDeDataUrl(url);
      }
      const h = sha(datos);
      const ruta = `vehiculos/${d.get('vehicleId')}/${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${limpio(nombre)}`;
      const f = bucket.file(ruta);
      await f.save(datos, { contentType: d.get('type') || 'application/pdf', resumable: false });
      const [vuelta] = await f.download();
      if (sha(vuelta) !== h) { await f.delete({ ignoreNotFound: true }); console.log(`XX ${nombre}: no cuadra en el almacén. No se toca.`); problemas++; continue; }
      await d.ref.update({
        storagePath: ruta, url: '', isChunked: false, totalChunks: FieldValue.delete(), size: datos.length, sha256: h,
        categoria: categoria(nombre), migrado: FieldValue.serverTimestamp(),
      });
      const refs = await d.ref.collection('chunks').listDocuments();
      for (let i = 0; i < refs.length; i += 400) { const lote = db.batch(); refs.slice(i, i + 400).forEach((r) => lote.delete(r)); await lote.commit(); }
      console.log(`OK ${nombre} → ${ruta} (${Math.round(datos.length / 1024)} KB, huella comprobada, ${refs.length} trozos borrados)`);
      ok++;
    } catch (e) {
      console.log(`XX ${nombre}: ${e.message}`); problemas++;
      if (/RESOURCE_EXHAUSTED|Quota/i.test(e.message)) { console.log('PARO: cuota de la base agotada.'); break; }
    }
  }
  console.log(`\nMigrados: ${ok} · problemas: ${problemas}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
