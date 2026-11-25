import Anthropic from '@anthropic-ai/sdk';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  bajarArchivoTelegram, buscarVehiculo, cargarFlota, chatsPermitidos, db, enviarTexto, enviarVoz, escaparHtml as esc,
  hoyLargo, hoyTexto, normalizarMatricula, tg, TRAMITES, URL_APP,
} from './_lib/flota.js';
import { getVehicleAlerts, parseEsDate, textoCita } from '../src/utils.js';
import type { ClaveTramite, Vehicle } from '../src/types.js';

// Agente «Flotas Bonany» en Telegram (/api/telegram, webhook del bot).
// Lo usan Facu y Jordi (grupo + privados: lista TELEGRAM_CHATS, estar en el grupo, o alta con ✅ desde el grupo).
// Claude consulta la flota y PROPONE cambios;
// cada propuesta queda en flota_agente_pendientes y solo se escribe en la app cuando alguien pulsa ✅.
//
// Audios (23/11, Facu: «que conteste por voz y que entienda también por audio»): las notas de voz se pasan a texto con
// Deepgram (nova-3, español) y, si el mensaje era un audio, la respuesta va escrita Y en nota de voz (Tomás, la voz que
// Facu eligió para Bruno el 19/11 tras descartar Aquila). Si se escribe, se contesta solo por escrito.
//
// Variables: TELEGRAM_TOKEN, TELEGRAM_SECRET (cabecera del webhook), TELEGRAM_CHATS, ANTHROPIC_API_KEY,
// FIREBASE_SERVICE_ACCOUNT (reporte-flota, con permiso de escritura), DEEPGRAM_API_KEY (audios).

type MsgParam = Anthropic.Beta.Messages.BetaMessageParam;
type BloqueParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type Resultado = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const MODELO = 'claude-opus-5-5';
const COL_PEND = 'flota_agente_pendientes';
const COL_CHATS = 'flota_agente_chats';
const COL_UPD = 'flota_agente_updates';
const COL_USUARIOS = 'flota_agente_usuarios';   // quién puede hablar en privado sin estar en el grupo (alta con ✅)
const MAX_PARES = 8;                 // pares pregunta/respuesta que recuerda por chat
const CADUCIDAD_MS = 48 * 3600e3;    // un botón ✅ de hace más de 2 días ya no vale
const TROZO = 600 * 1024;            // igual que la web: trozos de 600 KB de base64

const CAMPOS_EDITABLES = ['marca', 'tipo', 'tipoCaja', 'capacidad', 'fechaMatriculacion', 'bastidor', 'chofer', 'aseguradora', 'poliza'] as const;
const NOMBRE_TRAMITE: Record<ClaveTramite, string> = { itv: 'ITV', atp: 'ATP', tacografo: 'tacógrafo' };

const SISTEMA = `Eres el asistente de la flota de vehículos de Bon Any (frutería con reparto en Mallorca). Hablas por Telegram con Facu y Jordi, que llevan la flota. Contesta siempre en español, corto y claro, en texto normal (sin Markdown: ni asteriscos ni almohadillas).

Qué puedes hacer con tus herramientas:
- Consultar: ver_flota (todos los vehículos, sus fechas, estado y citas) y ver_vehiculo (uno, con sus datos y documentos).
- Apuntar una cita YA SACADA (ITV, ATP o tacógrafo): proponer_cita. «Hemos sacado / pedido / tenemos cita de la ITV» significa cita sacada y pendiente de llevar el vehículo.
- Cuando el trámite ya se ha hecho («ya pasó la ITV», «la hemos pasado»): proponer_nueva_fecha con la fecha del PRÓXIMO vencimiento. Esto también quita la cita. Si no te dan la fecha nueva, pregúntala; no la inventes. Si mandan la tarjeta o el informe de la ITV, léela de ahí.
- Anular una cita: proponer_quitar_cita. Cambiar un dato (chófer, aseguradora, póliza…): proponer_cambio. Dar de alta un vehículo: proponer_alta_vehiculo.
- Guardar la foto o el PDF que viene en el mensaje en los documentos de un vehículo: proponer_guardar_archivo.

Reglas:
- Tú NUNCA guardas nada. Las herramientas proponer_* solo preparan el cambio y mandan un botón ✅ para que lo confirmen. No digas que está guardado: di que lo confirmen con el botón.
- Si no está claro de qué vehículo se habla, o falta un dato imprescindible (como la fecha de la cita), pregunta antes de proponer. Las matrículas pueden venir incompletas o con espacios: búscalas con ver_flota; si hay varias posibles, pregunta.
- Fechas siempre dd/mm/aaaa (año con 4 cifras) y horas HH:MM. «Mañana», «el martes», «el día 2»: calcúlalo con la fecha de hoy, que va al principio de cada mensaje.
- Si mandan una foto o un PDF sin decir nada, mira qué es (tarjeta o informe de ITV, permiso de circulación, póliza, ficha técnica, multa…), di lo que ves y propón guardarlo en el vehículo que toque (busca la matrícula en el documento). Si es una ITV favorable, propón también la nueva fecha de la próxima ITV.
- No borras vehículos ni documentos: eso se hace en la web, ${URL_APP}
- Si preguntan qué hay pendiente, usa ver_flota y resume: primero las citas de hoy y mañana, luego lo vencido sin cita y lo próximo a vencer.
- Si el mensaje llega POR AUDIO (va marcado), es una transcripción automática: las matrículas y los nombres pueden venir mal oídos («nueve uno cinco uno ka uve jota», números sueltos…); búscalas en la flota y, si dudas, pregunta. Tu respuesta se leerá también en voz alta: sé más breve (2-4 frases), sin listas largas; si hay muchos vehículos, di cuántos son y los más urgentes.`;

