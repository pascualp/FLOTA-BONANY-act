import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { db, firebaseAdmin } from './_lib/flota.js';
import { AVISO_CUOTA, borrar, esCuotaAgotada, esRutaDe, rutaNueva, tamano, urlDescarga, urlSubida } from './_lib/archivos.js';
import { esCategoria, MAX_BYTES, TIPOS_ARCHIVO } from '../src/documentos.js';

// Documentos de los vehículos desde la web (/api/documentos), solo con sesión de Google (no anónima), como la app.
// El archivo va a Google Cloud Storage (bucket privado) y en Firestore solo queda su ficha. Acciones (POST JSON):
//   subir     {vehicleId, nombre, tipo, size}                 → {ruta, url}  enlace de 15 min para que el navegador haga PUT
//   registrar {vehicleId, ruta, nombre, tipo, categoria}      → {id}         comprueba que el archivo llegó y crea la ficha
//   bajar     {docId}                                          → {url} enlace de 10 min, o {legado:true} si es de los viejos
//   borrar    {docId}                                          → {ok}  borra el archivo, sus trozos viejos y la ficha

const texto = (s: unknown, max = 200) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

export default async function documentos(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  let quien = '';
  try {
    const aut: string = req.headers?.authorization || '';
    if (!aut.startsWith('Bearer ')) throw new Error('sin token');
    const t = await getAuth(firebaseAdmin()).verifyIdToken(aut.slice('Bearer '.length));
    if (t.firebase?.sign_in_provider === 'anonymous') throw new Error('anónimo');
    quien = t.email || t.uid;
  } catch {
    return res.status(401).json({ error: 'Sesión no válida: vuelve a entrar en la app' });
  }

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  try {
    switch (b.accion) {
      case 'subir': {
        const vehicleId = texto(b.vehicleId, 60);
        const nombre = texto(b.nombre, 150) || 'documento';
        const tipo = texto(b.tipo, 60);
        const size = Number(b.size);
        if (!vehicleId) return res.status(400).json({ error: 'Falta el vehículo' });
        if (!TIPOS_ARCHIVO.includes(tipo)) return res.status(400).json({ error: `Tipo de archivo no admitido (${tipo || 'desconocido'}): solo PDF o fotos` });
        if (!(size > 0) || size > MAX_BYTES) return res.status(400).json({ error: 'El archivo pesa más de 25 MB' });
        if (!(await db().collection('vehicles').doc(vehicleId).get()).exists) return res.status(404).json({ error: 'Ese vehículo no existe' });
        const ruta = rutaNueva(vehicleId, nombre);
        return res.status(200).json({ ruta, url: await urlSubida(ruta, tipo) });
      }

      case 'registrar': {
        const vehicleId = texto(b.vehicleId, 60);
        const ruta = b.ruta;
        if (!esRutaDe(ruta, vehicleId)) return res.status(400).json({ error: 'Ruta de archivo no válida' });
        const size = await tamano(ruta);
        if (size === null) return res.status(400).json({ error: 'El archivo no llegó al almacén: vuelve a subirlo' });
        const categoria = esCategoria(b.categoria) ? b.categoria : 'Otro';
        const ref = await db().collection('documents').add({
          vehicleId, name: texto(b.nombre, 150) || 'documento', type: texto(b.tipo, 60), size, categoria,
          url: '', isChunked: false, storagePath: ruta,
          uploadedAt: FieldValue.serverTimestamp(), subidoPor: `Web · ${quien}`,
        });
        console.log(`[documentos] ${quien} subió ${ruta} (${size} B, ${categoria})`);
        return res.status(200).json({ id: ref.id });
      }

      case 'bajar': {
        const snap = await db().collection('documents').doc(texto(b.docId, 60) || 'x').get();
        if (!snap.exists) return res.status(404).json({ error: 'Ese documento ya no existe' });
        const ruta = snap.get('storagePath');
        if (!ruta) return res.status(200).json({ legado: true });
        return res.status(200).json({ url: await urlDescarga(ruta, snap.get('name')) });
      }

      case 'borrar': {
        const ref = db().collection('documents').doc(texto(b.docId, 60) || 'x');
        const snap = await ref.get();
        if (!snap.exists) return res.status(200).json({ ok: true });
        const ruta = snap.get('storagePath');
        if (ruta) await borrar(ruta);
        // Los documentos viejos tenían el archivo troceado en /chunks: se borran sin leerlos (listDocuments no baja datos).
        const trozos = await ref.collection('chunks').listDocuments();
        for (let i = 0; i < trozos.length; i += 400) {
          const lote = db().batch();
          trozos.slice(i, i + 400).forEach((t) => lote.delete(t));
          await lote.commit();
        }
        await ref.delete();
        console.log(`[documentos] ${quien} borró «${snap.get('name')}» (${ruta || trozos.length + ' trozos'})`);
        return res.status(200).json({ ok: true });
      }
    }
    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (e: any) {
    if (esCuotaAgotada(e)) return res.status(503).json({ error: AVISO_CUOTA, cuota: true });
    console.error('[documentos] error:', e);
    return res.status(500).json({ error: e?.message || 'Error en el servidor' });
  }
}
