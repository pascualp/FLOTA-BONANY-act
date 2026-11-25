import { FieldValue } from 'firebase-admin/firestore';
import { cargarFlota, db, enviarTexto, escaparHtml as esc, hoyTexto, TRAMITES } from './_lib/flota.js';
import { AVISO_CUOTA, esCuotaAgotada } from './_lib/archivos.js';
import type { ClaveTramite, Vehicle } from '../src/types.js';

// Aviso por Telegram ~2 HORAS ANTES de cada cita apuntada (ITV, ATP o tacógrafo) que tenga hora (/api/avisos).
// Facu (25/11/2026): «los avisos antes y también dos horas antes». El día antes y la misma mañana ya los da el reporte
// de las 8:00 (cron de Vercel). Vercel gratis solo deja crons diarios: a esta función la llama una tarea de Windows del
// PC de la oficina cada 15 minutos («Flotas - avisos 2 h», con «Authorization: Bearer CRON_SECRET»).
// Cada cita se avisa UNA vez (campo citas.<trámite>.aviso2h). Si el PC estuvo apagado y quedan menos de 2 h, avisa igual.
// Lee la flota (~30 fichas) en cada llamada: ~1.700 lecturas al día, muy por debajo del tope diario de la base.

const MINUTOS_ANTES = 125;   // la tarea va cada 15 min: avisa entre 2 h 05 y la hora de la cita

const NOMBRE: Record<string, string> = { itv: 'la ITV', atp: 'la revisión del ATP', tacografo: 'la revisión del tacógrafo' };

// Hora actual en España en minutos desde medianoche.
function minutosAhora(d = new Date()): number {
  const [h, m] = d.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  return h * 60 + m;
}

export const textoFalta = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}` : `${min} min`;

// Qué citas hay que avisar ahora: de HOY, con hora, sin avisar todavía, y que empiezan dentro de 0-125 minutos.
export function citasParaAvisar(flota: Vehicle[], hoy: string, ahora: number) {
  const lista: { v: Vehicle; clave: ClaveTramite; cita: any; falta: number }[] = [];
  for (const v of flota) {
    for (const t of TRAMITES) {
      const c: any = v.citas?.[t.clave];
      if (!c || c.fecha !== hoy || !c.hora || c.aviso2h) continue;
      const [h, m] = String(c.hora).split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      const falta = h * 60 + m - ahora;
      if (falta > 0 && falta <= MINUTOS_ANTES) lista.push({ v, clave: t.clave, cita: c, falta });
    }
  }
  return lista;
}

export default async function avisos(req: any, res: any) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers?.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'No autorizado' });
  const chats = (process.env.TELEGRAM_AVISOS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!chats.length) return res.status(200).json({ enviados: 0, motivo: 'TELEGRAM_AVISOS sin configurar' });

  try {
    const enviados: string[] = [];
    for (const { v, clave, cita: c, falta } of citasParaAvisar(await cargarFlota(), hoyTexto(), minutosAhora())) {
      const texto = `⏰ <b>Dentro de ${textoFalta(falta)}</b> (a las ${esc(c.hora)}) hay que llevar el <b>${esc(v.matricula)}</b> a ${NOMBRE[clave]}` +
        `${c.lugar ? ' en ' + esc(c.lugar) : ''}.${v.chofer ? `\nChófer: ${esc(v.chofer)}` : ''}${c.notas ? `\nNotas: ${esc(c.notas)}` : ''}`;
      for (const chat of chats) await enviarTexto(chat, texto);
      // Se marca después de enviar: si el envío fallara, el siguiente pase lo vuelve a intentar.
      await db().collection('vehicles').doc(v.id!).update({ [`citas.${clave}.aviso2h`]: FieldValue.serverTimestamp() });
      enviados.push(`${v.matricula} ${clave} ${c.hora}`);
    }
    if (enviados.length) console.log('[avisos] enviados:', enviados.join(' | '));
    return res.status(200).json({ enviados: enviados.length, detalle: enviados });
  } catch (e: any) {
    if (esCuotaAgotada(e)) return res.status(503).json({ error: AVISO_CUOTA });
    console.error('[avisos] error:', e);
    return res.status(500).json({ error: e?.message || 'Error' });
  }
}
