import { parse, isValid, isBefore, addDays } from 'date-fns';
import { Vehicle, AlertStatus, ClaveTramite, Cita } from './types';

// Los tres trámites con fecha de la flota: clave corta, nombre en pantalla y campo del vehículo.
export const TRAMITES: { clave: ClaveTramite; label: string; campo: 'proximaITV' | 'vencimientoATP' | 'revisionTacografo' }[] = [
  { clave: 'itv', label: 'ITV Técnica', campo: 'proximaITV' },
  { clave: 'atp', label: 'Vencimiento ATP', campo: 'vencimientoATP' },
  { clave: 'tacografo', label: 'Revisión Tacógrafo', campo: 'revisionTacografo' },
];

// «Cita 02/12/2026 10:00 (Inca) – pendiente de llevar»
export const textoCita = (c: Cita) =>
  `Cita ${c.fecha}${c.hora ? ' ' + c.hora : ''}${c.lugar ? ' (' + c.lugar + ')' : ''} – pendiente de llevar`;

export const parseEsDate = (dateStr: any) => {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.toLowerCase().includes('no')) return null;
  let clean = dateStr.split('(')[0].trim();
  const divider = clean.includes('/') ? '/' : clean.includes('-') ? '-' : null;
  if (divider) {
    const parts = clean.split(divider);
    if (parts.length === 3) {
      let year = parts[2];
      if (year.length === 2) year = '20' + year;
      const parsed = parse(`${parts[0]}/${parts[1]}/${year}`, 'dd/MM/yyyy', new Date());
      return isValid(parsed) ? parsed : null;
    }
    if (parts.length === 2) {
       const parsed = parse(`01/${parts[0]}/${parts[1].length === 2 ? '20'+parts[1] : parts[1]}`, 'dd/MM/yyyy', new Date());
       return isValid(parsed) ? parsed : null;
    }
  }
  return null;
};

export const getAlertStatus = (dateStr: string, priority: 'low' | 'medium' | 'high' = 'medium'): AlertStatus => {
  const d = parseEsDate(dateStr);
  if (!d) return { status: 'unknown', text: 'Desconocido' };
  const now = new Date();
  if (isBefore(d, now)) return { status: 'danger', text: 'VENCIDO' };
  
  // Custom threshold based on priority
  let daysWarning = 30;
  if (priority === 'high') daysWarning = 60;
  if (priority === 'low') daysWarning = 15;

  if (isBefore(d, addDays(now, daysWarning))) return { status: 'warning', text: `Vence < ${daysWarning} días` };
  return { status: 'success', text: 'En Regla' };
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

export const getVehicleAlerts = (v: Vehicle) => {
  const alerts: { label: string; status: 'danger' | 'warning' | 'success' | 'unknown'; text: string; date: string; clave: ClaveTramite; cita?: Cita }[] = [];

  TRAMITES.forEach(t => {
    const value = v[t.campo];
    if (value) {
      const st = getAlertStatus(value, v.priority || 'medium');
      alerts.push({ label: t.label, ...st, date: value, clave: t.clave, cita: v.citas?.[t.clave] });
    }
  });

  return alerts;
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
    const priority = { danger: 0, warning: 1, success: 2, unknown: 3 };
    const pA = priority[a.status.status as keyof typeof priority] ?? 4;
    const pB = priority[b.status.status as keyof typeof priority] ?? 4;
    
    if (pA !== pB) return pA - pB;

    const da = parseEsDate(a.date);
    const db = parseEsDate(b.date);
    if (!da) return 1; if (!db) return -1;
    return da.getTime() - db.getTime();
  });
};

export const calculateStats = (vehicles: Vehicle[]) => {
  let vehiculosCriticos = 0;
  let vehiculosWarning = 0;

  vehicles.forEach(v => {
    let hasCritical = false;
    let hasWarning = false;
    const check = (d: string) => {
       const st = getAlertStatus(d, v.priority || 'medium');
       if (st.status === 'danger') hasCritical = true;
       if (st.status === 'warning') hasWarning = true;
    };
    if (v.proximaITV) check(v.proximaITV);
    if (v.vencimientoATP) check(v.vencimientoATP);
    if (v.revisionTacografo) check(v.revisionTacografo);

    if (hasCritical) vehiculosCriticos++;
    else if (hasWarning) vehiculosWarning++;
  });

  return { 
    total: vehicles.length, 
    itvProxMes: vehiculosWarning, 
    criticas: vehiculosCriticos, 
    operativo: vehicles.length - vehiculosCriticos - vehiculosWarning 
  };
};
