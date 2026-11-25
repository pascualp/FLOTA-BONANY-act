// Reparaciones de los vehículos: cuentas y textos que usan la web y el bot de Telegram (25/11/2026).
import type { Reparacion } from './types';
import { parseEsDate } from './utils.js';

// dd/mm/aaaa → aaaa-mm-dd (para ordenar y filtrar por año). '' si no se entiende.
export const diaDe = (fecha: string) => {
  const d = parseEsDate(fecha);
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
};

// «1.234,56 €», «1234.56», 1234.56 → 1234.56. null si no es un importe.
export const leerImporte = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v ?? '').replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');   // formato español: 1.234,56
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// Clave de una factura para no apuntarla dos veces, venga por Telegram, por la web o por el importador
// (scripts/importar-reparaciones.cjs repite esta misma regla). El nombre del taller no entra: se escribe de mil formas.
export const refReparacion = (matricula: string, fecha: string, factura: string) =>
  [matricula, fecha, factura].map((x) => String(x || '').toUpperCase().replace(/[^A-Z0-9/]/g, '')).join('|');

export const euros = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

// Las más nuevas primero.
export const ordenar = (rs: Reparacion[]) => [...rs].sort((a, b) => (b.dia || '').localeCompare(a.dia || ''));

// Gasto por año: { 2026: { total, n }, 2025: … }
export function gastoPorAnio(rs: Reparacion[]) {
  const r: Record<string, { total: number; n: number }> = {};
  for (const x of rs) {
    const anio = (x.dia || '').slice(0, 4) || 'sin fecha';
    r[anio] ||= { total: 0, n: 0 };
    r[anio].total += x.importe || 0;
    r[anio].n++;
  }
  return r;
}

export const textoReparacion = (x: Reparacion) =>
  `${x.fecha}${x.taller ? ' · ' + x.taller : ''} · ${x.que}${x.importe != null ? ' · ' + euros(x.importe) : ''}${x.km ? ` · ${x.km.toLocaleString('es-ES')} km` : ''}${x.factura ? ' · factura ' + x.factura : ''}`;
