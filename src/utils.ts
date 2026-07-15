import { parse, isValid, isBefore, addDays } from 'date-fns';
import { Vehicle, AlertStatus } from './types';

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

export const getAlertStatus = (dateStr: string): AlertStatus => {
  const d = parseEsDate(dateStr);
  if (!d) return { status: 'unknown', text: 'Desconocido' };
  const now = new Date();
  if (isBefore(d, now)) return { status: 'danger', text: 'VENCIDO' };
  if (isBefore(d, addDays(now, 30))) return { status: 'warning', text: 'Vence < 30 días' };
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
  const alerts: { label: string; status: 'danger' | 'warning' | 'success' | 'unknown'; text: string; date: string }[] = [];
  
  const fields = [
    { label: 'ITV Técnica', value: v.proximaITV },
    { label: 'Vencimiento ATP', value: v.vencimientoATP },
    { label: 'Revisión Tacógrafo', value: v.revisionTacografo }
  ];

  fields.forEach(f => {
    if (f.value) {
      const st = getAlertStatus(f.value);
      if (st.status === 'warning' || st.status === 'danger') {
        alerts.push({ label: f.label, ...st, date: f.value });
      }
    }
  });

  return alerts;
};

export const getAllAlerts = (vehicles: Vehicle[]) => {
  const alerts: any[] = [];
  vehicles.forEach(v => {
    const vAlerts = getVehicleAlerts(v);
    vAlerts.forEach(a => {
      alerts.push({ vehicle: v, type: a.label, date: a.date, status: { status: a.status, text: a.text } });
    });
  });
  return alerts.sort((a, b) => {
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
       const st = getAlertStatus(d);
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
