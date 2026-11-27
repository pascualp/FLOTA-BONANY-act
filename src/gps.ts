// Lo que se lee del GPS ControlGPS (27/11/2026, Facu: «podemos ver quiénes están en el taller» y «saber si los coches
// de los chóferes que están en reparto están en regla o qué falta»). Del GPS SOLO se lee: nunca se cambia nada allí.
// Lo usan la web, las funciones de Vercel y las pruebas: sin nada del navegador.
import type { Gps } from './types.js';

type ConGps = { gps?: Gps };

// «27/11/26 09:12» → Date (hora de aquí). null si no se entiende.
export const fechaSenal = (s: unknown): Date | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(y, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const mismoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// En el GPS el taller se marca poniendo de «conductor» uno de los «00 TALLER …» (en la tabla salen recortados: «TALLER
// ISUZU», «MEBASA», «TM ALCUDIA»). La lista es la de Configuración → conductores/empleados del 27/11/2026.
export const TALLERES_GPS = ['ISUZU', 'MEDSEA', 'ANTICH - ST JOAN', 'BALCAR', 'MEBASA', 'NEURETEC', 'REFRICAR', 'TM ALCUDIA'];
export const tallerDe = (conductor: unknown): string | undefined => {
  const sinNumero = String(conductor ?? '').toUpperCase().replace(/^\d+\s+/, '').trim();   // «00 TALLER ISUZU» → «TALLER ISUZU»
  const c = sinNumero.replace(/^TALLER\s+/, '').trim();
  if (!c) return undefined;
  // Uno de la lista, o cualquier otro que empiece por «TALLER» (si mañana dan de alta otro taller en el GPS).
  return TALLERES_GPS.includes(c) || /^TALLER\b/.test(sinNumero) ? c : undefined;
};

export const enTaller = (v: ConGps): string | undefined => v.gps?.taller || undefined;

// «En reparto hoy»: en el GPS tiene un CHÓFER puesto (no un taller, no vacío) y le dio señal HOY (lo que dice la última
// lectura del GPS). Solo la señal no basta: el GPS da señal también con el camión parado en la base (el 27/11 el
// 1886HTY, sin chófer y con el motor apagado, tenía señal de las 09:12).
export const enRepartoHoy = (v: ConGps, hoy = new Date()): boolean => {
  if (!v.gps || v.gps.taller || !String(v.gps.conductor || '').trim()) return false;
  const s = fechaSenal(v.gps.senal);
  return !!s && mismoDia(s, hoy);
};

// Días sin señal (para avisar de un GPS que no da señal, p. ej. el 6221LJM desde el 12/11).
export const diasSinSenal = (v: ConGps, hoy = new Date()): number | null => {
  const s = fechaSenal(v.gps?.senal);
  if (!s) return null;
  const a = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
  const b = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  return Math.round((b - a) / 86400000);
};

// «leído el 27/11/2026 a las 09:20»
export const cuandoLeido = (v: ConGps) => {
  if (!v.gps?.leido) return '';
  const d = new Date(v.gps.leido);
  return Number.isNaN(d.getTime()) ? '' : `leído el ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
};
