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
  priority?: 'low' | 'medium' | 'high';
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

export type ClaveTramite = 'itv' | 'atp' | 'tacografo';

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
  clave?: ClaveTramite;
  cita?: Cita;
}
