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
function subirConProgreso(url: string, file: File, tipo: string, alProgreso?: (pct: number) => void): Promise<void> {
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
