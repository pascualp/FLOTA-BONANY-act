import { differenceInCalendarDays } from 'date-fns';
import { Vehicle, AlertStatus, ClaveTramite, ClaveVencimiento, Cita, Cambio } from './types';
// «.js» aunque sea .ts: este archivo también lo usan las funciones de Vercel (módulos ES de Node), y sin la extensión
// no encuentran un import que no sea solo de tipos.
import { documentosExigidos, type Categoria } from './documentos.js';

// Los tres trámites con fecha y cita de la flota: clave corta, nombre en pantalla y campo del vehículo.
// Son los que se planifican, se piden con cita y se avisan 2 h antes.
export const TRAMITES: { clave: ClaveTramite; label: string; campo: 'proximaITV' | 'vencimientoATP' | 'revisionTacografo' }[] = [
  { clave: 'itv', label: 'ITV Técnica', campo: 'proximaITV' },
  { clave: 'atp', label: 'Vencimiento ATP', campo: 'vencimientoATP' },
  { clave: 'tacografo', label: 'Revisión Tacógrafo', campo: 'revisionTacografo' },
];

// Todo lo que VENCE y se vigila (alertas, correo, Telegram): los trámites y además el seguro, que no lleva cita.
export type CampoVencimiento = 'proximaITV' | 'vencimientoATP' | 'revisionTacografo' | 'vencimientoSeguro';
export const VENCIMIENTOS: { clave: ClaveVencimiento; label: string; campo: CampoVencimiento }[] = [
  ...TRAMITES,
  { clave: 'seguro', label: 'Seguro', campo: 'vencimientoSeguro' },
];
export const esTramiteConCita = (c: ClaveVencimiento): c is ClaveTramite => c !== 'seguro';

// «9151 kwj», «9151-KWJ» → «9151KWJ». La misma regla en la web, el bot y los scripts: así no hay dos fichas iguales.
export const normalizarMatricula = (m: unknown) => String(m ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- Historial de cambios de cada vehículo ----------
export const HISTORIAL_MAX = 15;
export const nuevoCambio = (por: string, que: string): Cambio => ({ cuando: new Date().toISOString(), por, que: que.slice(0, 300) });
// Lista para guardar: el cambio nuevo delante y como mucho HISTORIAL_MAX (la ficha no crece sin fin: cada lectura de
// la flota la paga entera).
export const conCambio = (historial: Cambio[] | undefined, c: Cambio): Cambio[] =>
  [c, ...(Array.isArray(historial) ? historial : [])].slice(0, HISTORIAL_MAX);

// ---------- Fechas del formulario (calendario del navegador: aaaa-mm-dd) ----------
// Lo guardado (dd/mm/aaaa, o lo que se escribiera a mano) → valor del calendario. '' si no se entiende.
export const aFechaInput = (s: unknown) => {
  const d = parseEsDate(s);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
};
// Valor del calendario → dd/mm/aaaa, como se guarda.
export const deFechaInput = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// «Cita 02/12/2026 10:00 (Inca) – pendiente de llevar»
export const textoCita = (c: Cita) =>
  `Cita ${c.fecha}${c.hora ? ' ' + c.hora : ''}${c.lugar ? ' (' + c.lugar + ')' : ''} – pendiente de llevar`;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Meses escritos con letras, en castellano y en catalán («sep/2026», «septiembre de 2026», «set. 2026», «maig 2027»…).
const MESES: Record<string, number> = {
  ene: 1, enero: 1, gen: 1, gener: 1,
  feb: 2, febrero: 2, febr: 2, febrer: 2,
  mar: 3, marzo: 3, marc: 3,
  abr: 4, abril: 4,
  may: 5, mayo: 5, maig: 5,
  jun: 6, junio: 6, juny: 6,
  jul: 7, julio: 7, juliol: 7,
  ago: 8, agosto: 8, ag: 8, agost: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, setembre: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11, novembre: 11,
  dic: 12, diciembre: 12, des: 12, desembre: 12,
};

// Lo que se escribe en una fecha cuando ese trámite no le toca al vehículo: no es una alerta.
const NO_APLICA = /^(n\/?a|no aplica|no procede|no tiene|no lleva|-+)$/;
export const noAplica = (valor: unknown) =>
  typeof valor === 'string' && NO_APLICA.test(sinTildes(valor).trim().toLowerCase());

// Fecha escrita a mano → Date (o null si no se entiende). Las fechas de la flota se teclean de muchas formas:
// «23/03/27», «20/08/2026», «15-05-2027», «15.05.2027», «15 de mayo de 2027», y también solo mes y año («05/30»,
// «03-2027», «sep/2026»). Un certificado «válido hasta septiembre de 2026» vale TODO ese mes: con solo mes y año se
// toma el ÚLTIMO día del mes (antes se tomaba el 1 y daba por vencido lo que aún valía).
// No se adivina: «00/00/00», «31/02/27», «FALTA» o «ITV 23/03/27» → null, y la app lo enseña como «fecha que no entiendo».
export const parseEsDate = (dateStr: any): Date | null => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  let s = sinTildes(dateStr.split('(')[0]).toLowerCase().trim();
  if (!/\d/.test(s)) return null;
  s = s.replace(/[a-z]+/g, (w) => (MESES[w] ? ` ${MESES[w]} ` : w === 'de' || w === 'del' ? ' ' : w));
  const partes = s.split(/[/\-.\s]+/).filter(Boolean);
  if (!partes.every((p) => /^\d+$/.test(p))) return null;
  const anio = (t: string) => (t.length === 2 ? 2000 + Number(t) : t.length === 4 ? Number(t) : NaN);
  let d: number, m: number, y: number;
  if (partes.length === 3) {
    d = Number(partes[0]); m = Number(partes[1]); y = anio(partes[2]);
  } else if (partes.length === 2) {
    m = Number(partes[0]); y = anio(partes[1]);
    d = new Date(y, m, 0).getDate();   // día 0 del mes siguiente = último día de este mes
  } else return null;
  if (!(m >= 1 && m <= 12) || !(y >= 1990 && y <= 2100)) return null;
  const f = new Date(y, m - 1, d);
  // Sin desbordes: «31/02/27» no se convierte en el 3 de marzo.
  return f.getFullYear() === y && f.getMonth() === m - 1 && f.getDate() === d ? f : null;
};

