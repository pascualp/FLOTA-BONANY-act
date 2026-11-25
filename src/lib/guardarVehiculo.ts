// Guardar cambios de un vehículo desde la web: SOLO los campos que cambian (antes el formulario reescribía los 12
// campos con lo que había al abrirlo, y deshacía lo que Jordi hubiera cambiado entretanto por Telegram) y con una nota en
// el historial del vehículo (quién, cuándo, qué), igual que hace el bot.
import { doc, updateDoc, type FieldValue } from 'firebase/firestore';
import { auth, db } from './firebase';
import { conCambio, nuevoCambio } from '../utils';
import type { Vehicle } from '../types';

export const quienWeb = () => `Web · ${auth.currentUser?.email || 'sin sesión'}`;

export async function guardarCambios(v: Vehicle, cambios: Record<string, unknown | FieldValue>, resumen: string) {
  if (!v.id) throw new Error('Este vehículo no tiene ficha en la base');
  if (!Object.keys(cambios).length) return;
  await updateDoc(doc(db, 'vehicles', v.id), { ...cambios, historial: conCambio(v.historial, nuevoCambio(quienWeb(), resumen)) });
}
