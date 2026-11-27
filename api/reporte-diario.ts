import { getAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';
import {
  cargarFlota, diasHasta, enviarTexto, escaparHtml as esc, firebaseAdmin, hoyLargo, hoyTexto, resumir, URL_APP,
  type Resumen,
} from './_lib/flota.js';
import type { Alert } from '../src/types.js';
import { AVISO_SIN_ACCESO, tieneAcceso } from '../src/acceso.js';

// Reporte de vencimientos de la flota (/api/reporte-diario).
// - Cada mañana lo llama el cron de Vercel (vercel.json) con «Authorization: Bearer CRON_SECRET»: correo + Telegram.
// - El botón «Enviar Reporte Email» lo llama con el token de Firebase de quien ha entrado: solo correo.
// Las citas ya sacadas («pendiente de llevar») salen aparte y no cuentan como vencidas.
//
// Variables de entorno (en Vercel, nunca en el repositorio):
//   FIREBASE_SERVICE_ACCOUNT  JSON de la cuenta de servicio reporte-flota
//   EMAIL_USER / EMAIL_PASS   cuenta de Gmail que envía y su contraseña de aplicación
//   CRON_SECRET               clave que Vercel manda en las llamadas del cron
//   REPORTE_PARA              destinatarios del correo, separados por comas (si falta: jordi@fruitesbonany.com)
//   TELEGRAM_TOKEN / TELEGRAM_AVISOS  bot y chats (separados por comas) donde va el reporte por Telegram
//
// Pruebas (solo con la clave del cron): ?prueba=1 → correo a EMAIL_USER y nada por Telegram;
// ?soloTelegram=1 → solo Telegram.

const PARA_POR_DEFECTO = 'jordi@fruitesbonany.com';

// ---------- Correo ----------
function tabla(filas: { a: Alert; derecha: string }[], color: string, fondo: string, borde: string) {
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${filas.map(({ a, derecha }) => `
    <tr style="background-color:${fondo};">
      <td style="padding:10px;font-weight:bold;color:#1e293b;border-bottom:1px solid ${borde};">${esc(a.vehicle.matricula)}</td>
      <td style="padding:10px;color:#1e293b;border-bottom:1px solid ${borde};">${esc(a.type)}</td>
      <td style="padding:10px;color:#64748b;border-bottom:1px solid ${borde};">${esc(a.vehicle.chofer)}</td>
      <td style="padding:10px;color:${color};font-weight:bold;text-align:right;border-bottom:1px solid ${borde};">${derecha}</td>
    </tr>`).join('')}
  </table>`;
}

const citaCorta = (a: Alert) =>
  `${esc(a.cita!.fecha)}${a.cita!.hora ? ' ' + esc(a.cita!.hora) : ''}${a.cita!.lugar ? ' · ' + esc(a.cita!.lugar) : ''}`;

// Las fechas que FALTAN se agrupan en una línea por tipo («Falta la fecha de Seguro: 0313HBK, 1111KDV…»): cuando se
// añadió el seguro (25/11/2026) faltaba en todos, y una línea por vehículo llenaba el mensaje. Las que están mal
// escritas («00/00/00», «FALTA») sí van una a una, con lo que pone.
export function separarRevisar(revisar: Alert[]) {
  const faltan = new Map<string, string[]>();
  const malEscritas: Alert[] = [];
  for (const a of revisar) {
    if (a.status.text === 'Falta la fecha') faltan.set(a.type, [...(faltan.get(a.type) || []), a.vehicle.matricula]);
    else malEscritas.push(a);
  }
  return { faltan: [...faltan.entries()], malEscritas };
}

function montarCorreo({ conCita, vencidos, proximos, revisar, incidencias, aceite }: Resumen, hoy: string) {
  const { faltan, malEscritas } = separarRevisar(revisar);
  const subject = `⚠️ Flotas Bonany ${hoy}: ${vencidos.length} vencidos / ${proximos.length} próximos` +
    (conCita.length ? ` / ${conCita.length} con cita` : '') + (incidencias.length ? ` / ${incidencias.length} incidencias` : '') +
    (aceite.length ? ` / ${aceite.length} aceite` : '') + (revisar.length ? ` / ${revisar.length} fechas a revisar` : '');
  const html = `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">
    <h2 style="color:#1e293b;margin-top:0;">Trámites pendientes de la flota · ${esc(hoy)}</h2>
    ${conCita.length ? `<h3 style="color:#2563eb;margin-bottom:10px;">📅 CITAS SACADAS – pendientes de llevar (${conCita.length})</h3>${tabla(conCita.map((a) => ({ a, derecha: citaCorta(a) })), '#2563eb', '#eff6ff', '#dbeafe')}` : ''}
    ${vencidos.length ? `<h3 style="color:#dc2626;margin-bottom:10px;">⚠️ VENCIDOS (${vencidos.length})</h3>${tabla(vencidos.map((a) => ({ a, derecha: esc(a.date) })), '#dc2626', '#fef2f2', '#fee2e2')}` : ''}
    ${proximos.length ? `<h3 style="color:#d97706;margin-bottom:10px;">🔔 PRÓXIMOS A VENCER (${proximos.length})</h3>${tabla(proximos.map((a) => ({ a, derecha: esc(a.date) })), '#d97706', '#fffbeb', '#fef3c7')}` : ''}
    ${incidencias.length ? `<h3 style="color:#b45309;margin-bottom:10px;">🛠 INCIDENCIAS PENDIENTES (${incidencias.length})</h3><table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${
      incidencias.map(({ vehicle: v, incidencia: i }) => `<tr style="background-color:#fffbeb;"><td style="padding:10px;font-weight:bold;color:#1e293b;border-bottom:1px solid #fde68a;">${esc(v.matricula)}</td><td style="padding:10px;color:#1e293b;border-bottom:1px solid #fde68a;">${esc(i.texto)}</td><td style="padding:10px;color:#64748b;text-align:right;border-bottom:1px solid #fde68a;">${esc(i.fecha)}${i.origen ? ' · ' + esc(i.origen) : ''}</td></tr>`).join('')
    }</table>` : ''}
    ${aceite.length ? `<h3 style="color:#b91c1c;margin-bottom:10px;">🛢 ACEITE Y FILTROS (${aceite.length})</h3><table style="width:100%;border-collapse:collapse;margin-bottom:20px;">${
      aceite.map(({ vehicle: v, estado: e }) => `<tr style="background-color:${e.status === 'danger' ? '#fef2f2' : '#fffbeb'};"><td style="padding:10px;font-weight:bold;color:#1e293b;border-bottom:1px solid #fee2e2;">${esc(v.matricula)}</td><td style="padding:10px;color:#1e293b;border-bottom:1px solid #fee2e2;">${esc(e.frase)}</td><td style="padding:10px;color:#64748b;border-bottom:1px solid #fee2e2;">${esc(v.chofer)}</td></tr>`).join('')
    }</table>` : ''}
    ${revisar.length ? `<h3 style="color:#475569;margin-bottom:4px;">❓ FECHAS QUE HAY QUE REVISAR (${revisar.length})</h3><p style="margin:0 0 10px;color:#64748b;font-size:13px;">Faltan o están escritas de forma que no se entiende: ponlas bien en la app para que avise a tiempo.</p>${
      faltan.map(([tipo, mats]) => `<p style="margin:0 0 8px;color:#334155;font-size:14px;"><b>Falta la fecha de ${esc(tipo)}</b> (${mats.length}): ${mats.map(esc).join(', ')}</p>`).join('')
    }${malEscritas.length ? tabla(malEscritas.map((a) => ({ a, derecha: '«' + esc(a.date) + '»' })), '#475569', '#f8fafc', '#e2e8f0') : ''}` : ''}
    <p style="margin-top:24px;"><a href="${URL_APP}" style="color:#2563eb;">Abrir la gestión de flotas</a></p>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
      Correo automático diario del Sistema de Gestión de Flotas Bonany.
    </div>
  </div>`;
  return { subject, html };
}

async function enviarCorreo(para: string, r: Resumen) {
  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) throw new Error('Faltan EMAIL_USER / EMAIL_PASS en el servidor');
  const { subject, html } = montarCorreo(r, hoyTexto());
  const transporte = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
  const info = await transporte.sendMail({ from: `"Flotas Bonany" <${EMAIL_USER}>`, to: para, subject, html });
  return info.messageId;
}

// ---------- Telegram ----------
const lineaCita = (a: Alert) =>
  `• <b>${esc(a.vehicle.matricula)}</b> ${esc(a.type)} → ${citaCorta(a)}`;
const lineaAlerta = (a: Alert) =>
  `• <b>${esc(a.vehicle.matricula)}</b> ${esc(a.type)} — ${esc(a.date)}${a.vehicle.chofer ? ` (${esc(a.vehicle.chofer)})` : ''}`;

export function textoTelegram({ conCita, vencidos, proximos, revisar, incidencias, aceite }: Resumen) {
  const dias = (a: Alert) => diasHasta(a.cita!.fecha);
  const hoy = conCita.filter((a) => dias(a) === 0);
  const manana = conCita.filter((a) => dias(a) === 1);
  const pasadas = conCita.filter((a) => (dias(a) ?? 0) < 0);
  const resto = conCita.filter((a) => (dias(a) ?? 99) > 1);
  const L = [`🚚 <b>Flotas Bonany</b> · ${esc(hoyLargo())}`];
  if (hoy.length) L.push('', '🔔 <b>HOY hay que llevar:</b>', ...hoy.map(lineaCita));
  if (manana.length) L.push('', '🔔 <b>MAÑANA hay que llevar:</b>', ...manana.map(lineaCita));
  if (pasadas.length) L.push('', '❓ <b>Cita ya pasada, ¿se hizo?</b> Decidme la fecha nueva:', ...pasadas.map(lineaCita));
  if (resto.length) L.push('', '📅 <b>Citas sacadas, pendientes de llevar:</b>', ...resto.map(lineaCita));
  if (vencidos.length) L.push('', `⚠️ <b>VENCIDOS sin cita (${vencidos.length}):</b>`, ...vencidos.map(lineaAlerta));
  if (proximos.length) L.push('', `🔔 <b>Próximos a vencer (${proximos.length}):</b>`, ...proximos.map(lineaAlerta));
  if (incidencias.length) L.push('', `🛠 <b>Incidencias pendientes (${incidencias.length}):</b>`,
    ...incidencias.map(({ vehicle: v, incidencia: i }) => `• <b>${esc(v.matricula)}</b> ${esc(i.texto)} <i>(${esc(i.fecha)}${i.origen ? ' · ' + esc(i.origen) : ''})</i>`));
  if (aceite.length) L.push('', `🛢 <b>Aceite y filtros (${aceite.length}):</b>`,
    ...aceite.map(({ vehicle: v, estado: e }) => `• <b>${esc(v.matricula)}</b> ${esc(e.frase)}${v.chofer ? ` (${esc(v.chofer)})` : ''}`));
  if (revisar.length) {
    const { faltan, malEscritas } = separarRevisar(revisar);
    L.push('', `❓ <b>Fechas que faltan o que no entiendo, ponedlas bien (${revisar.length}):</b>`,
      ...faltan.map(([tipo, mats]) => `• Falta la fecha de <b>${esc(tipo)}</b> (${mats.length}): ${mats.map(esc).join(', ')}`),
      ...malEscritas.map(lineaAlerta));
  }
  return L.join('\n');
}

async function enviarTelegram(r: Resumen) {
  const chats = (process.env.TELEGRAM_AVISOS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!process.env.TELEGRAM_TOKEN || chats.length === 0) return 'sin configurar';
  const texto = textoTelegram(r);
  for (const chat of chats) await enviarTexto(chat, texto);
  return `enviado a ${chats.length} chat(s)`;
}

// ---------- Función ----------
export default async function reporteDiario(req: any, res: any) {
  const autorizacion: string = req.headers?.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  const esCron = !!cronSecret && autorizacion === `Bearer ${cronSecret}`;

  try {
    // 1) Solo el cron o una de las cuentas con permiso (src/acceso.ts).
    let pedidoPor = 'cron diario';
    if (!esCron) {
      if (req.method !== 'POST' || !autorizacion.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
      }
      let token;
      try {
        token = await getAuth(firebaseAdmin()).verifyIdToken(autorizacion.slice('Bearer '.length));
      } catch {
        return res.status(401).json({ error: 'Sesión no válida: vuelve a entrar en la app' });
      }
      if (!tieneAcceso(token.email, token.email_verified)) return res.status(403).json({ error: AVISO_SIN_ACCESO(token.email) });
      pedidoPor = token.email!;
    }

    // 2) Leer la flota y separar citas, vencidos y próximos.
    const flota = await cargarFlota();
    const r = resumir(flota);
    const cuenta = { conCita: r.conCita.length, vencidos: r.vencidos.length, proximos: r.proximos.length, revisar: r.revisar.length, incidencias: r.incidencias.length, aceite: r.aceite.length };
    if (cuenta.conCita + cuenta.vencidos + cuenta.proximos + cuenta.revisar + cuenta.incidencias + cuenta.aceite === 0) {
      console.log(`[reporte] ${pedidoPor}: nada pendiente, no se envía (${flota.length} vehículos)`);
      return res.status(200).json({ enviado: false, motivo: 'No hay trámites pendientes', vehiculos: flota.length });
    }

    // 3) Enviar. Si falla un canal, el otro sale igual.
    const q = req.query || {};
    const prueba = esCron && String(q.prueba) === '1';
    const soloTelegram = esCron && String(q.soloTelegram) === '1';
    const salida: Record<string, unknown> = { enviado: true, ...cuenta };

    if (!soloTelegram) {
      const para = prueba ? process.env.EMAIL_USER! : (process.env.REPORTE_PARA || PARA_POR_DEFECTO);
      try { salida.messageId = await enviarCorreo(para, r); salida.para = para; }
      catch (e: any) { salida.errorCorreo = e?.message || String(e); }
    }
    if (esCron && !prueba) {
      try { salida.telegram = await enviarTelegram(r); }
      catch (e: any) { salida.telegram = 'error: ' + (e?.message || e); }
    }

    console.log(`[reporte] ${pedidoPor}:`, JSON.stringify(salida));
    const fallo = salida.errorCorreo && !String(salida.telegram || '').startsWith('enviado');
    return res.status(fallo ? 500 : 200).json(fallo ? { error: salida.errorCorreo, ...salida } : salida);
  } catch (error: any) {
    console.error('[reporte] error:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo enviar el reporte' });
  }
}