const tramite = { type: 'string', enum: ['itv', 'atp', 'tacografo'], description: 'itv = ITV Técnica, atp = Vencimiento ATP, tacografo = Revisión Tacógrafo' };
const matricula = { type: 'string', description: 'Matrícula del vehículo, tal como está en la flota' };
const fecha = { type: 'string', description: 'Fecha dd/mm/aaaa' };

const HERRAMIENTAS: Anthropic.Beta.Messages.BetaToolUnion[] = [
  { name: 'ver_flota', description: 'Todos los vehículos con chófer, fechas de ITV, ATP y tacógrafo, su estado (VENCIDO / próximo / en regla) y las citas sacadas.', input_schema: { type: 'object', properties: {} } },
  { name: 'ver_vehiculo', description: 'Todos los datos de un vehículo y la lista de sus documentos guardados.', input_schema: { type: 'object', properties: { matricula }, required: ['matricula'] } },
  { name: 'proponer_cita', description: 'Propone apuntar una cita ya sacada (pendiente de llevar el vehículo). Manda un botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, tramite, fecha, hora: { type: 'string', description: 'HH:MM, si la saben' }, lugar: { type: 'string', description: 'Estación o taller, si lo saben' }, notas: { type: 'string' } }, required: ['matricula', 'tramite', 'fecha'] } },
  { name: 'proponer_quitar_cita', description: 'Propone anular una cita apuntada. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, tramite }, required: ['matricula', 'tramite'] } },
  { name: 'proponer_nueva_fecha', description: 'El trámite ya se hizo: propone poner la fecha del PRÓXIMO vencimiento (y quitar la cita). Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, tramite, fecha }, required: ['matricula', 'tramite', 'fecha'] } },
  { name: 'proponer_cambio', description: 'Propone cambiar un dato del vehículo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, campo: { type: 'string', enum: [...CAMPOS_EDITABLES] }, valor: { type: 'string' } }, required: ['matricula', 'campo', 'valor'] } },
  { name: 'proponer_alta_vehiculo', description: 'Propone dar de alta un vehículo nuevo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, marca: { type: 'string' }, tipo: { type: 'string', description: 'CAMIÓN, FURGONETA, COCHE…' }, chofer: { type: 'string' }, tipoCaja: { type: 'string' }, capacidad: { type: 'string' }, bastidor: { type: 'string' }, fechaMatriculacion: fecha, proximaITV: fecha, vencimientoATP: fecha, revisionTacografo: fecha, aseguradora: { type: 'string' }, poliza: { type: 'string' } }, required: ['matricula', 'marca', 'tipo'] } },
  { name: 'proponer_guardar_archivo', description: 'Propone guardar la foto o el PDF que viene en ESTE mensaje en los documentos del vehículo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, nombre: { type: 'string', description: 'Nombre corto del documento, p. ej. «Tarjeta ITV 2026»' } }, required: ['matricula', 'nombre'] } },
];

interface Adjunto { fileId: string; nombre: string; mime: string }
export interface Ctx { chatId: number; quien: string; adjunto?: Adjunto; flota?: Vehicle[]; propuestas: { id: string; resumen: string }[] }

// ---------- Validaciones ----------
const esFecha = (s: unknown) => typeof s === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(s) && !!parseEsDate(s);
const esHora = (s: unknown) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
const esTramite = (s: unknown): s is ClaveTramite => s === 'itv' || s === 'atp' || s === 'tacografo';
const textoLimpio = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 200) : '');

async function flotaDe(ctx: Ctx) {
  if (!ctx.flota) ctx.flota = await cargarFlota();
  return ctx.flota;
}

async function vehiculoDe(ctx: Ctx, m: unknown): Promise<Vehicle> {
  const v = buscarVehiculo(await flotaDe(ctx), m);
  if (!v) throw new Error(`No encuentro la matrícula «${m}» en la flota. Usa ver_flota para buscarla.`);
  return v;
}

// ---------- Herramientas ----------
async function proponer(ctx: Ctx, tipo: string, datos: Record<string, unknown>, resumen: string) {
  const ref = await db().collection(COL_PEND).add({
    chatId: ctx.chatId, tipo, datos, resumen, estado: 'pendiente', por: ctx.quien, creado: FieldValue.serverTimestamp(),
  });
  ctx.propuestas.push({ id: ref.id, resumen });
  return `Propuesta preparada: «${resumen}». Se ha mandado con un botón ✅ para confirmar. Todavía NO está guardado.`;
}

async function ejecutar(ctx: Ctx, nombre: string, e: any): Promise<string> {
  switch (nombre) {
    case 'ver_flota': {
      const flota = await flotaDe(ctx);
      return flota
        .slice()
        .sort((a, b) => a.matricula.localeCompare(b.matricula))
        .map((v) => {
          const alertas = getVehicleAlerts(v).map((a) =>
            `   - ${a.label}: ${a.date} → ${a.text}${a.cita ? ' · ' + textoCita(a.cita) : ''}`);
          return `${v.matricula} · ${v.marca || ''} ${v.tipo || ''}${v.chofer ? ' · chófer ' + v.chofer : ''}\n${alertas.join('\n') || '   (sin fechas)'}`;
        })
        .join('\n');
    }
    case 'ver_vehiculo': {
      const v = await vehiculoDe(ctx, e.matricula);
      const docs = await db().collection('documents').where('vehicleId', '==', v.id).get();
      const { createdAt, ...datos } = v as any;
      return JSON.stringify({
        ...datos,
        documentos: docs.docs.map((d) => ({ nombre: d.get('name'), tipo: d.get('type'), subido: d.get('uploadedAt')?.toDate?.().toISOString().slice(0, 10) })),
      });
    }
    case 'proponer_cita': {
      const v = await vehiculoDe(ctx, e.matricula);
      if (!esTramite(e.tramite)) throw new Error('Trámite no válido: itv, atp o tacografo');
      if (!esFecha(e.fecha)) throw new Error('La fecha tiene que ser dd/mm/aaaa');
      if (e.hora && !esHora(e.hora)) throw new Error('La hora tiene que ser HH:MM');
      const cita = { fecha: e.fecha, hora: textoLimpio(e.hora), lugar: textoLimpio(e.lugar), notas: textoLimpio(e.notas), por: ctx.quien };
      return proponer(ctx, 'cita', { vehicleId: v.id, matricula: v.matricula, clave: e.tramite, cita },
        `${v.matricula}: cita de ${NOMBRE_TRAMITE[e.tramite as ClaveTramite]} el ${e.fecha}${cita.hora ? ' a las ' + cita.hora : ''}${cita.lugar ? ' en ' + cita.lugar : ''} (pendiente de llevar)`);
    }
    case 'proponer_quitar_cita': {
      const v = await vehiculoDe(ctx, e.matricula);
      if (!esTramite(e.tramite)) throw new Error('Trámite no válido: itv, atp o tacografo');
      const clave: ClaveTramite = e.tramite;
      const cita = v.citas?.[clave];
      if (!cita) throw new Error(`${v.matricula} no tiene cita de ${NOMBRE_TRAMITE[clave]} apuntada`);
      return proponer(ctx, 'quitar_cita', { vehicleId: v.id, matricula: v.matricula, clave },
        `${v.matricula}: anular la cita de ${NOMBRE_TRAMITE[clave]} del ${cita.fecha}`);
    }
    case 'proponer_nueva_fecha': {
      const v = await vehiculoDe(ctx, e.matricula);
      if (!esTramite(e.tramite)) throw new Error('Trámite no válido: itv, atp o tacografo');
      if (!esFecha(e.fecha)) throw new Error('La fecha tiene que ser dd/mm/aaaa');
      const t = TRAMITES.find((x) => x.clave === e.tramite)!;
      return proponer(ctx, 'nueva_fecha', { vehicleId: v.id, matricula: v.matricula, clave: t.clave, campo: t.campo, fecha: e.fecha },
        `${v.matricula}: ${t.label} hecha → próximo vencimiento ${e.fecha} (antes ${v[t.campo] || 'sin fecha'})${v.citas?.[t.clave] ? ' y se quita la cita' : ''}`);
    }
    case 'proponer_cambio': {
      const v = await vehiculoDe(ctx, e.matricula);
      if (!CAMPOS_EDITABLES.includes(e.campo)) throw new Error('Ese dato no se puede cambiar desde aquí');
      const valor = textoLimpio(e.valor);
      return proponer(ctx, 'cambio', { vehicleId: v.id, matricula: v.matricula, campo: e.campo, valor },
        `${v.matricula}: ${e.campo} «${(v as any)[e.campo] || '—'}» → «${valor}»`);
    }
    case 'proponer_alta_vehiculo': {
      const m = normalizarMatricula(e.matricula);
      if (m.length < 4) throw new Error('Matrícula no válida');
      if (buscarVehiculo(await flotaDe(ctx), m)) throw new Error(`${m} ya está en la flota`);
      for (const f of ['fechaMatriculacion', 'proximaITV', 'vencimientoATP', 'revisionTacografo']) {
        if (e[f] && !esFecha(e[f])) throw new Error(`${f} tiene que ser dd/mm/aaaa`);
      }
      const campos = ['marca', 'tipo', 'tipoCaja', 'capacidad', 'fechaMatriculacion', 'bastidor', 'chofer', 'aseguradora', 'poliza', 'proximaITV', 'vencimientoATP', 'revisionTacografo'];
      const vehiculo: Record<string, string> = { matricula: m };
      for (const c of campos) vehiculo[c] = textoLimpio(e[c]);
      return proponer(ctx, 'alta', { vehiculo }, `Alta de ${m}: ${vehiculo.marca} ${vehiculo.tipo}${vehiculo.chofer ? ', chófer ' + vehiculo.chofer : ''}`);
    }
    case 'proponer_guardar_archivo': {
      if (!ctx.adjunto) throw new Error('Este mensaje no trae ninguna foto ni archivo. Pide que lo manden.');
      const v = await vehiculoDe(ctx, e.matricula);
      const base = textoLimpio(e.nombre) || 'Documento';
      const ext = ctx.adjunto.nombre.includes('.') ? ctx.adjunto.nombre.slice(ctx.adjunto.nombre.lastIndexOf('.')) : '';
      const nombre = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? base + ext : base;
      return proponer(ctx, 'archivo', { ...ctx.adjunto, nombreOriginal: ctx.adjunto.nombre, vehicleId: v.id, matricula: v.matricula, nombre }, `${v.matricula}: guardar «${nombre}» en sus documentos`);
    }
  }
  throw new Error(`Herramienta desconocida: ${nombre}`);
}

// ---------- Aplicar un cambio confirmado con ✅ ----------
async function aplicar(p: any, quien: string) {
  const d = p.datos;
  const veh = d.vehicleId ? db().collection('vehicles').doc(d.vehicleId) : null;
  if (veh && !(await veh.get()).exists) throw new Error(`El vehículo ${d.matricula} ya no existe`);
  switch (p.tipo) {
    case 'cita':
      await veh!.update({ [`citas.${d.clave}`]: { ...d.cita, confirmadoPor: quien, el: FieldValue.serverTimestamp() } });
      return;
    case 'quitar_cita':
      await veh!.update({ [`citas.${d.clave}`]: FieldValue.delete() });
      return;
    case 'nueva_fecha':
      await veh!.update({ [d.campo]: d.fecha, [`citas.${d.clave}`]: FieldValue.delete() });
      return;
    case 'cambio':
      await veh!.update({ [d.campo]: d.valor });
      return;
    case 'alta': {
      const yaEsta = (await cargarFlota()).some((v) => normalizarMatricula(v.matricula) === d.vehiculo.matricula);
      if (yaEsta) throw new Error(`${d.vehiculo.matricula} ya está en la flota`);
      await db().collection('vehicles').add({ ...d.vehiculo, priority: 'medium', createdAt: FieldValue.serverTimestamp() });
      return;
    }
    case 'archivo': {
      // Igual que la subida de la web: documento ligero + subcolección «chunks» con el data URL en trozos.
      const { datos } = await bajarArchivoTelegram(d.fileId);
      const dataUrl = `data:${d.mime};base64,${datos.toString('base64')}`;
      const total = Math.ceil(dataUrl.length / TROZO);
      const ref = await db().collection('documents').add({
        vehicleId: d.vehicleId, name: d.nombre, type: d.mime, size: datos.length, url: '',
        isChunked: true, totalChunks: total, uploadedAt: FieldValue.serverTimestamp(), subidoPor: `Telegram · ${quien}`,
      });
      for (let b = 0; b < total; b += 4) {
        const lote = db().batch();
        for (let i = b; i < Math.min(b + 4, total); i++) {
          lote.set(ref.collection('chunks').doc(), { index: i, data: dataUrl.slice(i * TROZO, (i + 1) * TROZO) });
        }
        await lote.commit();
      }
      return;
    }
  }
  throw new Error(`Tipo de cambio desconocido: ${p.tipo}`);
}

// ---------- El agente (Claude con herramientas) ----------
export async function agente(ctx: Ctx, historial: { u: string; a: string }[], contenido: BloqueParam[]): Promise<string> {
  const client = new Anthropic();
  const messages: MsgParam[] = [];
  for (const par of historial) messages.push({ role: 'user', content: par.u }, { role: 'assistant', content: par.a });
  messages.push({ role: 'user', content: contenido });

  for (let vuelta = 0; vuelta < 8; vuelta++) {
    const resp = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: SISTEMA,
      tools: HERRAMIENTAS,
      messages,
    });
    if (resp.stop_reason === 'refusal') return 'No puedo ayudar con eso.';
    if (resp.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: resp.content }); continue; }

    const usos = resp.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    const texto = resp.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    if (resp.stop_reason !== 'tool_use' || usos.length === 0) return texto || 'Hecho.';

    messages.push({ role: 'assistant', content: resp.content });
    const resultados: Resultado[] = [];
    for (const u of usos) {
      try {
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: await ejecutar(ctx, u.name, u.input) });
      } catch (err: any) {
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + (err?.message || err), is_error: true });
      }
    }
    messages.push({ role: 'user', content: resultados });
  }
  return 'Me he liado con tantas consultas. ¿Me lo dices más concreto?';
}

