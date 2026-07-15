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
            tipo: formData.get('tipo') || 'S/D',
            bastidor: formData.get('bastidor') || '',
            proximaITV: formData.get('itv'),
            vencimientoATP: formData.get('atp') || '',
            revisionTacografo: formData.get('tacografo') || '',
            chofer: formData.get('chofer') || '',
            createdAt: serverTimestamp()
          });
          setShowAddModal(false);
        }} className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Matrícula</label>
              <input name="matricula" required className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Marca / Modelo</label>
              <input name="marca" required className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de Vehículo</label>
              <input name="tipo" placeholder="Trailer, Rígido..." className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nº Bastidor</label>
              <input name="bastidor" className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="p-4 bg-slate-50 rounded-2xl space-y-4 border border-slate-100">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vencimientos Iniciales</h4>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Próxima ITV</label>
                <input name="itv" placeholder="DD/MM/YYYY" className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vencimiento ATP</label>
                <input name="atp" placeholder="DD/MM/YYYY" className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Revisión Tacógrafo</label>
                <input name="tacografo" placeholder="DD/MM/YYYY" className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chofer Habitual</label>
            <input name="chofer" className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white font-bold rounded-xl p-3 hover:bg-blue-700 mt-4 shadow-lg shadow-blue-100 transition-all hover:scale-[1.02] active:scale-[0.98]">
            Guardar Vehículo
          </button>
        </form>
      </div>
    </div>
  );
};
