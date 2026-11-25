// Documentación de los vehículos: tipos de documento, qué papeles exige cada vehículo y qué le falta.
// Lo usan la web (VehicleList, VehicleModal) y el servidor (agente de Telegram), así que no depende de nada del navegador.
import type { Vehicle } from './types';

export const CATEGORIAS = [
  'Permiso de circulación',
  'Ficha técnica',
  'Póliza',
  'ITV',
  'ATP',
  'Tacógrafo',
  'Carga y descarga',
  'Tarjeta de transporte',
  'Factura de taller',   // 25/11/2026: las facturas de las reparaciones (ver src/reparaciones.ts)
  'Otro',
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const esCategoria = (s: unknown): s is Categoria => typeof s === 'string' && (CATEGORIAS as readonly string[]).includes(s);

// Lo mínimo de un documento que hace falta para saber de qué es (la ficha de `documents` en Firestore).
export interface DocResumen {
  id?: string;
  name?: string;
  categoria?: string;
}

// Kilos de «12.000 Kg», «3.500 Kg», «1940 Kg» → 12000, 3500, 1940. null si no se entiende.
export function kilos(capacidad: unknown): number | null {
  const cifras = String(capacidad ?? '').replace(/[^\d]/g, '');
  return cifras ? Number(cifras) : null;
}

const esCoche = (v: Vehicle) => /COCHE|TURISMO/i.test(String(v.tipo || ''));
const llevaFrio = (v: Vehicle) => /FRIGO|ISO/i.test(String(v.tipoCaja || ''));

// Qué papeles tiene que tener un vehículo (25/11/2026):
// - todos: permiso de circulación, ficha técnica, póliza e ITV;
// - ATP: caja FRIGO o ISO (isotermo), salvo coches;
// - tacógrafo: más de 3.500 kg.
export function documentosExigidos(v: Vehicle): Categoria[] {
  const lista: Categoria[] = ['Permiso de circulación', 'Ficha técnica', 'Póliza', 'ITV'];
  if (!esCoche(v) && llevaFrio(v)) lista.push('ATP');
  const kg = kilos(v.capacidad);
  if (!esCoche(v) && kg !== null && kg > 3500) lista.push('Tacógrafo');
  return lista;
}

// Para los documentos antiguos que no tienen `categoria`: se deduce del nombre del archivo.
// El orden importa: «TARJETA ITV» es la ficha técnica; «PERMISO … PITV» es el permiso.
const POR_NOMBRE: [RegExp, Categoria][] = [
  [/PERMISO/, 'Permiso de circulación'],
  [/FICHA|FITXA|FICHE|TARJETA (DE )?(INSPECCION|ITV)|TARJETA ITV/, 'Ficha técnica'],
  [/POLIZA|P[OÓ]LIZA|SEGURO|\bPOL\b/, 'Póliza'],
  [/TAC[OÓ]GRAF/, 'Tacógrafo'],
  [/\bATP\b|ATP_|_ATP/, 'ATP'],
  [/CARGA Y DESCARGA|CARREGA/, 'Carga y descarga'],
  [/TARJETA (DE )?TRANSPORTE|TARGETA TRANSPORT/, 'Tarjeta de transporte'],
  [/FACTURA|\bFRA\b|REPARACI|TALLER/, 'Factura de taller'],
  [/\bITV\b|ITV_|_ITV|INSPECCI/, 'ITV'],
];

export function categoriaDe(d: DocResumen): Categoria {
  if (esCategoria(d.categoria)) return d.categoria;
  const n = String(d.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  for (const [re, c] of POR_NOMBRE) if (re.test(n)) return c;
  return 'Otro';
}

export interface EstadoDocumentacion {
  exigidos: { categoria: Categoria; docs: DocResumen[] }[];
  faltan: Categoria[];
  completos: number;   // cuántos de los exigidos tiene
  total: number;       // cuántos se le exigen
}

export function estadoDocumentacion(v: Vehicle, docs: DocResumen[]): EstadoDocumentacion {
  const exigidos = documentosExigidos(v).map((categoria) => ({
    categoria,
    docs: docs.filter((d) => categoriaDe(d) === categoria),
  }));
  const faltan = exigidos.filter((e) => e.docs.length === 0).map((e) => e.categoria);
  return { exigidos, faltan, completos: exigidos.length - faltan.length, total: exigidos.length };
}

// La base de Firestore tiene tope gratis diario (Enterprise, freeTierLimited): al pasarlo todo da RESOURCE_EXHAUSTED
// hasta las 9:00 de España (medianoche del Pacífico). Mismo aviso en la web y en el agente.
export const AVISO_CUOTA =
  'La base de datos de la flota ha llegado a su límite diario gratuito. Vuelve a funcionar a las 9:00 (hora de España). ' +
  'Los datos no se pierden.';

export const esCuotaAgotada = (e: any) =>
  e?.code === 8 || e?.code === 'resource-exhausted' || /RESOURCE_EXHAUSTED|Quota (limit )?exceeded/i.test(String(e?.message || e));

// Tipos de archivo que se aceptan (web y Telegram) y tamaño máximo.
export const TIPOS_ARCHIVO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const MAX_BYTES = 25 * 1024 * 1024;
