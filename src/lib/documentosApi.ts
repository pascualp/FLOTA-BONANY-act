// Documentos desde la web: hablan con /api/documentos (el servidor da enlaces firmados de Google Cloud Storage).
// Desde el 25/11/2026 el archivo ya NO se guarda troceado en Firestore (eso agotó la cuota diaria de la base).
import { auth } from './firebase';
import type { Categoria } from '../documentos';

async function llamar(cuerpo: Record<string, unknown>): Promise<any> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('No hay sesión: vuelve a entrar en la app');
  const r = await fetch('/api/documentos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// Tipo del archivo; algunos móviles no lo dicen y se deduce de la extensión.
export function tipoDe(file: File): string {
  if (file.type) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.heic')) return 'image/heic';
  return '';
}

// PUT al enlace firmado, con progreso (fetch no da progreso de subida; XMLHttpRequest sí).
function subirConProgreso(url: string, file: Blob, tipo: string, alProgreso?: (pct: number) => void): Promise<void> {
  return new Promise((ok, mal) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', tipo);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && alProgreso) alProgreso(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? ok() : mal(new Error(`El almacén respondió ${xhr.status}`)));
    xhr.onerror = () => mal(new Error('Sin conexión con el almacén de archivos'));
    xhr.send(file);
  });
}

export async function subirDocumento(vehicleId: string, file: File, categoria: Categoria, alProgreso?: (pct: number) => void) {
  const tipo = tipoDe(file);
  const { ruta, url } = await llamar({ accion: 'subir', vehicleId, nombre: file.name, tipo, size: file.size });
  await subirConProgreso(url, file, tipo, alProgreso);
  return llamar({ accion: 'registrar', vehicleId, ruta, nombre: file.name, tipo, categoria });
}

// Abre el documento en `ventana` (abierta ANTES de esperar al servidor, para que el navegador no la bloquee).
// Devuelve false si es un documento viejo (troceado en Firestore) que hay que bajar a la antigua.
export async function abrirDocumento(docId: string, ventana: Window | null): Promise<boolean> {
  const j = await llamar({ accion: 'bajar', docId });
  if (j.legado) return false;
  if (ventana && !ventana.closed) ventana.location.href = j.url;
  else window.open(j.url, '_blank');
  return true;
}

export const borrarDocumento = (docId: string) => llamar({ accion: 'borrar', docId });

// ---------- Foto real del vehículo (26/11/2026) ----------
// La foto del móvil pesa 3-5 MB y aquí se ve en pequeño: se reduce en el propio navegador a JPEG de 800 px de lado
// mayor (~100 KB). createImageBitmap con «from-image» respeta el giro que guarda el móvil (si no, salen tumbadas).
export async function reducirFoto(file: File, lado = 800): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('No se puede leer esa imagen. Si es de un iPhone (HEIC), hazla con la cámara desde la propia app.');
  }
  const k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bmp.width * k);
  lienzo.height = Math.round(bmp.height * k);
  lienzo.getContext('2d')!.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close();
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo preparar la foto'))), 'image/jpeg', 0.82));
}

// Sube la foto ya reducida a fotos/<id>.jpg (sustituye la que hubiera).
export async function subirFoto(vehicleId: string, foto: Blob, alProgreso?: (pct: number) => void) {
  const { url } = await llamar({ accion: 'fotoSubir', vehicleId, size: foto.size });
  await subirConProgreso(url, foto, 'image/jpeg', alProgreso);
  await llamar({ accion: 'fotoLista', vehicleId });
}

// Enlaces de todas las fotos reales de una vez: id del vehículo → enlace (vale 12 horas).
export const pedirUrlsFotos = async (): Promise<Record<string, string>> => (await llamar({ accion: 'fotos' })).urls || {};
export const borrarFoto = (vehicleId: string) => llamar({ accion: 'fotoBorrar', vehicleId });
