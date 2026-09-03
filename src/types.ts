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
}

export interface VehicleDocument {
  id: string;
  vehicleId: string;
  name: string;
  type: string;
  url: string;
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
}
