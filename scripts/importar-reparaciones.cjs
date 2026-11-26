// Importa reparaciones a la flota desde una lista JSON: facturas de taller escaneadas (con su PDF) o, más adelante, el
// histórico que se saque de Winclass (sin archivo). 25/11/2026, Facu: «un historial de las reparaciones y qué se le ha
// hecho; te mandaremos fotos de las facturas y un histórico de Winclass».
//
// Uso (desde la carpeta del proyecto):
//   node scripts/importar-reparaciones.cjs <clave.json> <lista.json>          → SIMULACRO (no escribe nada)
//   node scripts/importar-reparaciones.cjs <clave.json> <lista.json> hacer    → importa
//
// Cada elemento de la lista: { matricula, fecha (dd/mm/aaaa), taller, factura, que, importe, km, notas,
//   archivo (ruta a un PDF o foto de la factura, opcional), origen ('escaneo' | 'winclass'), ref (opcional) }
// - No se importa dos veces: «ref» (por defecto «matrícula|fecha|nº factura») se busca en las reparaciones del vehículo.
// - El archivo va al almacén (bucket bonany-flota-documentos) como «Factura de taller»: se sube, se vuelve a bajar y se
//   compara la huella antes de crear la ficha. En la base solo va la ficha (nada de trozos).
// Lecturas: los vehículos (campos pequeños) y las reparaciones de los vehículos que salen en la lista.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const BASE = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8';
const BUCKET = 'bonany-flota-documentos';
const HISTORIAL_MAX = 15;
const MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const [, , clave, listaRuta, accion] = process.argv;
const HACER = accion === 'hacer';

const app = initializeApp({ credential: cert(require(path.resolve(clave))) });
const db = getFirestore(app, BASE);
const bucket = getStorage(app).bucket(BUCKET);
const lista = JSON.parse(fs.readFileSync(listaRuta, 'utf8'));
const norm = (m) => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const diaDe = (f) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

// ¿Una reparación POSTERIOR ya arregla el aviso? Copia de arregladaPor() de src/incidencias.ts (Facu 26/11: «si algo se
// arregló, no me lo pongas como incidencia»). Si cambias una, cambia la otra.
const NO_CUENTAN = new Set(['delan', 'trase', 'cambi', 'nuevo', 'nueva', 'revis', 'izqui', 'derec', 'compr', 'hacer', 'falta', 'queda', 'antes', 'despu']);
const clavesDe = (t) => new Set(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/)
  .filter((w) => w.length >= 5).map((w) => w.slice(0, 5)).filter((w) => !NO_CUENTAN.has(w)));
const aDia = (f) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
function arregladaPor(texto, fecha, reps) {
  const c = clavesDe(texto); if (!c.size) return undefined;
  return reps.filter((r) => aDia(r.fecha) > aDia(fecha)).sort((a, b) => aDia(a.fecha).localeCompare(aDia(b.fecha)))
    .find((r) => [...clavesDe(r.que)].some((k) => c.has(k)));
}
const euros = (n) => (n == null ? '' : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }));