// ---------- Voz: entender audios (Deepgram) y contestar con nota de voz (Tomás) ----------
const VOZ = 'es-AR-TomasNeural';   // la de Bruno desde el 19/11 (Facu: Aquila de Deepgram, «horrible»)
const MAX_VOZ = 700;               // letras en voz alta; el resto queda escrito

async function transcribir(datos: Buffer, mime: string): Promise<string> {
  const clave = process.env.DEEPGRAM_API_KEY;
  if (!clave) throw new Error('Falta DEEPGRAM_API_KEY en el servidor');
  const q = new URLSearchParams({ model: 'nova-3', language: 'es', smart_format: 'true', punctuate: 'true' });
  const r = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST', headers: { Authorization: `Token ${clave}`, 'Content-Type': mime },
    body: new Uint8Array(datos), signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Deepgram respondió ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const j: any = await r.json();
  return String(j?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const deletrear = (s: string) => s.split('').join(' ');

// Lo que se lee en voz alta: sin emojis ni enlaces; fechas en palabras y matrículas letra a letra («9 1 5 1 K W J»).
export function paraDecir(t: string): string {
  return t
    .replace(/https?:\/\/\S+/g, 'la web')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (m, d, me, a) => {
      const mes = MESES[Number(me) - 1];
      return mes ? `${Number(d)} de ${mes} de ${a.length === 2 ? '20' + a : a}` : m;
    })
    .replace(/\b(\d{4}) ?([A-Z]{3})\b/g, (_m, n, l) => `${deletrear(n)} ${deletrear(l)}`)
    .replace(/\b([A-Z]{1,2}) ?(\d{4}) ?([A-Z]{1,2})\b/g, (_m, a, n, b) => `${deletrear(a)} ${deletrear(n)} ${deletrear(b)}`)
    .replace(/\bFacu\b/g, 'Facundo')   // como en Bruno: «Facu» sonaba «facultad»
    .replace(/[*_#`|>~<]/g, '')
    .replace(/\s+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
}

// Corta por frases para que la nota de voz no sea eterna (lo escrito va completo).
export function recortar(t: string, max = MAX_VOZ): string {
  if (t.length <= max) return t;
  let dicho = '';
  for (const frase of t.split(/(?<=[.!?…:])\s+/)) {
    if ((dicho + ' ' + frase).trim().length > max) break;
    dicho = (dicho + ' ' + frase).trim();
  }
  return (dicho || t.slice(0, max)) + ' El resto te lo dejo escrito.';
}

export async function vozTomas(texto: string): Promise<Buffer> {
  let ultimoError: unknown;
  for (let intento = 0; intento < 2; intento++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(texto, { rate: '+30%' });   // Facu quiere a Bruno rápido
      const trozos: Buffer[] = [];
      await new Promise<void>((ok, mal) => {
        audioStream.on('data', (d: Buffer) => trozos.push(d));
        audioStream.on('end', () => ok()); audioStream.on('close', () => ok()); audioStream.on('error', mal);
        setTimeout(() => mal(new Error('la voz tarda demasiado')), 15000);
      });
      if (trozos.length) return Buffer.concat(trozos);
      ultimoError = new Error('la voz salió vacía');
    } catch (e) { ultimoError = e; }
    finally { try { tts.close(); } catch { /* ya cerrada */ } }
  }
  throw ultimoError;
}

// ---------- Mensajes y botones de Telegram ----------
const IMAGENES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function atenderMensaje(msg: any) {
  const chatId: number = msg.chat.id;
  const quien: string = msg.from?.first_name || 'alguien';
  let texto: string = (msg.text || msg.caption || '').trim();

  let adjunto: Adjunto | undefined;
  if (msg.photo?.length) {
    const grande = msg.photo[msg.photo.length - 1];
    adjunto = { fileId: grande.file_id, nombre: `foto-${hoyTexto().split('/').reverse().join('-')}.jpg`, mime: 'image/jpeg' };
  } else if (msg.document) {
    adjunto = { fileId: msg.document.file_id, nombre: msg.document.file_name || 'archivo', mime: msg.document.mime_type || 'application/octet-stream' };
  }

  // Audio (nota de voz, archivo de audio o vídeo redondo): se pasa a texto y se trata como si lo hubieran escrito.
  const audio = msg.voice ?? msg.audio ?? msg.video_note;
  let oido = '';
  if (audio) {
    const responder = { reply_to_message_id: msg.message_id, allow_sending_without_reply: true };
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    try {
      const { datos } = await bajarArchivoTelegram(audio.file_id);
      oido = await transcribir(datos, audio.mime_type || (msg.video_note ? 'video/mp4' : 'audio/ogg'));
    } catch (e) {
      console.error('[telegram] no pude transcribir el audio:', e);
      await enviarTexto(chatId, 'No pude escuchar el audio. ¿Me lo escribes?', responder);
      return;
    }
    if (!oido) {
      await enviarTexto(chatId, 'No te he entendido el audio. ¿Me lo repites o me lo escribes?', responder);
      return;
    }
    texto = texto ? `${texto}\n${oido}` : oido;
  }
  if (!texto && !adjunto) return;
  if (texto === '/start' || texto.startsWith('/start@')) texto = 'Hola, ¿qué sabes hacer?';

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  const contenido: BloqueParam[] = [];
  let notaAdjunto = '';
  if (adjunto) {
    const { datos } = await bajarArchivoTelegram(adjunto.fileId);
    const b64 = datos.toString('base64');
    if (IMAGENES.includes(adjunto.mime) && datos.length <= 5 * 1024 * 1024) {
      contenido.push({ type: 'image', source: { type: 'base64', media_type: adjunto.mime as any, data: b64 } });
    } else if (adjunto.mime === 'application/pdf' && datos.length <= 20 * 1024 * 1024) {
      contenido.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    }
    notaAdjunto = `\n[Adjunta un archivo: «${adjunto.nombre}» (${adjunto.mime}, ${Math.round(datos.length / 1024)} KB). Se puede guardar con proponer_guardar_archivo.]`;
  }
  const como = audio ? `${quien} POR AUDIO (transcripción automática)` : quien;
  contenido.push({ type: 'text', text: `[Hoy es ${hoyLargo()}. Escribe ${como}.]\n${texto || '(sin texto)'}${notaAdjunto}` });

  const chatRef = db().collection(COL_CHATS).doc(String(chatId));
  const historial: { u: string; a: string }[] = ((await chatRef.get()).get('pares') || []).slice(-MAX_PARES);

  const ctx: Ctx = { chatId, quien, adjunto, propuestas: [] };
  const respuesta = await agente(ctx, historial, contenido);

  // Con audio, primero lo que se entendió (así se ve si cogió bien la matrícula) y después la respuesta.
  const escrito = audio ? `🎤 <i>«${esc(oido)}»</i>\n\n${esc(respuesta)}` : esc(respuesta);
  await enviarTexto(chatId, escrito, { reply_to_message_id: msg.message_id, allow_sending_without_reply: true });
  if (audio) {
    try {
      await tg('sendChatAction', { chat_id: chatId, action: 'record_voice' }).catch(() => {});
      const mp3 = await vozTomas(recortar(paraDecir(respuesta)));
      await enviarVoz(chatId, mp3, 'audio/mpeg', 'respuesta.mp3', msg.message_id);
    } catch (e) {
      console.error('[telegram] no pude mandar la nota de voz:', e);   // la respuesta ya fue por escrito
    }
  }
  for (const p of ctx.propuestas) {
    await enviarTexto(chatId, `📝 <b>¿Lo guardo?</b>\n${esc(p.resumen)}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Sí, guardar', callback_data: `ok:${p.id}` }, { text: '❌ No', callback_data: `no:${p.id}` }]] },
    });
  }

  const pares = [...historial, {
    u: `${quien}${audio ? ' (audio)' : ''}: ${texto || '(sin texto)'}${adjunto ? ` [adjuntó ${adjunto.nombre}]` : ''}`,
    a: respuesta + (ctx.propuestas.length ? `\n[Propuestas con botón: ${ctx.propuestas.map((p) => p.resumen).join(' | ')}]` : ''),
  }].slice(-MAX_PARES);
  await chatRef.set({ pares, actualizado: FieldValue.serverTimestamp() });
}

async function atenderBoton(cq: any) {
  const chatId = cq.message?.chat?.id;
  const quien = cq.from?.first_name || 'alguien';
  const [accion, id] = String(cq.data || '').split(':');
  const contestar = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => {});
  const editar = (text: string) =>
    tg('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text, parse_mode: 'HTML' }).catch(() => {});

  if (accion === 'alta' || accion === 'veto') return decidirAcceso(accion, id, quien, contestar, editar);

  const ref = db().collection(COL_PEND).doc(id || 'x');
  const p = (await ref.get()).data();
  if (!p || p.chatId !== chatId) return contestar('No encuentro ese cambio');
  if (p.estado !== 'pendiente') return contestar(p.estado === 'hecha' ? 'Ya estaba guardado' : 'Ya estaba cancelado');

  if (accion === 'no') {
    await ref.update({ estado: 'cancelada', decididoPor: quien, decidido: FieldValue.serverTimestamp() });
    await editar(`❌ <s>${esc(p.resumen)}</s>\nCancelado por ${esc(quien)}`);
    return contestar('Cancelado');
  }
  const creado: Timestamp | undefined = p.creado;
  if (creado && Date.now() - creado.toMillis() > CADUCIDAD_MS) {
    await ref.update({ estado: 'caducada' });
    await editar(`⌛ ${esc(p.resumen)}\nCaducado: pídemelo otra vez.`);
    return contestar('Caducado');
  }
  // Se marca primero, para que dos ✅ seguidos no lo apliquen dos veces.
  const marcado = await db().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.get('estado') !== 'pendiente') return false;
    t.update(ref, { estado: 'aplicando', decididoPor: quien });
    return true;
  });
  if (!marcado) return contestar('Ya estaba en marcha');
  try {
    await aplicar(p, quien);
    await ref.update({ estado: 'hecha', decidido: FieldValue.serverTimestamp() });
    await editar(`✅ ${esc(p.resumen)}\nGuardado por ${esc(quien)}`);
    return contestar('Guardado');
  } catch (err: any) {
    await ref.update({ estado: 'pendiente', error: String(err?.message || err) });
    await editar(`⚠️ ${esc(p.resumen)}\nNo se pudo guardar: ${esc(err?.message || err)}`);
    return contestar('Error al guardar');
  }
}

// ---------- Alta de personas nuevas en privado (25/11, Facu: «quiero que Jordi pueda hablar directamente con el agente») ----------
// Alguien que no está en el grupo escribe al bot → el bot pide permiso EN EL GRUPO con ✅/❌ → con ✅ ya puede hablar a solas.
// Como todo lo demás: nada se da por bueno sin que alguien del grupo pulse el botón.
const gruposDeLaLista = () => [...chatsPermitidos()].filter((c) => c.startsWith('-'));

async function primeraVez(updateId: unknown): Promise<boolean> {
  try {
    await db().collection(COL_UPD).doc(String(updateId)).create({ el: FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false;   // Telegram lo reintentó: ya se atendió
  }
}

async function pedirAcceso(msg: any) {
  const de = msg.from;
  const grupo = gruposDeLaLista()[0];
  if (!de?.id || !grupo) return;
  const nombre = [de.first_name, de.last_name].filter(Boolean).join(' ') || 'Sin nombre';
  const ref = db().collection(COL_USUARIOS).doc(String(de.id));
  try {
    // create() falla si ya existe: la petición llega al grupo UNA sola vez por persona.
    await ref.create({ nombre, usuario: de.username || '', estado: 'pendiente', pedido: FieldValue.serverTimestamp() });
  } catch {
    if ((await ref.get()).get('estado') === 'pendiente') {
      await enviarTexto(msg.chat.id, 'Sigo esperando a que me den permiso en el grupo de la flota. En cuanto lo tenga, te aviso por aquí.');
    }
    return;   // rechazado: no se contesta
  }
  const escrito = String(msg.text || msg.caption || (msg.voice ? '(un audio)' : '(sin texto)')).slice(0, 200);
  await enviarTexto(grupo,
    `🔑 <b>${esc(nombre)}</b>${de.username ? ' (@' + esc(de.username) + ')' : ''} quiere hablar con el agente en privado.\n` +
    `Ha escrito: «${esc(escrito)}»\n¿Le dejo?`,
    { reply_markup: { inline_keyboard: [[{ text: '✅ Sí, dejarle', callback_data: `alta:${de.id}` }, { text: '❌ No', callback_data: `veto:${de.id}` }]] } });
  await enviarTexto(msg.chat.id,
    `Hola ${esc(de.first_name || '')}, soy el asistente de la flota de Bon Any. Todavía no te conozco: he pedido permiso en el grupo de la flota. En cuanto me lo den, te aviso por aquí.`);
}

async function decidirAcceso(accion: string, id: string, quien: string,
  contestar: (t: string) => Promise<unknown>, editar: (t: string) => Promise<unknown>) {
  if (!/^\d+$/.test(id || '')) return contestar('Petición no válida');
  const ref = db().collection(COL_USUARIOS).doc(id);
  const nuevo = accion === 'alta' ? 'permitido' : 'rechazado';
  // En una transacción, para que dos pulsaciones seguidas no manden dos bienvenidas.
  const antes = await db().runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists || s.get('estado') !== 'pendiente') return s.data() || null;
    t.update(ref, { estado: nuevo, decididoPor: quien, decidido: FieldValue.serverTimestamp() });
    return { ...s.data(), cambiado: true } as any;
  });
  if (!antes) return contestar('No encuentro esa petición');
  if (!antes.cambiado) return contestar(antes.estado === 'permitido' ? 'Ya tenía permiso' : 'Ya se le dijo que no');
  if (nuevo === 'rechazado') {
    await editar(`❌ ${esc(antes.nombre)} no puede hablar con el agente.\nLo decidió ${esc(quien)}`);
    return contestar('Hecho');
  }
  await editar(`✅ ${esc(antes.nombre)} ya puede hablar con el agente en privado.\nLe dejó ${esc(quien)}`);
  await enviarTexto(id,
    `✅ Ya está: ${esc(quien)} te ha dado permiso. Pregúntame lo que necesites de la flota, por ejemplo «¿qué hay pendiente?», ` +
    `o dime «hemos sacado la ITV del 9151KWJ para el martes». También me puedes mandar fotos, PDF y audios.`)
    .catch((e) => console.error('[telegram] no pude dar la bienvenida:', e));
  return contestar('Hecho');
}

// Un privado que no está en TELEGRAM_CHATS vale si esa persona está en uno de los grupos de la lista (los que empiezan
// por «-») o si alguien del grupo le dio el alta con ✅ (flota_agente_usuarios).
async function permitido(update: any, chatId: number): Promise<boolean> {
  const lista = chatsPermitidos();
  if (lista.has(String(chatId))) return true;
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  const userId = update.message?.from?.id ?? update.callback_query?.from?.id;
  if (chat?.type !== 'private' || !userId) return false;
  if ((await db().collection(COL_USUARIOS).doc(String(userId)).get()).get('estado') === 'permitido') return true;
  for (const grupo of gruposDeLaLista()) {
    const m = await tg('getChatMember', { chat_id: grupo, user_id: userId }).catch(() => null);
    if (m && (['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member))) return true;
  }
  return false;
}

export default async function telegram(req: any, res: any) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  const secreto = process.env.TELEGRAM_SECRET;
  if (!secreto || req.headers?.['x-telegram-bot-api-secret-token'] !== secreto) return res.status(401).json({ error: 'No autorizado' });

  const update = req.body || {};
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (chatId === undefined) return res.status(200).json({ ok: true });
  if (!(await permitido(update, chatId))) {
    console.log(`[telegram] chat no permitido ${chatId} (${update.message?.chat?.title || update.message?.from?.first_name || ''})`);
    // Un privado de alguien nuevo: se pide permiso en el grupo con ✅/❌ (antes se ignoraba sin contestar).
    if (update.message?.chat?.type === 'private' && !update.message.from?.is_bot && (await primeraVez(update.update_id))) {
      await pedirAcceso(update.message).catch((e) => console.error('[telegram] no pude pedir el acceso:', e));
    }
    return res.status(200).json({ ok: true });
  }
  if (update.message?.from?.is_bot) return res.status(200).json({ ok: true });

  // Telegram reintenta si tardamos: cada update se atiende una sola vez.
  if (!(await primeraVez(update.update_id))) return res.status(200).json({ ok: true, repetido: true });

  try {
    if (update.callback_query) await atenderBoton(update.callback_query);
    else if (update.message) await atenderMensaje(update.message);
  } catch (err: any) {
    console.error('[telegram] error:', err);
    await tg('sendMessage', { chat_id: chatId, text: `⚠️ Algo ha fallado: ${String(err?.message || err).slice(0, 300)}` }).catch(() => {});
  }
  return res.status(200).json({ ok: true });
}
