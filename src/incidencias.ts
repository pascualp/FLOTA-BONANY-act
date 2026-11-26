// Incidencias pendientes de los vehículos (26/11/2026): lo que avisa el taller en una factura («pastillas delanteras
// para cambiar») o lo que se apunta a mano («hace ruido al frenar»). Salen en la web, en el reporte de Telegram y el
// bot las consulta y las resuelve. Lo usan la web, las funciones de Vercel y los scripts: sin nada del navegador.
import type { Incidencia } from './types.js';

type ConIncidencias = { incidencias?: Incidencia[] };

export const nuevaIncidencia = (texto: string, fecha: string, origen: string, repId?: string): Incidencia => ({
  id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  texto: texto.trim().slice(0, 300), fecha, origen: origen.slice(0, 120), ...(repId ? { repId } : {}),
});

export const incidenciasDe = (v: ConIncidencias): Incidencia[] => (Array.isArray(v.incidencias) ? v.incidencias : []);

// Añade sin repetir (misma reparación o mismo texto ya pendiente).
export const conIncidencia = (v: ConIncidencias, i: Incidencia): Incidencia[] => {
  const hay = incidenciasDe(v);
  const igual = (x: Incidencia) => (i.repId && x.repId === i.repId) || x.texto.toLowerCase() === i.texto.toLowerCase();
  return hay.some(igual) ? hay : [...hay, i];
};

export const sinIncidencia = (v: ConIncidencias, id: string): Incidencia[] => incidenciasDe(v).filter((x) => x.id !== id);

export const textoIncidencia = (i: Incidencia) => `${i.texto} (${i.fecha}${i.origen ? ' · ' + i.origen : ''})`;
