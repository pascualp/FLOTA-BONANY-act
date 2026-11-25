// Archivos de la flota (PDF y fotos) en Google Cloud Storage, bucket privado «bonany-flota-documentos» (25/11/2026).
// ANTES iban troceados dentro de Firestore y eso agotó la cuota diaria de la base (que comparten Flotas y Abonos).
// Ahora en Firestore solo queda la ficha del documento (`documents`: nombre, tipo, tamaño, categoria, storagePath).
// El bucket no es público: se sube y se baja con enlaces firmados que caducan, que solo da el servidor.
import crypto from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { firebaseAdmin } from './flota.js';

export const BUCKET = 'bonany-flota-documentos';
export const bucket = () => getStorage(firebaseAdmin()).bucket(BUCKET);

// vehiculos/<id del vehículo>/<marca de tiempo>-<6 letras al azar>-<nombre limpio>
export function rutaNueva(vehicleId: string, nombre: string): string {
  const limpio = String(nombre || 'documento')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120) || 'documento';
  return `vehiculos/${vehicleId}/${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${limpio}`;
}

export const esRutaDe = (ruta: unknown, vehicleId: string) =>
  typeof ruta === 'string' && ruta.startsWith(`vehiculos/${vehicleId}/`) && !ruta.includes('..');

// Enlace para que el navegador suba el archivo directamente (PUT), válido 15 minutos y solo con ese tipo de archivo.
export async function urlSubida(ruta: string, tipo: string): Promise<string> {
  const [url] = await bucket().file(ruta).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 15 * 60e3, contentType: tipo });
  return url;
}

// Enlace para ver/descargar, válido 10 minutos; el navegador lo abre con su nombre de verdad.
export async function urlDescarga(ruta: string, nombre: string): Promise<string> {
  const [url] = await bucket().file(ruta).getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + 10 * 60e3,
    responseDisposition: `inline; filename*=UTF-8''${encodeURIComponent(nombre || 'documento')}`,
  });
  return url;
}

export async function guardar(ruta: string, datos: Buffer, tipo: string): Promise<void> {
  await bucket().file(ruta).save(datos, { contentType: tipo, resumable: false });
}

export async function leer(ruta: string): Promise<Buffer> {
  const [datos] = await bucket().file(ruta).download();
  return datos;
}

// Tamaño y tipo del archivo subido, o null si no está.
export async function metadatos(ruta: string): Promise<{ size: number; tipo: string } | null> {
  const f = bucket().file(ruta);
  const [existe] = await f.exists();
  if (!existe) return null;
  const [meta] = await f.getMetadata();
  return { size: Number(meta.size), tipo: String(meta.contentType || '') };
}

export async function tamano(ruta: string): Promise<number | null> {
  return (await metadatos(ruta))?.size ?? null;
}

export async function borrar(ruta: string): Promise<void> {
  await bucket().file(ruta).delete({ ignoreNotFound: true });
}

export const huella = (datos: Buffer) => crypto.createHash('sha256').update(datos).digest('hex');

// Aviso claro si la base de Firestore agota su cuota diaria (definido junto a la web, para que digan lo mismo).
export { AVISO_CUOTA, esCuotaAgotada } from '../../src/documentos.js';