(async () => {
  // 'incidencias' hace falta: sin ella se leería [] y al guardar se BORRARÍAN las que ya tiene el vehículo.
  const vehs = (await db.collection('vehicles').select('matricula', 'baja', 'historial', 'ultimaReparacion', 'incidencias').get()).docs;
  const yaHay = new Map();     // id vehículo → Set de ref ya importadas
  const previas = new Map();   // id vehículo → reparaciones que ya tiene (para ver si un aviso ya se arregló)
  let nuevas = 0, repetidas = 0, problemas = 0;
  const resumen = new Map();   // id vehículo → { n, desde, hasta } de lo importado en bloque (Winclass)
  for (const r of lista) {
    const mat = norm(r.matricula);
    const vs = vehs.filter((d) => norm(d.get('matricula')) === mat);
    const activos = vs.filter((d) => !d.get('baja'));
    const v = activos.length === 1 ? activos[0] : vs.length === 1 ? vs[0] : null;
    if (!v) { console.log(`!! ${mat}: ${vs.length} fichas → no se toca («${r.que}»)`); problemas++; continue; }
    if (!diaDe(r.fecha) || !r.que) { console.log(`!! ${mat}: falta la fecha o qué se hizo → no se toca`); problemas++; continue; }
    // Misma regla que refReparacion() de src/reparaciones.ts (matrícula|fecha|nº factura): así una factura que ya llegó
    // por Telegram no se importa otra vez. Sin nº de factura, también el texto (para no juntar dos distintas).
    const limpio = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9/]/g, '');
    const ref = r.ref || [mat, r.fecha, r.factura || r.que].map(limpio).join('|');
    if (!yaHay.has(v.id)) {
      const s = await v.ref.collection('reparaciones').select('ref', 'fecha', 'que').get();
      yaHay.set(v.id, new Set(s.docs.map((d) => d.get('ref')).filter(Boolean)));
      previas.set(v.id, s.docs.map((d) => ({ fecha: d.get('fecha'), que: d.get('que') })));
    }
    if (yaHay.get(v.id).has(ref)) { console.log(`=  ${mat} ${r.fecha} ${r.taller} ${r.factura}: ya estaba`); repetidas++; continue; }
    if (r.archivo && !fs.existsSync(r.archivo)) { console.log(`!! ${mat}: NO EXISTE el archivo ${r.archivo}`); problemas++; continue; }
    const linea = `${mat} ${r.fecha} · ${r.taller || '—'} · ${r.que} · ${euros(r.importe)}${r.km ? ` · ${r.km} km` : ''}${r.archivo ? ' · con factura' : ''}`;
    nuevas++;
    yaHay.get(v.id).add(ref);
    // Aviso del taller («queda pendiente…»): si una reparación POSTERIOR (ya guardada o de esta misma lista) lo
    // arregla, NO es incidencia (Facu 26/11). Se calcula antes del simulacro para que se vea también en él.
    const posteriores = [...(previas.get(v.id) || []), ...lista.filter((x) => norm(x.matricula) === mat && x !== r)];
    const arreglo = r.notas ? arregladaPor(r.notas, r.fecha, posteriores) : undefined;
    const avisoTxt = !r.notas ? '' : arreglo ? `   (aviso «${r.notas}»: ya lo arregló la reparación del ${arreglo.fecha} → sin incidencia)` : `   (aviso «${r.notas}» → incidencia pendiente)`;
    if (!HACER) { console.log(`+  ${linea}${avisoTxt ? '\n' + avisoTxt : ''}`); continue; }

    let documentoId = null;
    if (r.archivo) {
      const datos = fs.readFileSync(r.archivo);
      const ext = path.extname(r.archivo).toLowerCase();
      const nombre = `Factura ${r.taller || 'taller'} ${r.factura || ''} ${mat} ${diaDe(r.fecha)}${ext}`.replace(/\s+/g, ' ').trim();
      const destino = `vehiculos/${v.id}/${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_')}`;
      const f = bucket.file(destino);
      await f.save(datos, { contentType: MIME[ext] || 'application/pdf', resumable: false });
      const [vuelta] = await f.download();
      if (sha(vuelta) !== sha(datos)) { await f.delete({ ignoreNotFound: true }); console.log(`XX ${mat}: el archivo no cuadra en el almacén → no se importa`); problemas++; continue; }
      documentoId = (await db.collection('documents').add({
        vehicleId: v.id, name: nombre, type: MIME[ext] || 'application/pdf', size: datos.length, categoria: 'Factura de taller',
        sha256: sha(datos), url: '', isChunked: false, storagePath: destino, uploadedAt: FieldValue.serverTimestamp(),
        subidoPor: `Importación (${r.origen || 'escaneo'})`,
      })).id;
    }
    const repRef = await v.ref.collection('reparaciones').add({
      fecha: r.fecha, dia: diaDe(r.fecha), que: r.que, taller: r.taller || '', factura: r.factura || '',
      importe: typeof r.importe === 'number' ? r.importe : null, km: r.km || null, ...(r.notas ? { notas: r.notas } : {}),
      ...(documentoId ? { documentoId } : {}), origen: r.origen || 'escaneo', ref,
      creadoPor: 'Importación (Claude)', creado: FieldValue.serverTimestamp(),
    });
    // Última reparación (la más reciente) e historial del vehículo. El historial guarda solo los HISTORIAL_MAX últimos
    // cambios: en una importación masiva (origen «winclass», cientos de facturas) una línea por reparación BORRARÍA los
    // cambios de verdad (fechas, copia en el camión…). Por eso esas van en una sola línea por vehículo, al final.
    const enBloque = r.origen === 'winclass';
    const ult = v.get('ultimaReparacion');
    const masNueva = !ult || diaDe(r.fecha) > diaDe(ult);
    const cambio = { cuando: new Date().toISOString(), por: 'Importación de facturas (Claude)', que: `Reparación: ${r.fecha} · ${r.que} · ${euros(r.importe)}`.slice(0, 300) };
    const historial = enBloque ? null : [cambio, ...(v.get('historial') || [])].slice(0, HISTORIAL_MAX);
    if (enBloque) {
      const s = resumen.get(v.id) || { n: 0, desde: r.fecha, hasta: r.fecha };
      s.n++;
      if (diaDe(r.fecha) < diaDe(s.desde)) s.desde = r.fecha;
      if (diaDe(r.fecha) > diaDe(s.hasta)) s.hasta = r.fecha;
      resumen.set(v.id, s);
    }
    // Lo que el taller avisa que queda pendiente → incidencia del vehículo (sale cada mañana en Telegram).
    // Misma forma que src/incidencias.ts (nuevaIncidencia / conIncidencia).
    let incidencias;
    if (r.notas && !arreglo) {
      const hay = Array.isArray(v.get('incidencias')) ? v.get('incidencias') : [];
      const texto = String(r.notas).trim().slice(0, 300);
      if (!hay.some((x) => x.repId === repRef.id || String(x.texto).toLowerCase() === texto.toLowerCase())) {
        incidencias = [...hay, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), texto, fecha: r.fecha,
          origen: `${r.taller || 'taller'}${r.factura ? ', factura ' + r.factura : ''}`.slice(0, 120), repId: repRef.id }];
      }
    }
    const cambios = { ...(historial ? { historial } : {}), ...(masNueva ? { ultimaReparacion: r.fecha } : {}), ...(incidencias ? { incidencias } : {}) };
    if (Object.keys(cambios).length) {
      await v.ref.update(cambios);
      // Se vuelve a leer la ficha (1 lectura) para que la siguiente reparación del mismo vehículo parta de lo nuevo.
      vehs[vehs.indexOf(v)] = await v.ref.get();
    }
    console.log(`OK ${linea}${avisoTxt ? '\n' + avisoTxt : ''}`);
  }
  // Importación masiva: una línea de historial por vehículo con cuántas reparaciones entraron y de qué fechas.
  for (const [id, s] of resumen) {
    const ref = db.collection('vehicles').doc(id);
    const actual = await ref.get();
    const cambio = { cuando: new Date().toISOString(), por: 'Importación de facturas (Claude)',
      que: `Importadas ${s.n} ${s.n === 1 ? 'reparación' : 'reparaciones'} de Winclass (facturas del ${s.desde} al ${s.hasta})` };
    await ref.update({ historial: [cambio, ...(actual.get('historial') || [])].slice(0, HISTORIAL_MAX) });
    console.log(`H  ${actual.get('matricula')}: ${cambio.que}`);
  }
  console.log(`\n${HACER ? 'Importadas' : 'Se importarían'}: ${nuevas} · ya estaban: ${repetidas} · problemas: ${problemas}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
