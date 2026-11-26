// Imagen de cada vehículo (26/11/2026, Facu: «me gustaría tener una pequeña imagen del modelo del camión»; eligió «las
// dos»): una foto de MUESTRA del modelo, que sale sola, y la foto REAL del camión cuando alguien la haga desde la ficha.
//
// Las fotos de muestra están en public/modelos/ y son de Wikimedia Commons con licencia libre. Las CC BY-SA obligan a
// citar al autor y la licencia, y por eso se ven debajo de la foto en la ficha.
//
// El modelo NO se apunta a mano: se saca de la marca, el bastidor, el peso y el tipo que ya tiene la ficha. Así sale
// también en los que solo pone «IVECO» y en los que se den de alta mañana. Comprobado con los 24 de la flota el 26/11:
//   - Iveco de 10 t o más, o bastidor ZCFA…  → Eurocargo (1415LVM, 5389JGM, 8855JCY)
//   - Iveco «FURGONETA»                     → Daily furgón
//   - el resto de Iveco                      → Daily con caja frigo (2218KKT, 5331KLB, 5254JWZ, 5849HDH, 9785MSD)
//   - «RENAULT» sin más                      → Master (7695LXK: «RENAULT MASTER» en su informe de ITV)
import type { Vehicle } from './types';

export interface Modelo {
  clave: string;
  nombre: string;     // lo que se lee debajo de la foto: «Iveco Daily con caja»
  img: string;        // /modelos/<clave>.jpg
  autor: string;
  licencia: string;
  pagina: string;     // la ficha de la foto en Wikimedia Commons (autor, licencia y original)
}

const M = (clave: string, nombre: string, autor: string, licencia: string, archivo: string): Modelo =>
  ({ clave, nombre, img: `/modelos/${clave}.jpg`, autor, licencia, pagina: `https://commons.wikimedia.org/wiki/File:${archivo}` });

export const MODELOS = {
  dailyFurgon: M('daily-furgon', 'Iveco Daily furgón', 'KGC626', 'CC BY-SA 4.0', 'Iveco_Daily_Mk6.jpg'),
  dailyCaja: M('daily-caja', 'Iveco Daily con caja', 'Bene Riobó', 'CC BY-SA 4.0', 'Iveco_Daily_Knold%27s_Seafood.jpg'),
  eurocargo: M('eurocargo', 'Iveco Eurocargo', 'Lukas 3z', 'CC BY-SA 4.0', 'Iveco_Eurocargo_180E28_izotermiczny.jpg'),
  isuzu: M('isuzu-n', 'Isuzu serie N', 'Spielvogel', 'CC0', 'Isuzu_N-Series._Refrigerated_box_rigid_truck._Spielvogel_2013.jpg'),
  maxity: M('maxity', 'Renault Maxity', 'Spielvogel', 'CC0', 'Renault_Maxity_140.35._Free_image_Spielvogel.jpg'),
  master: M('master', 'Renault Master', 'spazgenev', 'CC0', 'Renault_Master,_Germany,_3_May_2017.jpg'),
  partner: M('partner', 'Peugeot Partner', 'Vauxford', 'CC BY-SA 4.0', '2016_Peugeot_Partner_850_S_L1_HDi_1.6_Front.jpg'),
  berlingo: M('berlingo', 'Citroën Berlingo', 'Cutlass', 'CC0', '2015_Citro%C3%ABn_Berlingo_in_Polar_White,_front_left,_06-05-2025.jpg'),
  polo: M('polo', 'Volkswagen Polo', 'Vauxford', 'CC BY-SA 4.0', '2018_Volkswagen_Polo_SE_1.0_Front.jpg'),
} satisfies Record<string, Modelo>;

// «12.000 Kg» → 12000; «3.500 Kg» → 3500; «1940 Kg» → 1940. Sin número → 0.
export const kilos = (capacidad: unknown): number => Number(String(capacidad ?? '').replace(/[^\d]/g, '')) || 0;

// El modelo de muestra de un vehículo, o null si no se sabe (entonces sale el dibujo de siempre).
export function modeloDe(v: Pick<Vehicle, 'marca' | 'bastidor' | 'tipo' | 'capacidad'>): Modelo | null {
  const marca = String(v.marca ?? '').toUpperCase();
  const vin = String(v.bastidor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tipo = String(v.tipo ?? '').toUpperCase();
  const es = (re: RegExp) => re.test(marca);

  if (es(/\bPOLO\b|VOLKSWAGEN|\bVW\b/) || vin.startsWith('WVW')) return MODELOS.polo;
  if (es(/PARTNER|PEUGEOT/) || vin.startsWith('VF3')) return MODELOS.partner;
  if (es(/BERLINGO|CITRO/) || vin.startsWith('VF7')) return MODELOS.berlingo;
  if (es(/MAXITY/) || vin.startsWith('VF6SX')) return MODELOS.maxity;
  if (es(/MASTER|RENAULT/) || vin.startsWith('VF6')) return MODELOS.master;
  if (es(/ISUZU/) || vin.startsWith('JAA')) return MODELOS.isuzu;
  if (es(/IVECO|DAILY|EUROCARGO/) || vin.startsWith('ZCF')) {
    if (es(/EUROCARGO/) || vin.startsWith('ZCFA') || kilos(v.capacidad) >= 10000) return MODELOS.eurocargo;
    return tipo.includes('FURGONETA') ? MODELOS.dailyFurgon : MODELOS.dailyCaja;
  }
  return null;
}
