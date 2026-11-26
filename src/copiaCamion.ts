// Copia de los papeles en el camión (26/11/2026, Facu: «a todos se les está poniendo una copia en el camión, no los
// papeles originales; los originales nos quedamos nosotros»). En la ficha del vehículo se apunta desde cuándo lleva la
// copia y quién lo apuntó. Lo usan la web, el bot de Telegram y las pruebas: sin nada del navegador.
import type { CopiaCamion, Vehicle } from './types.js';

type ConCopia = Pick<Vehicle, 'copiaCamion'>;

export const copiaDe = (v: ConCopia): CopiaCamion | undefined =>
  v.copiaCamion && typeof v.copiaCamion.fecha === 'string' && v.copiaCamion.fecha ? v.copiaCamion : undefined;

export const textoCopia = (v: ConCopia) => {
  const c = copiaDe(v);
  return c ? `Lleva copia de los papeles en el camión desde el ${c.fecha} (los originales, en la oficina)`
    : 'Todavía no lleva copia de los papeles en el camión';
};

// Fecha en que se puso la copia: dd/mm/aaaa, un día que existe y que no es posterior a hoy. Devuelve el motivo si no vale.
export function fechaCopiaMal(fecha: string, hoy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim());
  if (!m) return 'Pon la fecha así: 26/11/2026';
  const [, d, mes, a] = m.map(Number);
  const f = new Date(a, mes - 1, d);
  if (f.getFullYear() !== a || f.getMonth() !== mes - 1 || f.getDate() !== d) return `El ${fecha.trim()} no existe`;
  const h = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(hoy);
  if (h && `${a}${m[2]}${m[1]}` > `${h[3]}${h[2]}${h[1]}`) return 'La fecha no puede ser posterior a hoy';
  return null;
}
