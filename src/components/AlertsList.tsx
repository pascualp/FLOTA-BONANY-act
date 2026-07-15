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
          <h4 className="font-bold text-slate-800">Centro de Alertas</h4>
          <p className="text-sm text-slate-500">Gestiona los trámites vencidos o próximos a vencer de toda la flota.</p>
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
              {alerts.map((al, idx) => (
                <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-bold">{al.vehicle.matricula}</div>
                    <div className="text-xs text-slate-500">{al.vehicle.marca}</div>
                  </td>
                  <td className="px-4 py-4 font-medium text-slate-700">{al.type}</td>
                  <td className="px-4 py-4">{al.date}</td>
                  <td className="px-4 py-4">
                    <span className={`text-[10px] px-2 py-1 rounded font-bold ${
                      al.status.status === 'danger' ? 'bg-red-100 text-red-600' :
                      'bg-amber-100 text-amber-600'
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
                      className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      Renovar / Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
