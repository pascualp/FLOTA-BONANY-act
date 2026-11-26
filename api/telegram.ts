import Anthropic from '@anthropic-ai/sdk';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  bajarArchivoTelegram, buscarVehiculos, cargarFlota, cargarTodos, chatsPermitidos, db, enviarDocumentoTelegram, enviarTexto, enviarVoz,
  escaparHtml as esc, hoyLargo, hoyTexto, normalizarMatricula, tg, URL_APP,
} from './_lib/flota.js';
import { AVISO_CUOTA, esCuotaAgotada, guardar, leer, rutaNueva } from './_lib/archivos.js';
import { conCambio, getVehicleAlerts, nuevoCambio, parseEsDate, textoCita, VENCIMIENTOS } from '../src/utils.js';
import { CATEGORIAS, categoriaDe, esCategoria, estadoDocumentacion, MAX_BYTES, TIPOS_ARCHIVO, type DocResumen } from '../src/documentos.js';
import { diasOcupados, planificar, tareasPendientes, textoPlan } from '../src/planificador.js';
import { diaDe, euros, gastoPorAnio, leerImporte, ordenar, refReparacion, textoReparacion } from '../src/reparaciones.js';
import { conIncidencia, incidenciasDe, nuevaIncidencia, sinIncidencia, textoIncidencia } from '../src/incidencias.js';
import type { ClaveTramite, ClaveVencimiento, Reparacion, Vehicle } from '../src/types.js';

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
const MAX_ENVIAR = 3;                // documentos que manda como mucho de una vez

const CAMPOS_EDITABLES = ['marca', 'tipo', 'tipoCaja', 'capacidad', 'fechaMatriculacion', 'bastidor', 'chofer', 'aseguradora', 'poliza'] as const;
const NOMBRE_TRAMITE: Record<ClaveTramite, string> = { itv: 'ITV', atp: 'ATP', tacografo: 'tacógrafo' };

const SISTEMA = `Eres el asistente de la flota de vehículos de Bon Any (frutería con reparto en Mallorca). Hablas por Telegram con Facu y Jordi, que llevan la flota. Contesta siempre en español, corto y claro, en texto normal (sin Markdown: ni asteriscos ni almohadillas).

Qué puedes hacer con tus herramientas:
- Contestar CUALQUIER consulta sobre la flota (fechas, vencimientos, seguros, pólizas, chóferes, bastidores, documentos, citas…): mira los datos con ver_flota, ver_vehiculo o ver_documentacion y contesta con lo que diga la app. Si un dato no está en la app, dilo; no lo inventes.
- Consultar: ver_flota (todos los vehículos, sus fechas, estado y citas) y ver_vehiculo (uno, con sus datos, sus documentos y qué papeles le faltan).
- Documentación: ver_documentacion (qué papeles faltan en toda la flota o en un vehículo). Si piden un documento («mándame la ficha técnica del 9151», «pásame el seguro del 5331»), mándalo con enviar_documento.
- Planificar revisiones: planificar_revisiones reparte las ITV, ATP y tacógrafos pendientes (como mucho un vehículo al día, de lunes a viernes por la tarde, primero lo vencido). Úsalo si preguntan qué toca llevar, cuándo, o piden organizar las citas. Es una PROPUESTA: la cita de verdad hay que pedirla.
- Apuntar una cita YA SACADA (ITV, ATP o tacógrafo): proponer_cita. «Hemos sacado / pedido / tenemos cita de la ITV» significa cita sacada y pendiente de llevar el vehículo.
- Cuando el trámite ya se ha hecho («ya pasó la ITV», «la hemos pasado»): proponer_nueva_fecha con la fecha del PRÓXIMO vencimiento. Esto también quita la cita. Si no te dan la fecha nueva, pregúntala; no la inventes. Si mandan la tarjeta o el informe de la ITV, léela de ahí.
- Seguro: cada vehículo tiene la fecha en que VENCE su póliza (vencimiento «seguro»). Si renuevan el seguro o mandan la póliza, propón la fecha nueva con proponer_nueva_fecha (vencimiento «seguro»), leída del papel.
- Reparaciones: cada vehículo tiene su historial de reparaciones y mantenimiento (fecha, taller, qué se hizo, importe, km, nº de factura). Si mandan la foto o el PDF de una FACTURA DE TALLER (o cuentan una reparación), lee de ahí la matrícula, la fecha, el taller, qué se hizo, el importe TOTAL con IVA, los km y el nº de factura, y propón guardarla con proponer_reparacion (la factura se guarda también, enlazada). Si falta la matrícula o qué se hizo, pregunta. Para «¿qué se le ha hecho al…?», «¿cuánto llevamos gastado en…?» o «¿cuándo se cambió…?», usa ver_reparaciones.
- Incidencias: cosas PENDIENTES de un vehículo (lo que avisa el taller en una factura, una avería, un ruido, un golpe). Si la factura avisa de algo pendiente, ponlo en «pendiente» de proponer_reparacion. Si cuentan una avería o algo por arreglar, proponer_incidencia. Si dicen que ya se arregló, proponer_resolver_incidencia; y si apuntas una reparación que arregla una incidencia pendiente de ese vehículo (míralo con ver_incidencias), propón también resolverla. «¿Qué incidencias hay?» → ver_incidencias.
- Anular una cita: proponer_quitar_cita. Cambiar un dato (chófer, aseguradora, póliza…): proponer_cambio. Dar de alta un vehículo: proponer_alta_vehiculo.
- Guardar la foto o el PDF que viene en el mensaje en los documentos de un vehículo: proponer_guardar_archivo, diciendo SIEMPRE de qué tipo es (categoria): Permiso de circulación, Ficha técnica (también la «tarjeta ITV»), Póliza, ITV (informe de inspección), ATP, Tacógrafo, Carga y descarga, Tarjeta de transporte u Otro.

Reglas:
- Tú NUNCA guardas nada. Las herramientas proponer_* solo preparan el cambio y mandan un botón ✅ para que lo confirmen. No digas que está guardado: di que lo confirmen con el botón.
- Si no está claro de qué vehículo se habla, o falta un dato imprescindible (como la fecha de la cita), pregunta antes de proponer. Las matrículas pueden venir incompletas o con espacios: búscalas con ver_flota; si hay varias posibles, pregunta.
- Fechas siempre dd/mm/aaaa (año con 4 cifras) y horas HH:MM. «Mañana», «el martes», «el día 2»: calcúlalo con la fecha de hoy, que va al principio de cada mensaje.
- Si mandan una foto o un PDF sin decir nada, mira qué es (factura de taller, tarjeta o informe de ITV, permiso de circulación, póliza, ficha técnica, multa…), di lo que ves y propón guardarlo en el vehículo que toque (busca la matrícula en el documento). Si es una ITV favorable, propón también la nueva fecha de la próxima ITV. Si es una póliza, propón también la fecha en que vence el seguro.
- FACTURAS DE TALLER (reparación, neumáticos, frenos, frío, recambios…): usa SOLO proponer_reparacion, que ya guarda la factura enlazada a la reparación; NO uses además proponer_guardar_archivo con la misma factura. Si un PDF trae VARIAS facturas (un escaneo de varias hojas), haz una proposición proponer_reparacion por cada factura, cada una con su matrícula; el archivo se guarda una sola vez por vehículo. Si la factura no pone la matrícula, búscala por la marca y modelo o pregunta.
- No borras vehículos ni documentos: eso se hace en la web, ${URL_APP}
- Si preguntan qué hay pendiente, usa ver_flota y resume: primero las citas de hoy y mañana, luego lo vencido sin cita y lo próximo a vencer.
- Si el mensaje llega POR AUDIO (va marcado), es una transcripción automática: las matrículas y los nombres pueden venir mal oídos («nueve uno cinco uno ka uve jota», números sueltos…); búscalas en la flota y, si dudas, pregunta. Tu respuesta se leerá también en voz alta: sé más breve (2-4 frases), sin listas largas; si hay muchos vehículos, di cuántos son y los más urgentes.`;