// Estado de un trámite según su fecha. «hoy» se puede pasar para las pruebas.
// Vence el mismo día que pone la fecha: ese día aún vale; al día siguiente, VENCIDO.
export const getAlertStatus = (dateStr: string, priority: 'low' | 'medium' | 'high' = 'medium', hoy = new Date()): AlertStatus => {
  const d = parseEsDate(dateStr);
  if (!d) return { status: 'unknown', text: /falta/i.test(String(dateStr)) ? 'Falta la fecha' : 'Fecha que no entiendo' };
  const dias = differenceInCalendarDays(d, hoy);
  if (dias < 0) return { status: 'danger', text: 'VENCIDO' };
  // Cuánto antes se avisa, según la prioridad del vehículo.
  const aviso = priority === 'high' ? 60 : priority === 'low' ? 15 : 30;
  if (dias <= aviso) return { status: 'warning', text: dias === 0 ? 'Vence HOY' : dias === 1 ? 'Vence mañana' : `Vence en ${dias} días` };
  return { status: 'success', text: 'En regla' };
};

// ---------- Cómo se dice en pantalla (26/11/2026, Facu: «que no confunda a una persona que lo ve por primera vez») ----------
// Nombre corto de cada vencimiento en la web (el largo, «ITV Técnica», «Vencimiento ATP», sigue en el correo y Telegram).
export const NOMBRE_CORTO: Record<ClaveVencimiento, string> = { itv: 'ITV', atp: 'ATP', tacografo: 'Tacógrafo', seguro: 'Seguro' };

// Las fechas se guardaron escritas de mil formas («02/29», «23/10/24», «sep/2026»): en pantalla, siempre dd/mm/aaaa.
// Lo guardado no se toca. Si no se entiende, sale tal cual.
export const fechaEnPantalla = (s: unknown) => {
  const d = parseEsDate(s);
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : String(s ?? '');
};

// «3 días», «7 meses», «2 años»
const cuantoTiempo = (dias: number) => {
  const n = Math.abs(dias);
  if (n < 45) return `${n} ${n === 1 ? 'día' : 'días'}`;
  if (n < 730) { const m = Math.round(n / 30.44); return `${m} ${m === 1 ? 'mes' : 'meses'}`; }
  return `${Math.floor(n / 365.25)} años`;
};

// Un vencimiento dicho con una frase: «Caducó el 18/04/2026, hace 7 meses», «Caduca el 30/11/2026, en 4 días»,
// «Falta apuntar la fecha», «Cita el 02/12/2026 a las 16:30 en Inca · caducó el…». «hoy» se puede pasar en las pruebas.
export const fraseVencimiento = (a: AlertaVehiculo, hoy = new Date()): string => {
  const d = parseEsDate(a.date);
  const dias = d ? differenceInCalendarDays(d, hoy) : 0;
  const frase =
    a.status === 'unknown' ? (a.text === 'Falta la fecha' ? 'Falta apuntar la fecha' : `No se entiende la fecha «${a.date}»: corrígela en la ficha`)
    : !d ? a.text
    : dias < 0 ? `Caducó el ${fechaEnPantalla(a.date)}, hace ${cuantoTiempo(dias)}`
    : dias === 0 ? `Caduca HOY (${fechaEnPantalla(a.date)})`
    : dias === 1 ? `Caduca mañana (${fechaEnPantalla(a.date)})`
    : a.status === 'warning' ? `Caduca el ${fechaEnPantalla(a.date)}, en ${cuantoTiempo(dias)}`
    : `En regla hasta el ${fechaEnPantalla(a.date)}`;
  if (!a.cita) return frase;
  const cita = `Cita el ${a.cita.fecha}${a.cita.hora ? ' a las ' + a.cita.hora : ''}${a.cita.lugar ? ' en ' + a.cita.lugar : ''}`;
  return `${cita} · ${frase.charAt(0).toLowerCase()}${frase.slice(1)}`;
};

