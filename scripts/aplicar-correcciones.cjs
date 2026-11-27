// Aplica a la flota una lista de correcciones de datos (p. ej. scripts/correcciones-papeles-26nov.json, sacadas de los
// papeles del servidor). Cada cambio queda en el historial del vehículo con su motivo.
//
// Uso (desde la carpeta del proyecto):
//   node scripts/aplicar-correcciones.cjs <clave.json> scripts/correcciones-papeles-26nov.json            → SIMULACRO
//   node scripts/aplicar-correcciones.cjs <clave.json> scripts/correcciones-papeles-26nov.json hacer      → aplica
//   … hacer seguro   → aplica solo las de confianza «seguro» (el papel enseña el periodo en vigor)
//
// Lecturas: solo los campos pequeños de cada vehículo (~30 fichas). Escrituras: una por vehículo que cambia.
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const BASE = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8';
// bastidor y fechaMatriculacion desde el 26/11 (papeles escaneados: el 7695LXK y el 8855JCY los tenían mal).
// chofer desde el 27/11 (Facu: «ponle quién lo está llevando», según el conductor que sale en el GPS ControlGPS).
// km y aceite desde el 27/11 (Facu: «hay que ir poniendo los kilómetros para llevar un control»; ver src/aceite.ts).
// gps desde el 27/11: lo último leído del GPS (solo LECTURA del GPS). NO deja línea en el historial (si no, cada lectura
// del GPS echaría del historial los cambios de verdad, que guarda solo 15).
const CAMPOS = ['aseguradora', 'poliza', 'vencimientoSeguro', 'proximaITV', 'vencimientoATP', 'revisionTacografo', 'bastidor', 'fechaMatriculacion', 'chofer',
  'km', 'kmFecha', 'kmFuente', 'aceiteFecha', 'aceiteKm', 'aceiteFuente', 'aceiteCadaKm', 'aceiteCadaMeses', 'gps'];
const SIN_HISTORIAL = new Set(['gps']);
const texto = (x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x ?? ''));
const HISTORIAL_MAX = 15;
const [, , clave, lista, accion, soloConfianza] = process.argv;
const HACER = accion === 'hacer';

const app = initializeApp({ credential: cert(require(path.resolve(clave))) });
const db = getFirestore(app, BASE);
const { cambios, _por } = require(path.resolve(lista));
const POR = _por || 'Papeles del servidor (Claude, 25/11/2026)';   // lo que sale en el historial del vehículo
const norm = (m) => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

(async () => {
  const snap = await db.collection('vehicles').select('matricula', 'baja', 'historial', ...CAMPOS).get();
  let aplicados = 0, iguales = 0, problemas = 0;
  for (const [mat, c] of Object.entries(cambios)) {
    if (soloConfianza && c.confianza !== soloConfianza) continue;
    const vs = snap.docs.filter((d) => norm(d.get('matricula')) === mat && !d.get('baja'));
    if (vs.length !== 1) { console.log(`!! ${mat}: ${vs.length} fichas en la flota → no se toca`); problemas++; continue; }
    const v = vs[0];
    const upd = {};
    const lineas = [];
    const otros = [];   // los que no van al historial (gps)
    for (const k of CAMPOS) {
      if (!(k in c)) continue;
      const antes = texto(v.get(k));
      if (antes.trim() === texto(c[k]).trim()) continue;
      upd[k] = c[k];
      (SIN_HISTORIAL.has(k) ? otros : lineas).push(`${k}: ${antes || '—'} → ${texto(c[k])}`);
    }
    if (!lineas.length && !otros.length) { iguales++; continue; }
    console.log(`${HACER ? 'OK' : '+ '} ${mat} [${c.confianza}] ${[...lineas, ...otros].join(' · ').slice(0, 400)}\n     (${c.motivo})`);
    if (!HACER) continue;
    if (lineas.length) {
      const cambio = { cuando: new Date().toISOString(), por: POR, que: `${lineas.join('; ')}. ${c.motivo}`.slice(0, 300) };
      upd.historial = [cambio, ...(v.get('historial') || [])].slice(0, HISTORIAL_MAX);
    }
    await v.ref.update(upd);
    aplicados++;
  }
  console.log(`\n${HACER ? 'Aplicados' : 'Se aplicarían'}: ${HACER ? aplicados : Object.keys(cambios).length - iguales - problemas} · ya estaban igual: ${iguales} · problemas: ${problemas}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