const tramite = { type: 'string', enum: ['itv', 'atp', 'tacografo'], description: 'itv = ITV Técnica, atp = Vencimiento ATP, tacografo = Revisión Tacógrafo' };
const vencimiento = { type: 'string', enum: ['itv', 'atp', 'tacografo', 'seguro'], description: 'itv = ITV Técnica, atp = Vencimiento ATP, tacografo = Revisión Tacógrafo, seguro = vencimiento de la póliza' };
const matricula = { type: 'string', description: 'Matrícula del vehículo, tal como está en la flota' };
const fecha = { type: 'string', description: 'Fecha dd/mm/aaaa' };

const HERRAMIENTAS: Anthropic.Beta.Messages.BetaToolUnion[] = [
  { name: 'ver_flota', description: 'Todos los vehículos con chófer, fechas de ITV, ATP y tacógrafo, su estado (VENCIDO / próximo / en regla) y las citas sacadas.', input_schema: { type: 'object', properties: {} } },
  { name: 'ver_vehiculo', description: 'Todos los datos de un vehículo y la lista de sus documentos guardados.', input_schema: { type: 'object', properties: { matricula }, required: ['matricula'] } },
  { name: 'proponer_cita', description: 'Propone apuntar una cita ya sacada (pendiente de llevar el vehículo). Manda un botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, tramite, fecha, hora: { type: 'string', description: 'HH:MM, si la saben' }, lugar: { type: 'string', description: 'Estación o taller, si lo saben' }, notas: { type: 'string' } }, required: ['matricula', 'tramite', 'fecha'] } },
  { name: 'proponer_quitar_cita', description: 'Propone anular una cita apuntada. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, tramite }, required: ['matricula', 'tramite'] } },
  { name: 'proponer_nueva_fecha', description: 'El trámite ya se hizo (o se renovó el seguro): propone poner la fecha del PRÓXIMO vencimiento (y quitar la cita, si la había). Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, tramite: vencimiento, fecha }, required: ['matricula', 'tramite', 'fecha'] } },
  { name: 'proponer_cambio', description: 'Propone cambiar un dato del vehículo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, campo: { type: 'string', enum: [...CAMPOS_EDITABLES] }, valor: { type: 'string' } }, required: ['matricula', 'campo', 'valor'] } },
  { name: 'proponer_alta_vehiculo', description: 'Propone dar de alta un vehículo nuevo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, marca: { type: 'string' }, tipo: { type: 'string', description: 'CAMIÓN, FURGONETA, COCHE…' }, chofer: { type: 'string' }, tipoCaja: { type: 'string' }, capacidad: { type: 'string' }, bastidor: { type: 'string' }, fechaMatriculacion: fecha, proximaITV: fecha, vencimientoATP: fecha, revisionTacografo: fecha, vencimientoSeguro: fecha, aseguradora: { type: 'string' }, poliza: { type: 'string' } }, required: ['matricula', 'marca', 'tipo'] } },
  { name: 'proponer_guardar_archivo', description: 'Propone guardar la foto o el PDF que viene en ESTE mensaje en los documentos del vehículo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, nombre: { type: 'string', description: 'Nombre corto del documento, p. ej. «Tarjeta ITV 2026»' }, categoria: { type: 'string', enum: [...CATEGORIAS], description: 'Tipo de documento' } }, required: ['matricula', 'nombre', 'categoria'] } },
  { name: 'ver_documentacion', description: 'Qué papeles le faltan a cada vehículo (permiso, ficha técnica, póliza, ITV; ATP si es frigorífico o isotermo; tacógrafo si pasa de 3.500 kg). Con matrícula: el detalle de ese vehículo y sus documentos. Sin matrícula: toda la flota.', input_schema: { type: 'object', properties: { matricula: { ...matricula, description: 'Opcional: solo este vehículo' } } } },
  { name: 'enviar_documento', description: `Manda por este chat documentos guardados de un vehículo (como mucho ${MAX_ENVIAR}). Filtra por tipo (categoria) o por parte del nombre.`, input_schema: { type: 'object', properties: { matricula, categoria: { type: 'string', enum: [...CATEGORIAS] }, nombre: { type: 'string', description: 'Parte del nombre del archivo, si lo saben' } }, required: ['matricula'] } },
  { name: 'ver_reparaciones', description: 'Reparaciones y mantenimiento apuntados: con matrícula, la lista de ese vehículo (fecha, taller, qué, importe, km, factura) y el gasto por año; sin matrícula, el gasto de cada vehículo (este año y total) y su última reparación.', input_schema: { type: 'object', properties: { matricula: { ...matricula, description: 'Opcional: solo este vehículo' } } } },
  { name: 'proponer_reparacion', description: 'Propone apuntar una reparación o mantenimiento en un vehículo. Si el mensaje trae la foto o el PDF de la factura, se guarda también, enlazada. Si el taller avisa de algo PENDIENTE («pastillas delanteras para cambiar»), ponlo en «pendiente»: queda como incidencia del vehículo. Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, fecha, que: { type: 'string', description: 'Qué se le hizo (corto y claro)' }, taller: { type: 'string' }, importe: { type: 'number', description: 'Importe TOTAL con IVA, en euros' }, km: { type: 'number', description: 'Kilómetros del vehículo, si los pone' }, factura: { type: 'string', description: 'Nº de factura' }, pendiente: { type: 'string', description: 'Lo que el taller avisa que queda por hacer, si lo pone' } }, required: ['matricula', 'fecha', 'que'] } },
  { name: 'ver_incidencias', description: 'Incidencias PENDIENTES de la flota (o de un vehículo): avisos del taller, averías, cosas por arreglar. Cada una con su id.', input_schema: { type: 'object', properties: { matricula: { ...matricula, description: 'Opcional: solo este vehículo' } } } },
  { name: 'proponer_incidencia', description: 'Propone apuntar una incidencia pendiente en un vehículo (avería, ruido, golpe, algo por arreglar). Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, texto: { type: 'string', description: 'Qué pasa, corto y claro' }, fecha: { ...fecha, description: 'Cuándo se vio (dd/mm/aaaa); si no lo dicen, hoy' } }, required: ['matricula', 'texto'] } },
  { name: 'proponer_resolver_incidencia', description: 'Propone dar por RESUELTA una incidencia pendiente (ya se arregló). Botón ✅ para confirmar.', input_schema: { type: 'object', properties: { matricula, id: { type: 'string', description: 'id de la incidencia (de ver_incidencias); si el vehículo solo tiene una, no hace falta' }, como: { type: 'string', description: 'Cómo se arregló, si lo dicen' } }, required: ['matricula'] } },
  { name: 'planificar_revisiones', description: 'Propuesta de calendario para llevar los vehículos a ITV / ATP / tacógrafo: lo vencido o que vence en 45 días y sin cita, un vehículo al día, lunes a viernes por la tarde, sin festivos y sin pisar días que ya tienen cita.', input_schema: { type: 'object', properties: {} } },
];

// unico = file_unique_id de Telegram: el mismo archivo siempre tiene el mismo (sirve para no guardarlo dos veces).
interface Adjunto { fileId: string; nombre: string; mime: string; unico?: string }
export interface Ctx { chatId: number; quien: string; adjunto?: Adjunto; flota?: Vehicle[]; propuestas: { id: string; resumen: string }[] }

// ---------- Validaciones ----------
const esFecha = (s: unknown) => typeof s === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(s) && !!parseEsDate(s);
// 00:00 a 23:59 (antes valía «25:99», y entonces el aviso de 2 horas antes no salía nunca).
const esHora = (s: unknown) => typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);
const esTramite = (s: unknown): s is ClaveTramite => s === 'itv' || s === 'atp' || s === 'tacografo';
const esVencimiento = (s: unknown): s is ClaveVencimiento => esTramite(s) || s === 'seguro';
const textoLimpio = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 200) : '');

async function flotaDe(ctx: Ctx) {
  if (!ctx.flota) ctx.flota = await cargarFlota();
  return ctx.flota;
}

async function vehiculoDe(ctx: Ctx, m: unknown): Promise<Vehicle> {
  const vs = buscarVehiculos(await flotaDe(ctx), m);
  if (!vs.length) throw new Error(`No encuentro la matrícula «${m}» en la flota. Usa ver_flota para buscarla.`);
  // Dos fichas con la misma matrícula: no se elige una al azar (el cambio podría ir a la que no es).
  if (vs.length > 1) throw new Error(`La matrícula ${vs[0].matricula} tiene ${vs.length} fichas repetidas en la flota: hay que dejar una sola en la web (${URL_APP}) antes de cambiar nada.`);
  return vs[0];
}

// Si ya existe una ficha con esa matrícula, dentro O FUERA de la flota, el porqué (para no crear otra igual).
async function yaExiste(m: string): Promise<string | null> {
  const iguales = buscarVehiculos(await cargarTodos(), m);
  if (!iguales.length) return null;
  const fuera = iguales.find((v) => v.baja);
  return fuera && iguales.length === 1
    ? `${m} ya tiene ficha, pero está FUERA de la flota (${fuera.bajaMotivo || 'sin motivo'}${fuera.bajaFecha ? ', desde ' + fuera.bajaFecha : ''}). Para recuperarla: en la web, Vehículos → Fuera de la flota → «Volver a la flota».`
    : `${m} ya está en la flota.`;
}

// Fichas de los documentos de un vehículo (solo campos pequeños: el archivo está en el almacén o, si es viejo, en /chunks).
async function docsDe(vehicleId: string) {
  const snap = await db().collection('documents').where('vehicleId', '==', vehicleId)
    .select('name', 'type', 'categoria', 'storagePath', 'uploadedAt').get();
  return snap.docs.map((d) => ({
    id: d.id, name: d.get('name') as string, type: d.get('type') as string, categoria: d.get('categoria') as string | undefined,
    storagePath: d.get('storagePath') as string | undefined, subido: d.get('uploadedAt')?.toDate?.().toISOString().slice(0, 10),
  }));
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
          const incs = incidenciasDe(v).map((i) => `   - 🛠 INCIDENCIA pendiente: ${textoIncidencia(i)}`);
          return `${v.matricula} · ${v.marca || ''} ${v.tipo || ''}${v.chofer ? ' · chófer ' + v.chofer : ''}\n${[...alertas, ...incs].join('\n') || '   (sin fechas)'}`;
        })
        .join('\n');
    }
    case 'ver_incidencias': {
      const flota = await flotaDe(ctx);
      const lista = (e.matricula ? [await vehiculoDe(ctx, e.matricula)] : flota)
        .flatMap((v) => incidenciasDe(v).map((i) => `${v.matricula}: ${textoIncidencia(i)} [id ${i.id}]`));
      return lista.length ? `Incidencias pendientes (${lista.length}):\n${lista.join('\n')}` : 'No hay incidencias pendientes.';
    }
    case 'proponer_incidencia': {
      const v = await vehiculoDe(ctx, e.matricula);
      const texto = textoLimpio(e.texto);
      if (!texto) throw new Error('Falta qué pasa');
      const fecha = esFecha(e.fecha) ? e.fecha : hoyTexto();
      return proponer(ctx, 'incidencia', { vehicleId: v.id, matricula: v.matricula, texto, fecha },
        `${v.matricula}: apuntar incidencia «${texto}» (${fecha})`);
    }
    case 'proponer_resolver_incidencia': {
      const v = await vehiculoDe(ctx, e.matricula);
      const incs = incidenciasDe(v);
      const i = incs.find((x) => x.id === e.id) || (incs.length === 1 ? incs[0] : undefined);
      if (!i) throw new Error(incs.length ? `${v.matricula} tiene ${incs.length} incidencias: di cuál (usa ver_incidencias para ver su id)` : `${v.matricula} no tiene incidencias pendientes`);
      return proponer(ctx, 'resolver_incidencia', { vehicleId: v.id, matricula: v.matricula, id: i.id, texto: i.texto, como: textoLimpio(e.como) },
        `${v.matricula}: dar por resuelta la incidencia «${i.texto}»${e.como ? ' (' + textoLimpio(e.como) + ')' : ''}`);
    }
    case 'ver_vehiculo': {
      const v = await vehiculoDe(ctx, e.matricula);
      const docs = await docsDe(v.id!);
      const { createdAt, ...datos } = v as any;
      const estado = estadoDocumentacion(v, docs);
      return JSON.stringify({
        ...datos,
        documentos: docs.map((d) => ({ nombre: d.name, categoria: categoriaDe(d), subido: d.subido })),
        papelesQueFaltan: estado.faltan,
      });
    }
    case 'ver_documentacion': {
      if (e.matricula) {
        const v = await vehiculoDe(ctx, e.matricula);
        const est = estadoDocumentacion(v, await docsDe(v.id!));
        return `${v.matricula}: ${est.completos} de ${est.total} papeles.\n` + est.exigidos
          .map((x) => `- ${x.categoria}: ${x.docs.length ? 'SÍ (' + x.docs.map((d) => d.name).join('; ') + ')' : 'FALTA'}`).join('\n');
      }
      // Toda la flota: una sola lectura de las fichas de documentos (ligeras).
      const todos = await db().collection('documents').select('vehicleId', 'name', 'categoria').get();
      const porVeh = new Map<string, DocResumen[]>();
      todos.docs.forEach((d) => { const vid = d.get('vehicleId'); if (vid) (porVeh.get(vid) || porVeh.set(vid, []).get(vid)!).push({ name: d.get('name'), categoria: d.get('categoria') }); });
      const flota = (await flotaDe(ctx)).slice().sort((a, b) => a.matricula.localeCompare(b.matricula));
      const lineas = flota.map((v) => ({ v, est: estadoDocumentacion(v, porVeh.get(v.id!) || []) }));
      const incompletos = lineas.filter((l) => l.est.faltan.length);
      return `${flota.length} vehículos; ${incompletos.length} con documentación incompleta.\n` +
        incompletos.map((l) => `${l.v.matricula}: falta ${l.est.faltan.join(', ')}`).join('\n');
    }
    case 'enviar_documento': {
      const v = await vehiculoDe(ctx, e.matricula);
      let docs = await docsDe(v.id!);
      if (esCategoria(e.categoria)) docs = docs.filter((d) => categoriaDe(d) === e.categoria);
      const trozo = String(e.nombre || '').toLowerCase().trim();
      if (trozo) docs = docs.filter((d) => String(d.name || '').toLowerCase().includes(trozo));
      if (docs.length === 0) return `${v.matricula} no tiene ningún documento así guardado.`;
      const enviados: string[] = [];
      const pendientes: string[] = [];
      for (const d of docs.slice(0, MAX_ENVIAR)) {
        if (!d.storagePath) { pendientes.push(d.name || 'documento'); continue; }   // viejo, aún troceado en la base
        await tg('sendChatAction', { chat_id: ctx.chatId, action: 'upload_document' }).catch(() => {});
        await enviarDocumentoTelegram(ctx.chatId, await leer(d.storagePath), d.name || 'documento', d.type || '',
          `📄 <b>${esc(v.matricula)}</b> · ${esc(categoriaDe(d))}`);
        enviados.push(d.name || 'documento');
      }
      return [
        enviados.length ? `Enviados ${enviados.length}: ${enviados.join('; ')}.` : '',
        pendientes.length ? `No se pueden mandar todavía (son de los antiguos, se están pasando al almacén nuevo): ${pendientes.join('; ')}.` : '',
        docs.length > MAX_ENVIAR ? `Hay ${docs.length - MAX_ENVIAR} más; pide el que quieras por su nombre o tipo.` : '',
      ].filter(Boolean).join(' ');
    }
    case 'planificar_revisiones': {
      const flota = await flotaDe(ctx);
      const [d, m, a] = hoyTexto().split('/').map(Number);
      const hoy = new Date(a, m - 1, d);
      const plan = planificar(tareasPendientes(flota, hoy), diasOcupados(flota), hoy);
      return 'Propuesta (1 vehículo al día, lunes a viernes por la tarde):\n' + textoPlan(plan);
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
      if (!esVencimiento(e.tramite)) throw new Error('Vencimiento no válido: itv, atp, tacografo o seguro');
      if (!esFecha(e.fecha)) throw new Error('La fecha tiene que ser dd/mm/aaaa');
      const t = VENCIMIENTOS.find((x) => x.clave === e.tramite)!;
      const tieneCita = t.clave !== 'seguro' && !!v.citas?.[t.clave];
      const antes = v[t.campo] || 'sin fecha';
      return proponer(ctx, 'nueva_fecha', { vehicleId: v.id, matricula: v.matricula, clave: t.clave, campo: t.campo, fecha: e.fecha, antes, label: t.label },
        t.clave === 'seguro'
          ? `${v.matricula}: el seguro vence el ${e.fecha} (antes ${antes})`
          : `${v.matricula}: ${t.label} hecha → próximo vencimiento ${e.fecha} (antes ${antes})${tieneCita ? ' y se quita la cita' : ''}`);
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
      const repetida = await yaExiste(m);
      if (repetida) throw new Error(repetida);
      for (const f of ['fechaMatriculacion', 'proximaITV', 'vencimientoATP', 'revisionTacografo', 'vencimientoSeguro']) {
        if (e[f] && !esFecha(e[f])) throw new Error(`${f} tiene que ser dd/mm/aaaa`);
      }
      const campos = ['marca', 'tipo', 'tipoCaja', 'capacidad', 'fechaMatriculacion', 'bastidor', 'chofer', 'aseguradora', 'poliza', 'proximaITV', 'vencimientoATP', 'revisionTacografo', 'vencimientoSeguro'];
      const vehiculo: Record<string, string> = { matricula: m };
      for (const c of campos) vehiculo[c] = textoLimpio(e[c]);
      return proponer(ctx, 'alta', { vehiculo }, `Alta de ${m}: ${vehiculo.marca} ${vehiculo.tipo}${vehiculo.chofer ? ', chófer ' + vehiculo.chofer : ''}`);
    }
    case 'ver_reparaciones': {
      const leerDe = async (v: Vehicle) => ordenar((await db().collection('vehicles').doc(v.id!).collection('reparaciones').get())
        .docs.map((d) => ({ id: d.id, ...(d.data() as Reparacion) })));
      const anio = hoyTexto().slice(-4);
      if (e.matricula) {
        const v = await vehiculoDe(ctx, e.matricula);
        const rs = await leerDe(v);
        if (!rs.length) return `${v.matricula}: no hay ninguna reparación apuntada.`;
        const g = gastoPorAnio(rs);
        const anios = Object.keys(g).sort().reverse().map((a) => `${a}: ${euros(g[a].total)} (${g[a].n})`).join(' · ');
        return `${v.matricula} — ${rs.length} reparaciones. Gasto por año: ${anios}\n` +
          rs.slice(0, 40).map((x) => `- ${textoReparacion(x)}${x.documentoId ? ' · (con factura)' : ''}`).join('\n') +
          (rs.length > 40 ? `\n… y ${rs.length - 40} más antiguas` : '');
      }
      const lineas: string[] = [];
      let totalAnio = 0;
      for (const v of await flotaDe(ctx)) {
        const rs = await leerDe(v);
        if (!rs.length) continue;
        const g = gastoPorAnio(rs);
        const esteAnio = g[anio]?.total || 0;
        totalAnio += esteAnio;
        lineas.push(`${v.matricula}: ${anio} ${euros(esteAnio)} · total ${euros(rs.reduce((s, x) => s + (x.importe || 0), 0))} en ${rs.length} · última ${rs[0].fecha} (${rs[0].que})`);
      }
      return lineas.length ? `Gasto en reparaciones en ${anio}: ${euros(totalAnio)}\n${lineas.join('\n')}` : 'No hay ninguna reparación apuntada en la flota.';
    }
    case 'proponer_reparacion': {
      const v = await vehiculoDe(ctx, e.matricula);
      if (!esFecha(e.fecha)) throw new Error('La fecha tiene que ser dd/mm/aaaa');
      const que = textoLimpio(e.que);
      if (!que) throw new Error('Falta qué se le hizo');
      const importe = e.importe != null && e.importe !== '' ? leerImporte(e.importe) : null;
      if (e.importe != null && e.importe !== '' && importe === null) throw new Error('El importe no se entiende');
      const km = Number(e.km) > 0 ? Math.round(Number(e.km)) : null;
      const pendiente = textoLimpio(e.pendiente);
      const rep = { fecha: e.fecha, que, taller: textoLimpio(e.taller), importe, km, factura: textoLimpio(e.factura), ...(pendiente ? { notas: pendiente } : {}) };
      return proponer(ctx, 'reparacion', { vehicleId: v.id, matricula: v.matricula, rep, adjunto: ctx.adjunto || null },
        `${v.matricula}: reparación del ${e.fecha}${rep.taller ? ' en ' + rep.taller : ''} — ${que}${importe != null ? ' — ' + euros(importe) : ''}${km ? ` — ${km} km` : ''}${ctx.adjunto ? ' (con la factura adjunta)' : ''}` +
        (pendiente ? `\n🛠 Queda como incidencia: «${pendiente}»` : ''));
    }
    case 'proponer_guardar_archivo': {
      if (!ctx.adjunto) throw new Error('Este mensaje no trae ninguna foto ni archivo. Pide que lo manden.');
      const v = await vehiculoDe(ctx, e.matricula);
      const categoria = esCategoria(e.categoria) ? e.categoria : 'Otro';
      const base = textoLimpio(e.nombre) || 'Documento';
      const ext = ctx.adjunto.nombre.includes('.') ? ctx.adjunto.nombre.slice(ctx.adjunto.nombre.lastIndexOf('.')) : '';
      const nombre = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? base + ext : base;
      return proponer(ctx, 'archivo', { ...ctx.adjunto, nombreOriginal: ctx.adjunto.nombre, vehicleId: v.id, matricula: v.matricula, nombre, categoria },
        `${v.matricula}: guardar «${nombre}» (${categoria}) en sus documentos`);
    }
  }
  throw new Error(`Herramienta desconocida: ${nombre}`);
}

// ---------- Aplicar un cambio confirmado con ✅ ----------
async function aplicar(p: any, quien: string) {
  const d = p.datos;
  const veh = d.vehicleId ? db().collection('vehicles').doc(d.vehicleId) : null;
  const actual = veh ? await veh.get() : null;
  if (veh && !actual!.exists) throw new Error(`El vehículo ${d.matricula} ya no existe`);
  // Cada cambio queda en el historial del vehículo (quién, cuándo, qué), igual que los de la web.
  const historial = (que: string) => conCambio(actual!.get('historial'), nuevoCambio(`Telegram · ${quien}`, que));
  switch (p.tipo) {
    case 'cita':
      await veh!.update({
        [`citas.${d.clave}`]: { ...d.cita, confirmadoPor: quien, el: FieldValue.serverTimestamp() },
        historial: historial(`Cita de ${NOMBRE_TRAMITE[d.clave as ClaveTramite] || d.clave}: ${d.cita.fecha}${d.cita.hora ? ' ' + d.cita.hora : ''}${d.cita.lugar ? ' (' + d.cita.lugar + ')' : ''}`),
      });
      return;
    case 'quitar_cita':
      await veh!.update({ [`citas.${d.clave}`]: FieldValue.delete(), historial: historial(`Quitada la cita de ${NOMBRE_TRAMITE[d.clave as ClaveTramite] || d.clave}`) });
      return;
    case 'nueva_fecha': {
      const cambios: Record<string, unknown> = { [d.campo]: d.fecha, historial: historial(`${d.label || d.campo}: ${d.antes || '—'} → ${d.fecha}`) };
      if (d.clave !== 'seguro') cambios[`citas.${d.clave}`] = FieldValue.delete();   // el trámite se hizo: fuera la cita
      await veh!.update(cambios);
      return;
    }
    case 'cambio':
      await veh!.update({ [d.campo]: d.valor, historial: historial(`${d.campo}: ${(actual!.get(d.campo) as string) || '—'} → ${d.valor}`) });
      return;
    case 'alta': {
      // Se vuelve a mirar al confirmar (pudo darse de alta por la web entretanto), también entre los de fuera de la flota.
      const repetida = await yaExiste(d.vehiculo.matricula);
      if (repetida) throw new Error(repetida);
      await db().collection('vehicles').add({
        ...d.vehiculo, priority: 'medium', createdAt: FieldValue.serverTimestamp(),
        historial: [nuevoCambio(`Telegram · ${quien}`, 'Alta del vehículo')],
      });
      return;
    }
    case 'reparacion': {
      // La misma factura no se apunta dos veces (matrícula|fecha|nº de factura, la misma clave que usa el importador).
      const ref = refReparacion(d.matricula, d.rep.fecha, d.rep.factura);
      if (d.rep.factura) {
        const repe = await veh!.collection('reparaciones').where('ref', '==', ref).limit(1).get();
        if (!repe.empty) throw new Error(`Esta factura (${d.rep.taller} ${d.rep.factura}) ya está apuntada en ${d.matricula}`);
      }
      // La factura (si vino en el mensaje) primero: así la reparación nace ya enlazada a ella. Si el mismo archivo ya
      // se guardó en este vehículo (un PDF con varias facturas → varias propuestas), se reutiliza en vez de duplicarlo.
      let documentoId: string | null = null;
      if (d.adjunto?.unico) {
        const ya = await db().collection('documents').where('telegramUnico', '==', d.adjunto.unico).select('vehicleId').get();
        documentoId = ya.docs.find((x) => x.get('vehicleId') === d.vehicleId)?.id || null;
      }
      if (d.adjunto && !documentoId) {
        const a = d.adjunto;
        if (!TIPOS_ARCHIVO.includes(a.mime)) throw new Error(`La factura no es un PDF ni una foto (${a.mime})`);
        const { datos } = await bajarArchivoTelegram(a.fileId);
        if (datos.length > MAX_BYTES) throw new Error('La factura pesa más de 25 MB');
        const nombre = `Factura ${d.matricula} ${d.rep.fecha.split('/').reverse().join('-')}${a.nombre.includes('.') ? a.nombre.slice(a.nombre.lastIndexOf('.')) : ''}`;
        const ruta = rutaNueva(d.vehicleId, nombre);
        await guardar(ruta, datos, a.mime);
        documentoId = (await db().collection('documents').add({
          vehicleId: d.vehicleId, name: nombre, type: a.mime, size: datos.length, categoria: 'Factura de taller',
          url: '', isChunked: false, storagePath: ruta, uploadedAt: FieldValue.serverTimestamp(), subidoPor: `Telegram · ${quien}`,
          ...(a.unico ? { telegramUnico: a.unico } : {}),
        })).id;
      }
      const repRef = await veh!.collection('reparaciones').add({
        ...d.rep, dia: diaDe(d.rep.fecha), ...(documentoId ? { documentoId } : {}), ...(d.rep.factura ? { ref } : {}),
        origen: 'telegram', creadoPor: `Telegram · ${quien}`, creado: FieldValue.serverTimestamp(),
      });
      // Lo que el taller avisa que queda pendiente → incidencia del vehículo (sale en el reporte de Telegram).
      const extra: Record<string, unknown> = {};
      if (d.rep.notas) {
        extra.incidencias = conIncidencia(actual!.data() as Vehicle,
          nuevaIncidencia(d.rep.notas, d.rep.fecha, `${d.rep.taller || 'taller'}${d.rep.factura ? ', factura ' + d.rep.factura : ''}`, repRef.id));
      }
      await veh!.update({
        ultimaReparacion: d.rep.fecha, ...extra,
        historial: historial(`Reparación: ${d.rep.fecha} · ${d.rep.que}${d.rep.importe != null ? ' · ' + euros(d.rep.importe) : ''}${d.rep.notas ? ' · incidencia: ' + d.rep.notas : ''}`),
      });
      return;
    }
    case 'incidencia':
      await veh!.update({
        incidencias: conIncidencia(actual!.data() as Vehicle, nuevaIncidencia(d.texto, d.fecha, `Telegram · ${quien}`)),
        historial: historial(`Incidencia: ${d.texto}`),
      });
      return;
    case 'resolver_incidencia': {
      const v = actual!.data() as Vehicle;
      if (!incidenciasDe(v).some((x) => x.id === d.id)) throw new Error('Esa incidencia ya no está pendiente');
      await veh!.update({
        incidencias: sinIncidencia(v, d.id),
        historial: historial(`Incidencia resuelta: ${d.texto}${d.como ? ' (' + d.como + ')' : ''}`),
      });
      return;
    }
    case 'archivo': {
      // 25/11/2026: el archivo va a Google Cloud Storage y en Firestore solo su ficha (antes iba troceado en la base,
      // y los archivos agotaron su cuota diaria). Primero el archivo y luego la ficha: si algo falla a medias, no queda
      // una ficha que apunte a nada.
      if (!TIPOS_ARCHIVO.includes(d.mime)) throw new Error(`Ese tipo de archivo (${d.mime}) no se guarda: solo PDF o fotos`);
      const { datos } = await bajarArchivoTelegram(d.fileId);
      if (datos.length > MAX_BYTES) throw new Error('El archivo pesa más de 25 MB');
      const ruta = rutaNueva(d.vehicleId, d.nombre);
      await guardar(ruta, datos, d.mime);
      await db().collection('documents').add({
        vehicleId: d.vehicleId, name: d.nombre, type: d.mime, size: datos.length, categoria: esCategoria(d.categoria) ? d.categoria : 'Otro',
        url: '', isChunked: false, storagePath: ruta, uploadedAt: FieldValue.serverTimestamp(), subidoPor: `Telegram · ${quien}`,
      });
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
        if (esCuotaAgotada(err)) throw err;   // la base no deja leer hasta las 9:00: se contesta con el aviso claro
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
    adjunto = { fileId: grande.file_id, unico: grande.file_unique_id, nombre: `foto-${hoyTexto().split('/').reverse().join('-')}.jpg`, mime: 'image/jpeg' };
  } else if (msg.document) {
    adjunto = { fileId: msg.document.file_id, unico: msg.document.file_unique_id, nombre: msg.document.file_name || 'archivo', mime: msg.document.mime_type || 'application/octet-stream' };
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
    notaAdjunto = `\n[Adjunta un archivo: «${adjunto.nombre}» (${adjunto.mime}, ${Math.round(datos.length / 1024)} KB). Si es una factura de taller: proponer_reparacion (una por factura). Si es otro papel: proponer_guardar_archivo.]`;
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
    // En una transacción: si justo otro pulsó ✅ y se está guardando, el ❌ no lo pisa.
    const cancelado = await db().runTransaction(async (t) => {
      const s = await t.get(ref);
      if (s.get('estado') !== 'pendiente') return false;
      t.update(ref, { estado: 'cancelada', decididoPor: quien, decidido: FieldValue.serverTimestamp() });
      return true;
    });
    if (!cancelado) return contestar('Ya estaba en marcha');
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
    // Se vuelven a poner los botones: la propuesta sigue pendiente y se puede reintentar (antes desaparecían).
    await tg('editMessageText', {
      chat_id: chatId, message_id: cq.message.message_id, parse_mode: 'HTML',
      text: `⚠️ ${esc(p.resumen)}\nNo se pudo guardar: ${esc(err?.message || err)}`,
      reply_markup: { inline_keyboard: [[{ text: '🔁 Reintentar', callback_data: `ok:${id}` }, { text: '❌ No', callback_data: `no:${id}` }]] },
    }).catch(() => {});
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
  } catch (e: any) {
    // SOLO «ya existe» (código 6) quiere decir que Telegram lo reintentó y ya se atendió. Cualquier otro fallo (cuota
    // agotada, red…) se relanza: antes se tomaba por «repetido» y el mensaje se perdía sin contestar nada.
    if (e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message))) return false;
    throw e;
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

  // Siempre se contesta 200 a Telegram (si no, reintenta el mismo mensaje una y otra vez).
  try {
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

    if (update.callback_query) await atenderBoton(update.callback_query);
    else if (update.message) await atenderMensaje(update.message);
  } catch (err: any) {
    console.error('[telegram] error:', err);
    const texto = esCuotaAgotada(err) ? `⚠️ ${AVISO_CUOTA}` : `⚠️ Algo ha fallado: ${String(err?.message || err).slice(0, 300)}`;
    await tg('sendMessage', { chat_id: chatId, text: texto }).catch(() => {});
  }
  return res.status(200).json({ ok: true });
}
