import { CheckCircle2 } from 'lucide-react';
import { Vehicle, Alert } from '../types';

interface AlertsListProps {
  alerts: Alert[];
  setSelectedVehicle: (vehicle: Vehicle) => void;
  setIsEditing: (isEditing: boolean) => void;
}

export const AlertsList = ({ alerts, setSelectedVehicle, setIsEditing }: AlertsListProps) => {
  return (
    <div className="flex-1 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <div>
          <h4 className="font-bold text-slate-800">Estado de la Flota</h4>
          <p className="text-sm text-slate-500">Control total de trámites, mantenimientos y vencimientos.</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <CheckCircle2 className="w-12 h-12 mb-4 text-emerald-400 opacity-50" />
            <p>Todo en orden. No hay alertas pendientes.</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                <th className="px-4 py-3">Vehículo</th>
                <th className="px-4 py-3">Trámite</th>
                <th className="px-4 py-3">Fecha Límite</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {alerts.map((al, idx) => {
                const isVencido = al.status.status === 'danger';
                const isWarning = al.status.status === 'warning';
                
                return (
                  <tr 
                    key={idx} 
                    className={`border-b border-white transition-colors ${
                      isVencido ? 'bg-red-100' : 
                      isWarning ? 'bg-amber-100' : 
                      'bg-white'
                    }`}
                  >
                    <td className="px-4 py-4">
                      <div className="font-bold text-slate-900">{al.vehicle.matricula}</div>
                      <div className="text-[10px] text-slate-500 font-medium uppercase">{al.vehicle.marca} {al.vehicle.tipo}</div>
                    </td>
                    <td className="px-4 py-4 font-bold text-slate-700">{al.type}</td>
                    <td className="px-4 py-4 font-medium">{al.date}</td>
                    <td className="px-4 py-4">
                      <span className={`text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider ${
                        isVencido ? 'bg-red-600 text-white shadow-sm' :
                        isWarning ? 'bg-amber-500 text-white shadow-sm' :
                        'bg-emerald-500 text-white shadow-sm'
                      }`}>
                        {al.status.text}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <button 
                        onClick={() => {
                          setSelectedVehicle(al.vehicle);
                          setIsEditing(true);
                        }}
                        className="text-[11px] font-bold px-4 py-2 rounded-full transition-all shadow-sm bg-white text-blue-600 hover:bg-slate-50 border border-slate-100"
                      >
                        Renovar / Editar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
