// Planificador de revisiones (ITV, ATP, tacógrafo) de la flota. Reglas de Facu (25/11/2026):
// - como mucho UN vehículo al día (si a un vehículo le tocan dos trámites, van el mismo día);
// - de lunes a viernes, POR LA TARDE (después del reparto); ni fines de semana ni festivos de Mallorca;
// - primero lo vencido, después lo que vence antes; los días que ya tienen una cita apuntada no se usan.
// No depende del navegador: lo usan el agente de Telegram y (si hace falta) la web.
// «.js» aunque sea .ts: el agente corre en Vercel como módulo ES de Node y sin extensión no lo encuentra.
import { parseEsDate, TRAMITES } from './utils.js';
import type { ClaveTramite, Vehicle } from './types';

export interface Tarea {
  vehicleId: string;
  matricula: string;
  chofer: string;
  clave: ClaveTramite;
  tramite: string;      // «ITV Técnica», «Vencimiento ATP», «Revisión Tacógrafo»
  vence: string;        // como está en la ficha
  dias: number;         // días hasta que vence (negativo = vencido)
}

export interface DiaPlan {
  fecha: string;        // dd/mm/aaaa
  diaSemana: string;    // «lunes»
  vehicleId: string;
  matricula: string;
  chofer: string;
  tareas: Tarea[];
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dosCifras = (n: number) => String(n).padStart(2, '0');
export const fechaTexto = (d: Date) => `${dosCifras(d.getDate())}/${dosCifras(d.getMonth() + 1)}/${d.getFullYear()}`;
const clave = (d: Date) => `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;
const soloDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Festivos en Mallorca (nacionales + Illes Balears). Pascua: Jueves Santo (Baleares), Viernes Santo y Lunes de Pascua.
const FIJOS = ['01-01', '01-06', '03-01', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25', '12-26'];
const PASCUA: Record<number, string[]> = {
  2026: ['04-02', '04-03', '04-06'],
  2027: ['03-25', '03-26', '03-29'],
  2028: ['04-13', '04-14', '04-17'],
};
export function esFestivo(d: Date): boolean {
  const md = `${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;
  return FIJOS.includes(md) || (PASCUA[d.getFullYear()] || []).includes(md);
}
export const esLaborable = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5 && !esFestivo(d);

// Trámites con fecha que vencen dentro de `horizonte` días (o ya vencidos) y SIN cita apuntada, los más urgentes primero.
export function tareasPendientes(flota: Vehicle[], hoy: Date, horizonte = 45): Tarea[] {
  const base = soloDia(hoy).getTime();
  const tareas: Tarea[] = [];
  for (const v of flota) {
    if (v.baja || !v.id) continue;
    for (const t of TRAMITES) {
      if (v.citas?.[t.clave]) continue;
      const d = parseEsDate(v[t.campo]);
      if (!d) continue;
      const dias = Math.round((soloDia(d).getTime() - base) / 86400000);
      if (dias > horizonte) continue;
      tareas.push({ vehicleId: v.id, matricula: v.matricula, chofer: v.chofer || '', clave: t.clave, tramite: t.label, vence: v[t.campo], dias });
    }
  }
  return tareas.sort((a, b) => a.dias - b.dias || a.matricula.localeCompare(b.matricula));
}

// Días (dd/mm/aaaa) que ya tienen alguna cita apuntada en la flota: no se les añade otro vehículo.
export function diasOcupados(flota: Vehicle[]): Set<string> {
  const s = new Set<string>();
  for (const v of flota) {
    if (v.baja) continue;
    for (const c of Object.values(v.citas || {})) {
      const d = c?.fecha ? parseEsDate(c.fecha) : null;
      if (d) s.add(clave(d));
    }
  }
  return s;
}

// Reparte las tareas: un vehículo por día laborable por la tarde, desde MAÑANA, saltando los días ocupados.
export function planificar(tareas: Tarea[], ocupados: Set<string>, hoy: Date, maxDias = 60): DiaPlan[] {
  // Agrupa por vehículo (todas sus tareas el mismo día), en el orden de la más urgente de cada uno.
  const porVehiculo = new Map<string, Tarea[]>();
  for (const t of tareas) (porVehiculo.get(t.vehicleId) || porVehiculo.set(t.vehicleId, []).get(t.vehicleId)!).push(t);
  const plan: DiaPlan[] = [];
  const dia = soloDia(hoy);
  for (const lista of porVehiculo.values()) {
    let intentos = 0;
    do { dia.setDate(dia.getDate() + 1); intentos++; } while ((!esLaborable(dia) || ocupados.has(clave(dia))) && intentos < 30);
    if (plan.length >= maxDias) break;
    plan.push({
      fecha: fechaTexto(dia), diaSemana: DIAS[dia.getDay()],
      vehicleId: lista[0].vehicleId, matricula: lista[0].matricula, chofer: lista[0].chofer, tareas: lista,
    });
  }
  return plan;
}

// Texto del plan para Telegram (lo lee una persona: corto y claro).
export function textoPlan(plan: DiaPlan[]): string {
  if (plan.length === 0) return 'No hay revisiones que planificar en las próximas semanas.';
  return plan.map((p) => {
    const que = p.tareas.map((t) => `${t.tramite} (${t.dias < 0 ? `vencida desde el ${t.vence}` : `vence el ${t.vence}`})`).join(' + ');
    return `${p.diaSemana} ${p.fecha} por la tarde → ${p.matricula}${p.chofer ? ` (${p.chofer})` : ''}: ${que}`;
  }).join('\n');
}
