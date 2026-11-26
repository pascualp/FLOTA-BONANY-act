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
const db = getFirestore(initializeApp({ credential: cert(require(path.resolve(process.argv[2]))) }), BASE);

(async () => {
  const vehs = (await db.collection('vehicles').select('matricula', 'baja', 'incidencias', 'historial', 'ultimaReparacion').get()).docs
    .filter((d) => d.get('ultimaReparacion'));
  let n = 0;
  for (const v of vehs) {
    const reps = (await v.ref.collection('reparaciones').select('notas', 'fecha', 'taller', 'factura').get()).docs.filter((r) => r.get('notas'));
    const hay = Array.isArray(v.get('incidencias')) ? [...v.get('incidencias')] : [];
    const nuevas = [];
    for (const r of reps) {
      if (hay.some((x) => x.repId === r.id)) continue;
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
