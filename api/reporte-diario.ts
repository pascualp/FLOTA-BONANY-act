import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
// «.js» aunque el archivo sea .ts: en Vercel la función corre como módulo ES de Node y sin extensión no lo encuentra.
import { getAllAlerts } from '../src/utils.js';
import type { Vehicle } from '../src/types.js';

// Reporte de vencimientos de la flota por correo (/api/reporte-diario).
// - Cada mañana lo llama el cron de Vercel (vercel.json) con «Authorization: Bearer CRON_SECRET».
// - El botón «Enviar Reporte Email» lo llama con el token de Firebase de quien ha entrado.
// Lee la flota con una cuenta de servicio de SOLO LECTURA y manda por Gmail (contraseña de aplicación).
//
// Variables de entorno (en Vercel, nunca en el repositorio):
//   FIREBASE_SERVICE_ACCOUNT  JSON de la cuenta de servicio (rol «Cloud Datastore Viewer»)
//   EMAIL_USER / EMAIL_PASS   cuenta de Gmail que envía y su contraseña de aplicación
//   CRON_SECRET               clave que Vercel manda en las llamadas del cron
//   REPORTE_PARA              destinatarios separados por comas (si falta: jordi@fruitesbonany.com)

const BASE_DE_DATOS = 'ai-studio-fleetflow-d05cc4cc-ab71-46f2-9a22-2419c0f125f8'; // = firestoreDatabaseId de firebase-applet-config.json
const PARA_POR_DEFECTO = 'jordi@fruitesbonany.com';
const URL_APP = 'https://flota-bonany-act-wine.vercel.app';

function firebaseAdmin(): App {
  const existente = getApps()[0];
  if (existente) return existente;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT en el servidor');
  return initializeApp({ credential: cert(JSON.parse(json)) });
}

const escapar = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function tabla(alertas: any[], color: string, fondo: string, borde: string) {
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${alertas.map((a) => `
    <tr style="background-color:${fondo};">
      <td style="padding:10px;font-weight:bold;color:#1e293b;border-bottom:1px solid ${borde};">${escapar(a.vehicle.matricula)}</td>
      <td style="padding:10px;color:#1e293b;border-bottom:1px solid ${borde};">${escapar(a.type)}</td>
      <td style="padding:10px;color:#64748b;border-bottom:1px solid ${borde};">${escapar(a.vehicle.chofer)}</td>
      <td style="padding:10px;color:${color};font-weight:bold;text-align:right;border-bottom:1px solid ${borde};">${escapar(a.date)}</td>
    </tr>`).join('')}
  </table>`;
}

function montarCorreo(vencidos: any[], proximos: any[], hoy: string) {
  const subject = `⚠️ Flotas Bonany ${hoy}: ${vencidos.length} vencidos / ${proximos.length} próximos a vencer`;
  const html = `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
    <h2 style="color:#1e293b;margin-top:0;">Trámites pendientes de la flota · ${escapar(hoy)}</h2>
    ${vencidos.length ? `<h3 style="color:#dc2626;margin-bottom:10px;">⚠️ VENCIDOS (${vencidos.length})</h3>${tabla(vencidos, '#dc2626', '#fef2f2', '#fee2e2')}` : ''}
    ${proximos.length ? `<h3 style="color:#d97706;margin-bottom:10px;">🔔 PRÓXIMOS A VENCER (${proximos.length})</h3>${tabla(proximos, '#d97706', '#fffbeb', '#fef3c7')}` : ''}
    <p style="margin-top:24px;"><a href="${URL_APP}" style="color:#2563eb;">Abrir la gestión de flotas</a></p>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
      Correo automático diario del Sistema de Gestión de Flotas Bonany.
    </div>
  </div>`;
  return { subject, html };
}

export default async function reporteDiario(req: any, res: any) {
  const autorizacion: string = req.headers?.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !!cronSecret && autorizacion === `Bearer ${cronSecret}`;

  try {
    const app = firebaseAdmin();

    // 1) Solo el cron o alguien que haya entrado en la app (no anónimo).
    let pedidoPor = 'cron diario';
    if (!esCron) {
      if (req.method !== 'POST' || !autorizacion.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
      }
      try {
        const token = await getAuth(app).verifyIdToken(autorizacion.slice('Bearer '.length));
        if (token.firebase?.sign_in_provider === 'anonymous') throw new Error('anónimo');
        pedidoPor = token.email || token.uid;
      } catch {
        return res.status(401).json({ error: 'Sesión no válida: vuelve a entrar en la app' });
      }
    }

    // 2) Leer la flota y calcular las alertas igual que la web.
    const snap = await getFirestore(app, BASE_DE_DATOS).collection('vehicles').get();
    const vehiculos = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Vehicle[];
    const alertas = getAllAlerts(vehiculos);
    const vencidos = alertas.filter((a) => a.status.status === 'danger');
    const proximos = alertas.filter((a) => a.status.status === 'warning');

    if (vencidos.length === 0 && proximos.length === 0) {
      console.log(`[reporte] ${pedidoPor}: nada pendiente, no se envía (${vehiculos.length} vehículos)`);
      return res.status(200).json({ enviado: false, motivo: 'No hay trámites pendientes', vehiculos: vehiculos.length });
    }

    // 3) Enviar. «?prueba=1» (solo con la clave del cron) lo manda a la propia cuenta que envía, no a Jordi.
    const { EMAIL_USER, EMAIL_PASS } = process.env;
    if (!EMAIL_USER || !EMAIL_PASS) throw new Error('Faltan EMAIL_USER / EMAIL_PASS en el servidor');
    const prueba = esCron && String(req.query?.prueba) === '1';
    const para = prueba ? EMAIL_USER : (process.env.REPORTE_PARA || PARA_POR_DEFECTO);

    const hoy = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' });
    const { subject, html } = montarCorreo(vencidos, proximos, hoy);
    const transporte = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
    const info = await transporte.sendMail({ from: `"Flotas Bonany" <${EMAIL_USER}>`, to: para, subject, html });

    console.log(`[reporte] ${pedidoPor}: enviado a ${para} (${vencidos.length} vencidos, ${proximos.length} próximos) ${info.messageId}`);
    return res.status(200).json({ enviado: true, para, vencidos: vencidos.length, proximos: proximos.length });
  } catch (error: any) {
    console.error('[reporte] error:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo enviar el reporte' });
  }
}
