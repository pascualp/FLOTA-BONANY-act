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

// ¿Alguna reparación POSTERIOR ya arregla esto? (26/11/2026, Facu: «mira bien las facturas: si algo se arregló, no me
// lo pongas como incidencia»). Se compara por palabras clave (las 5 primeras letras de las palabras largas: «pastillas»,
// «frenos» → «pasti», «freno»). No es perfecto: sirve para no crear la incidencia y para preguntar en la web.
// La misma regla está copiada en scripts/importar-reparaciones.cjs y scripts/incidencias-desde-reparaciones.cjs.
const NO_CUENTAN = new Set(['delan', 'trase', 'cambi', 'nuevo', 'nueva', 'revis', 'izqui', 'derec', 'compr', 'hacer', 'falta', 'queda', 'antes', 'despu']);
export const clavesDe = (t: string) => new Set(
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/)
    .filter((w) => w.length >= 5).map((w) => w.slice(0, 5)).filter((w) => !NO_CUENTAN.has(w)),
);
const aDia = (f: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
export function arregladaPor<R extends { fecha: string; que: string }>(texto: string, fecha: string, reparaciones: R[]): R | undefined {
  const claves = clavesDe(texto);
  if (!claves.size) return undefined;
  return reparaciones
    .filter((r) => aDia(r.fecha) > aDia(fecha))
    .sort((a, b) => aDia(a.fecha).localeCompare(aDia(b.fecha)))
    .find((r) => [...clavesDe(r.que)].some((c) => claves.has(c)));
}

// Al revés: qué incidencias PENDIENTES parece arreglar una reparación que se apunta ahora (las de ese día o de antes,
// sin contar el aviso de la propia reparación). Nunca se resuelven a ciegas: la web pregunta y el bot lo enseña en la
// propuesta antes del ✅.
export const queArregla = (rep: { fecha: string; que: string; id?: string }, incidencias: Incidencia[]): Incidencia[] => {
  const claves = clavesDe(rep.que);
  return incidencias.filter((i) => (!rep.id || i.repId !== rep.id) && aDia(i.fecha) <= aDia(rep.fecha)
    && [...clavesDe(i.texto)].some((c) => claves.has(c)));
};
