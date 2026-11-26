import { Timestamp } from 'firebase/firestore';

// Core entity types for the Fleet Management System
export interface Vehicle {
  id?: string;
  matricula: string;
  marca: string;
  tipo: string;
  tipoCaja: string;
  capacidad: string;
  fechaMatriculacion: string;
  bastidor: string;
  chofer: string;
  aseguradora: string;
  poliza: string;
  proximaITV: string;
  vencimientoATP: string;
  revisionTacografo: string;
  // Fin del periodo en vigor de la póliza (dd/mm/aaaa). Desde el 25/11/2026: un seguro caducado es lo más caro que se
  // puede pasar, y antes la app solo guardaba la compañía y el número.
  vencimientoSeguro?: string;
  priority?: 'low' | 'medium' | 'high';
  // Últimos cambios (los más nuevos primero, como mucho HISTORIAL_MAX): quién, cuándo y qué. Lo escriben la web y el bot.
  historial?: Cambio[];
  ultimaReparacion?: string;   // dd/mm/aaaa de la última reparación apuntada (las reparaciones van en su subcolección)
  // Incidencias PENDIENTES (26/11/2026, Facu: «las alertas [del taller] también tienen que salir en Telegram, como
  // incidencias»). Al resolverse se quitan de aquí (y queda en el historial). Van en la ficha del vehículo para que la
  // web, el reporte y el bot las vean sin leer nada más.
  incidencias?: Incidencia[];
  // En el camión va una COPIA de los papeles; los originales se quedan en la oficina (26/11/2026). Sin este campo, el
  // vehículo todavía no lleva la copia. Ver src/copiaCamion.ts.
  copiaCamion?: CopiaCamion;
  createdAt?: Timestamp;
  // Citas ya sacadas y pendientes de llevar el vehículo (las pone el agente de Telegram al pulsar ✅)
  citas?: Partial<Record<ClaveTramite, Cita>>;
  // Fuera de la flota (ya no lo tenemos; p. ej. no está en el GPS): sale aparte en «Vehículos → Fuera de la flota»,
  // y no cuenta ni en las alertas, ni en el reporte, ni en el agente. Se marca en vez de borrar para que se pueda
  // deshacer («Volver a la flota») y para que una pestaña con la web vieja (seedData) no lo vuelva a crear.
  baja?: boolean;
  bajaMotivo?: string;
  bajaFecha?: string;   // dd/MM/yyyy
}

// Trámites que se llevan a un sitio con cita (ITV, ATP, tacógrafo). El seguro vence pero no tiene cita.
export type ClaveTramite = 'itv' | 'atp' | 'tacografo';
export type ClaveVencimiento = ClaveTramite | 'seguro';

// Reparación o mantenimiento de un vehículo (25/11/2026, Facu: «un historial de las reparaciones y qué se le ha hecho;
// mandaremos fotos de las facturas y un histórico de Winclass»). Va en vehicles/<id>/reparaciones/<id>.
export interface Reparacion {
  id?: string;
  fecha: string;          // dd/mm/aaaa (la de la factura o la del trabajo)
  dia: string;            // aaaa-mm-dd: la misma fecha, para ordenar y filtrar por año
  que: string;            // qué se le hizo
  taller?: string;
  importe?: number;       // euros, lo que pone la factura (IVA incluido)
  km?: number;
  factura?: string;       // nº de factura
  notas?: string;         // lo que avise el taller, p. ej. «pastillas delanteras para cambiar»
  documentoId?: string;   // la foto o el PDF de la factura (colección documents, categoría «Factura de taller»)
  origen?: 'web' | 'telegram' | 'winclass' | 'escaneo';   // escaneo = facturas escaneadas en la oficina e importadas
  ref?: string;           // clave en el sistema de origen (Winclass): para no importar dos veces lo mismo
  creadoPor?: string;
  creado?: Timestamp;
}

export interface Incidencia {
  id: string;        // para resolverla
  texto: string;     // «Pastillas de freno delanteras para cambiar»
  fecha: string;     // dd/mm/aaaa: cuándo se detectó
  origen: string;    // «Neuretec (Euromaster), factura 7733» · «Telegram · Facu» · «Web · …»
  repId?: string;    // la reparación (factura) de la que sale, si sale de una
}

export interface CopiaCamion {
  fecha: string;   // dd/mm/aaaa: desde cuándo lleva la copia
  por: string;     // quién lo apuntó («Web · correo», «Telegram · nombre»)
}

export interface Cambio {
  cuando: string;  // ISO (new Date().toISOString()): dentro de una lista Firestore no admite serverTimestamp
  por: string;     // «Web · correo» o «Telegram · nombre»
  que: string;     // «Próxima ITV: 23/03/27 → 23/03/2028»
}

export interface Cita {
  fecha: string;   // dd/MM/yyyy
  hora?: string;   // HH:mm
  lugar?: string;
  notas?: string;
  por?: string;    // quién la apuntó
}

export interface VehicleDocument {
  id: string;
  vehicleId: string;
  name: string;
  type: string;
  url: string;
  size?: number;
  isChunked?: boolean;
  totalChunks?: number;
  uploadedAt: Timestamp;
  // Desde el 25/11/2026 el archivo está en Google Cloud Storage (bucket bonany-flota-documentos) y aquí solo su ruta.
  // Los viejos sin storagePath tienen el archivo troceado en /chunks (o en url) hasta que se migren.
  storagePath?: string;
  categoria?: string;   // ver CATEGORIAS en documentos.ts
  subidoPor?: string;
}

export interface AlertStatus {
  status: 'danger' | 'warning' | 'success' | 'unknown';
  text: string;
}

export interface Alert {
  vehicle: Vehicle;
  type: string;
  date: string;
  status: AlertStatus;
  clave?: ClaveVencimiento;
  cita?: Cita;
}