export const getMissingFields = (v: Vehicle) => {
  const missing: string[] = [];
  if (!v.matricula) missing.push('Matrícula');
  if (!v.marca) missing.push('Marca');
  if (!v.proximaITV) missing.push('Próxima ITV');
  if (!v.bastidor) missing.push('Nº Bastidor');
  if (!v.tipoCaja && v.tipo !== 'COCHE') missing.push('Tipo de Caja');
  return missing;
};

// El papel que corresponde a cada vencimiento (para saber si a este vehículo le toca: ver documentosExigidos).
export const PAPEL: Record<ClaveVencimiento, Categoria> = { itv: 'ITV', atp: 'ATP', tacografo: 'Tacógrafo', seguro: 'Póliza' };

export type AlertaVehiculo = {
  label: string; status: 'danger' | 'warning' | 'success' | 'unknown'; text: string; date: string; clave: ClaveVencimiento; cita?: Cita;
};

export const getVehicleAlerts = (v: Vehicle): AlertaVehiculo[] => {
  const alerts: AlertaVehiculo[] = [];
  const exigidos = documentosExigidos(v);

  VENCIMIENTOS.forEach(t => {
    const value = v[t.campo];
    const cita = esTramiteConCita(t.clave) ? v.citas?.[t.clave] : undefined;
    if (noAplica(value)) return;   // «N/A», «no aplica»…: quien lo escribió dice que no le toca
    if (!value || !String(value).trim()) {
      // Sin fecha: si le toca (ITV y seguro siempre; ATP si lleva frío; tacógrafo si pasa de 3.500 kg) es un dato
      // que falta, no un vehículo «al día».
      if (exigidos.includes(PAPEL[t.clave])) {
        alerts.push({ label: t.label, status: 'unknown', text: 'Falta la fecha', date: 'sin fecha', clave: t.clave, cita });
      }
      return;
    }
    const st = getAlertStatus(value, v.priority || 'medium');
    alerts.push({ label: t.label, ...st, date: value, clave: t.clave, cita });
  });

  return alerts;
};

// Papeles que el vehículo TIENE guardados pero cuya fecha ya pasó (ITV, ATP, tacógrafo o póliza vencidos): «tener el
// PDF» no es «estar en regla».
export const papelesCaducados = (v: Vehicle): Categoria[] =>
  getVehicleAlerts(v).filter(a => a.status === 'danger').map(a => PAPEL[a.clave]);

// Lo que de verdad hay que mirar de un vehículo: para la insignia de la tarjeta y el contador del menú.
// Lo que está «En regla» NO cuenta (antes la insignia contaba todas las fechas: «3 alertas» con todo bien).
// Lo que ya tiene cita sacada cuenta aparte: ya está en marcha.
export const problemasDe = (v: Vehicle) => {
  const al = getVehicleAlerts(v);
  return {
    vencidos: al.filter(a => a.status === 'danger' && !a.cita).length,
    pronto: al.filter(a => a.status === 'warning' && !a.cita).length,
    revisar: al.filter(a => a.status === 'unknown' && !a.cita).length,
    conCita: al.filter(a => a.cita).length,
  };
};

export const getAllAlerts = (vehicles: Vehicle[]) => {
  const alerts: any[] = [];
  vehicles.forEach(v => {
    const vAlerts = getVehicleAlerts(v);
    vAlerts.forEach(a => {
      alerts.push({ vehicle: v, type: a.label, date: a.date, status: { status: a.status, text: a.text }, clave: a.clave, cita: a.cita });
    });
  });
  return alerts.sort((a, b) => {
    const priority = { danger: 0, warning: 1, unknown: 2, success: 3 };   // una fecha que no se entiende va antes que lo que está en regla
    const pA = priority[a.status.status as keyof typeof priority] ?? 4;
    const pB = priority[b.status.status as keyof typeof priority] ?? 4;
    
    if (pA !== pB) return pA - pB;

    const da = parseEsDate(a.date);
    const db = parseEsDate(b.date);
    if (!da || !db) return (da ? 0 : 1) - (db ? 0 : 1);
    return da.getTime() - db.getTime();
  });
};
