// Crea la incidencia pendiente de cada reparación que tiene un aviso del taller («notas») y todavía no la tiene
// (26/11/2026: las reparaciones importadas el 25/11 son anteriores a las incidencias).
// Uso: node scripts/incidencias-desde-reparaciones.cjs <clave.json>          → SIMULACRO
//      node scripts/incidencias-desde-reparaciones.cjs <clave.json> hacer    → crea
// Ojo: si el aviso ya se arregló (otra reparación posterior lo resolvió), márcala luego como «Resuelta» en la web.
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const BASE = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8';
const HACER = process.argv[3] === 'hacer';

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
const db = getFirestore(initializeApp({ credential: cert(require(path.resolve(process.argv[2]))) }), BASE);

(async () => {
  const vehs = (await db.collection('vehicles').select('matricula', 'baja', 'incidencias', 'historial', 'ultimaReparacion').get()).docs
    .filter((d) => d.get('ultimaReparacion'));
  let n = 0;
  for (const v of vehs) {
    const todas = (await v.ref.collection('reparaciones').select('notas', 'fecha', 'taller', 'factura', 'que').get()).docs;
    const reps = todas.filter((r) => r.get('notas'));
    const hay = Array.isArray(v.get('incidencias')) ? [...v.get('incidencias')] : [];
    const nuevas = [];
    for (const r of reps) {
      if (hay.some((x) => x.repId === r.id)) continue;
      const arreglo = arregladaPor(r.get('notas'), r.get('fecha'), todas.map((x) => ({ fecha: x.get('fecha'), que: x.get('que') })));
      if (arreglo) { console.log(`=  ${v.get('matricula')}: «${r.get('notas')}» ya lo arregló la reparación del ${arreglo.fecha} (${arreglo.que})`); continue; }
      const i = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), texto: String(r.get('notas')).trim().slice(0, 300),
        fecha: r.get('fecha'), origen: `${r.get('taller') || 'taller'}${r.get('factura') ? ', factura ' + r.get('factura') : ''}`.slice(0, 120), repId: r.id };
      nuevas.push(i); hay.push(i);
      console.log(`${HACER ? 'OK' : '+ '} ${v.get('matricula')}: «${i.texto}» (${i.fecha} · ${i.origen})`);
    }
    if (!nuevas.length) continue;
    n += nuevas.length;
    if (!HACER) continue;
    const cambio = { cuando: new Date().toISOString(), por: 'Claude (avisos de facturas → incidencias)', que: `Incidencia: ${nuevas.map((x) => x.texto).join('; ')}`.slice(0, 300) };
    await v.ref.update({ incidencias: hay, historial: [cambio, ...(v.get('historial') || [])].slice(0, 15) });
  }
  console.log(`\n${HACER ? 'Creadas' : 'Se crearían'}: ${n}`);
})().then(() => process.exit(0)).catch((e) => { console.error('ERROR', e.message); process.exit(1); });
