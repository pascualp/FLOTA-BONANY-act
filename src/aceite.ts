// Kilómetros y cambio de aceite y filtros (27/11/2026, Facu: «hay que ir poniendo los kilómetros para llevar un
// control» y «que salga una alerta para llevar el control de cambio de aceite y filtro»).
// Lo usan la web, las funciones de Vercel (correo de las 8:00 y Telegram) y las pruebas: sin nada del navegador.
//
// Cuándo toca: lo que llegue antes de las dos cosas, los km desde el último cambio (si se sabe en qué km se hizo) o los
// meses desde el último cambio. Si solo se sabe la fecha (lo que sale de las facturas de Winclass), cuenta por meses.
import { addMonths, differenceInCalendarDays } from 'date-fns';
import { fechaEnPantalla, parseEsDate } from './utils.js';
import type { Vehicle } from './types.js';

// Cada cuánto, si en la ficha no pone otra cosa. PROVISIONAL (27/11/2026): falta que Facu diga lo que marca el taller.
export const ACEITE_CADA_KM = 30000;
export const ACEITE_CADA_MESES = 12;
// Cuánto antes avisa («Pronto»).
export const AVISO_KM = 2000;
export const AVISO_DIAS = 30;

type ConKm = Pick<Vehicle, 'km' | 'kmFecha' | 'kmFuente' | 'aceiteFecha' | 'aceiteKm' | 'aceiteFuente' | 'aceiteCadaKm' | 'aceiteCadaMeses'>;

// 242514 → «242.514 km» (igual en el navegador y en Node: sin depender de cómo agrupa cada uno los miles).
export const textoKm = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`;

// Lo que se teclea («242.514», «242514 km», «242 514») → 242514. null si no es un km creíble.
export const leerKm = (s: unknown): number | null => {
  if (typeof s === 'number') return Number.isFinite(s) && s > 0 && s < 3_000_000 ? Math.round(s) : null;
  const solo = String(s ?? '').replace(/[^\d]/g, '');
  if (!solo) return null;
  const n = Number(solo);
  return n > 0 && n < 3_000_000 ? n : null;
};

const esNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export type EstadoAceite = {
  status: 'danger' | 'warning' | 'success' | 'unknown';
  frase: string;    // «Toca cambiarlo: lleva 31.200 km desde el último (se cambia cada 30.000 km)»
  corto: string;    // para la casilla de la tarjeta: «Toca ya», «Faltan 1.500 km», «Hasta el 06/11/2027»…
};

const meses = (n: number) => `${n} ${n === 1 ? 'mes' : 'meses'}`;
const dma = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export function estadoAceite(v: ConKm, hoy = new Date()): EstadoAceite {
  const cadaKm = esNumero(v.aceiteCadaKm) ? v.aceiteCadaKm : ACEITE_CADA_KM;
  const cadaMeses = esNumero(v.aceiteCadaMeses) ? v.aceiteCadaMeses : ACEITE_CADA_MESES;
  const ultima = parseEsDate(v.aceiteFecha);
  const kmUlt = esNumero(v.aceiteKm) ? v.aceiteKm : null;
  const km = esNumero(v.km) ? v.km : null;

  if (!ultima && kmUlt === null) {
    return { status: 'unknown', frase: 'Falta apuntar el último cambio de aceite y filtros', corto: 'Falta el último cambio' };
  }
  if (kmUlt !== null && km !== null && km < kmUlt) {
    return {
      status: 'unknown', corto: 'Revisar los km',
      frase: `Revisa los km: la última lectura (${textoKm(km)}) es menor que la del último cambio (${textoKm(kmUlt)})`,
    };
  }

  // Por km (solo si se sabe en qué km se hizo el último cambio y hay una lectura de ahora).
  const hechos = kmUlt !== null && km !== null ? km - kmUlt : null;
  const faltanKm = hechos !== null ? cadaKm - hechos : null;
  // Por tiempo.
  const proxima = ultima ? addMonths(ultima, cadaMeses) : null;
  const faltanDias = proxima ? differenceInCalendarDays(proxima, hoy) : null;
  const cuandoUlt = ultima ? `el último fue el ${fechaEnPantalla(v.aceiteFecha)}` : `el último fue a los ${textoKm(kmUlt!)}`;
  const regla = `se cambia cada ${textoKm(cadaKm)} o ${meses(cadaMeses)}`;

  if (faltanKm !== null && faltanKm <= 0) {
    return { status: 'danger', corto: 'Toca ya', frase: `Toca cambiarlo: lleva ${textoKm(hechos!)} desde el último (${regla})` };
  }
  if (faltanDias !== null && faltanDias < 0) {
    const hace = Math.max(1, Math.round(-differenceInCalendarDays(ultima!, hoy) / 30.44));
    return { status: 'danger', corto: 'Toca ya', frase: `Toca cambiarlo: ${cuandoUlt}, hace ${meses(hace)} (${regla})` };
  }

  if (faltanKm === null && !proxima) {
    return { status: 'unknown', corto: 'Faltan los km', frase: `Falta apuntar los km de ahora para saber cuándo toca (${cuandoUlt})` };
  }
  const partes = [
    faltanKm !== null ? `dentro de ${textoKm(faltanKm)}` : '',
    proxima ? `como tarde el ${dma(proxima)}` : '',
  ].filter(Boolean);
  const sinKm = kmUlt === null ? ' (falta el km del último cambio: de momento cuenta por meses)' : km === null ? ' (falta apuntar los km de ahora)' : '';
  const pronto = (faltanKm !== null && faltanKm <= AVISO_KM) || (faltanDias !== null && faltanDias <= AVISO_DIAS);
  const corto = faltanKm !== null && (faltanDias === null || faltanKm <= AVISO_KM || faltanDias > AVISO_DIAS)
    ? `Faltan ${textoKm(faltanKm)}` : `Hasta el ${dma(proxima!)}`;
  return {
    status: pronto ? 'warning' : 'success',
    corto,
    frase: `${pronto ? 'Toca pronto' : 'Al día'}: próximo cambio ${partes.join(' o ')}; ${cuandoUlt}${sinKm}`,
  };
}

// «242.514 km (26/11/2026 · Informe ITV)» o null si no hay km apuntado.
export const textoLecturaKm = (v: ConKm) =>
  esNumero(v.km) ? `${textoKm(v.km)}${v.kmFecha || v.kmFuente ? ` (${[v.kmFecha && fechaEnPantalla(v.kmFecha), v.kmFuente].filter(Boolean).join(' · ')})` : ''}` : null;
