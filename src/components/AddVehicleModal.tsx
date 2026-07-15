import { X } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

interface AddVehicleModalProps {
  setShowAddModal: (show: boolean) => void;
}

export const AddVehicleModal = ({ setShowAddModal }: AddVehicleModalProps) => {
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">Nuevo Vehículo</h3>
          <button onClick={() => setShowAddModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          await addDoc(collection(db, 'vehicles'), {
            matricula: formData.get('matricula'),
            marca: formData.get('marca'),
            tipo: 'Añadido Manual',
            proximaITV: formData.get('itv'),
            createdAt: serverTimestamp()
          });
          setShowAddModal(false);
        }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Matrícula</label>
            <input name="matricula" required className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Marca / Modelo</label>
            <input name="marca" required className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Próxima ITV</label>
            <input name="itv" placeholder="DD/MM/YYYY" className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white font-bold rounded-lg p-3 hover:bg-blue-700 mt-4">Guardar Vehículo</button>
        </form>
      </div>
    </div>
  );
};
