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
