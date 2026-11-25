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
const CAMPOS = ['aseguradora', 'poliza', 'vencimientoSeguro', 'proximaITV', 'vencimientoATP', 'revisionTacografo'];
const HISTORIAL_MAX = 15;
const [, , clave, lista, accion, soloConfianza] = process.argv;
const HACER = accion === 'hacer';

const app = initializeApp({ credential: cert(require(path.resolve(clave))) });
const db = getFirestore(app, BASE);
const { cambios } = require(path.resolve(lista));
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
    for (const k of CAMPOS) {
      if (!(k in c)) continue;
      const antes = String(v.get(k) ?? '');
      if (antes.trim() === String(c[k]).trim()) continue;
      upd[k] = c[k];
      lineas.push(`${k}: ${antes || '—'} → ${c[k]}`);
    }
    if (!lineas.length) { iguales++; continue; }
    console.log(`${HACER ? 'OK' : '+ '} ${mat} [${c.confianza}] ${lineas.join(' · ')}\n     (${c.motivo})`);
    if (!HACER) continue;
    const cambio = { cuando: new Date().toISOString(), por: 'Papeles del servidor (Claude, 25/11/2026)', que: `${lineas.join('; ')}. ${c.motivo}`.slice(0, 300) };
    upd.historial = [cambio, ...(v.get('historial') || [])].slice(0, HISTORIAL_MAX);
    await v.ref.update(upd);
    aplicados++;
  }
  console.log(`\n${HACER ? 'Aplicados' : 'Se aplicarían'}: ${HACER ? aplicados : Object.keys(cambios).length - iguales - problemas} · ya estaban igual: ${iguales} · problemas: ${problemas}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
