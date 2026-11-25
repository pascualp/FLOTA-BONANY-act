// Lo común de las funciones de Vercel de la flota (reporte diario y agente de Telegram).
// La carpeta empieza por «_»: Vercel no la publica como función.
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
// «.js» aunque sea .ts: en Vercel corren como módulos ES de Node y sin extensión no los encuentra.
import { getAllAlerts, parseEsDate, TRAMITES } from '../../src/utils.js';
import type { Alert, Vehicle } from '../../src/types.js';

export const BASE_DE_DATOS = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8'; // = firestoreDatabaseId de firebase-applet-config.json
export const URL_APP = 'https://flota-bonany-act-wine.vercel.app';
export { TRAMITES };

// ---------- Firebase (cuenta de servicio reporte-flota: lee y escribe datos, nada más) ----------
export function firebaseAdmin(): App {
  const existente = getApps()[0];
  if (existente) return existente;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT en el servidor');
  return initializeApp({ credential: cert(JSON.parse(json)) });
}

export const db = (): Firestore => getFirestore(firebaseAdmin(), BASE_DE_DATOS);

export async function cargarFlota(): Promise<Vehicle[]> {
  const snap = await db().collection('vehicles').get();
  // Los dados de baja (campo «baja») no cuentan: ni en el reporte ni en el agente.
  return (snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Vehicle[]).filter((v) => !v.baja);
}

// «9151 KWJ», «9151-kwj» → «9151KWJ»
export const normalizarMatricula = (m: unknown) => String(m ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function buscarVehiculo(flota: Vehicle[], matricula: unknown): Vehicle | undefined {
  const n = normalizarMatricula(matricula);
  return n ? flota.find((v) => normalizarMatricula(v.matricula) === n) : undefined;
}

// ---------- Fechas en hora de España ----------
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', ...opts });
export const hoyTexto = (d = new Date()) => fmt(d, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const hoyLargo = (d = new Date()) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Días desde hoy (España) hasta la fecha dd/MM/yyyy: 0 = hoy, 1 = mañana, -1 = ayer. null si no se entiende.
export function diasHasta(fecha: string): number | null {
  const d = parseEsDate(fecha);
  if (!d) return null;
  const [dd, mm, yyyy] = hoyTexto().split('/').map(Number);
  const hoy = Date.UTC(yyyy, mm - 1, dd);
  const objetivo = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((objetivo - hoy) / 86400000);
}

// ---------- Resumen de pendientes (lo usan el reporte y el agente) ----------
export interface Resumen {
  conCita: Alert[];   // con cita sacada, pendiente de llevar (salga vencido o no)
  vencidos: Alert[];  // vencidos SIN cita
  proximos: Alert[];  // próximos a vencer SIN cita
}

export function resumir(flota: Vehicle[]): Resumen {
  const alertas = getAllAlerts(flota) as Alert[];
  const conCita = alertas
    .filter((a) => a.cita)
    .sort((a, b) => (diasHasta(a.cita!.fecha) ?? 9999) - (diasHasta(b.cita!.fecha) ?? 9999));
  const sinCita = alertas.filter((a) => !a.cita);
  return {
    conCita,
    vencidos: sinCita.filter((a) => a.status.status === 'danger'),
    proximos: sinCita.filter((a) => a.status.status === 'warning'),
  };
}

// ---------- Telegram ----------
export async function tg(metodo: string, datos: Record<string, unknown>): Promise<any> {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en el servidor');
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
  return j.result;
}

// Telegram corta a 4096 caracteres: parte por líneas.
export async function enviarTexto(chatId: number | string, texto: string, extra: Record<string, unknown> = {}) {
  const trozos: string[] = [];
  let actual = '';
  for (const linea of texto.split('\n')) {
    if ((actual + '\n' + linea).length > 3900 && actual) { trozos.push(actual); actual = linea; }
    else actual = actual ? actual + '\n' + linea : linea;
  }
  if (actual) trozos.push(actual);
  let ultimo: any;
  for (const t of trozos) ultimo = await tg('sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  return ultimo;
}

// Nota de voz (multipart). Telegram la enseña como audio de voz si es OGG/Opus, MP3 o M4A.
export async function enviarVoz(chatId: number | string, audio: Buffer, mime: string, nombre: string, responderA?: number) {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en el servidor');
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('voice', new Blob([new Uint8Array(audio)], { type: mime }), nombre);
  if (responderA) fd.append('reply_parameters', JSON.stringify({ message_id: responderA, allow_sending_without_reply: true }));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: 'POST', body: fd });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram sendVoice: ${j.description || r.status}`);
  return j.result;
}

// Manda un archivo (PDF o foto) como documento de Telegram (multipart; el bot admite hasta 50 MB).
export async function enviarDocumentoTelegram(chatId: number | string, datos: Buffer, nombre: string, mime: string, pie?: string) {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en el servidor');
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('document', new Blob([new Uint8Array(datos)], { type: mime || 'application/octet-stream' }), nombre || 'documento');
  if (pie) { fd.append('caption', pie.slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: fd });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram sendDocument: ${j.description || r.status}`);
  return j.result;
}

export async function bajarArchivoTelegram(fileId: string): Promise<{ datos: Buffer; ruta: string }> {
  const f = await tg('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new Error(`No pude bajar el archivo de Telegram (${r.status})`);
  return { datos: Buffer.from(await r.arrayBuffer()), ruta: f.file_path };
}

export const escaparHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Chats de Telegram que pueden usar el bot (grupo + privados de Facu y Jordi), separados por comas.
export const chatsPermitidos = () =>
  new Set((process.env.TELEGRAM_CHATS || '').split(',').map((s) => s.trim()).filter(Boolean));
