import { UploadCloud } from 'lucide-react';
import { Vehicle, Alert } from '../types';

interface DashboardProps {
  alerts: Alert[];
  stats: {
    total: number;
    itvProxMes: number;
    criticas: number;
    operativo: number;
  };
  setActiveTab: (tab: string) => void;
  setSelectedVehicle: (vehicle: Vehicle) => void;
}

export const Dashboard = ({ alerts, stats, setActiveTab, setSelectedVehicle }: DashboardProps) => (
  <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
    {/* Alerts List (Left/Main) */}
    <div className="col-span-1 lg:col-span-2 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
        <h4 className="font-bold text-slate-800">Vencimientos Próximos</h4>
        <button 
          onClick={() => setActiveTab('alerts')} 
          className="text-xs text-blue-600 font-bold bg-blue-50 px-3 py-1 rounded-full hover:bg-blue-100 transition-colors"
        >
          Ver Todo
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              <th className="px-4 py-3">Vehículo</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Fecha Límite</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {alerts.slice(0, 8).map((al, idx) => (
              <tr 
                key={idx} 
                onClick={() => setSelectedVehicle(al.vehicle)}
                className="border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <td className="px-4 py-4">
                  <div className="font-bold">{al.vehicle.marca}</div>
                  <div className="text-xs text-slate-500">{al.vehicle.matricula}</div>
                </td>
                <td className="px-4 py-4 text-slate-600">{al.type}</td>
                <td className="px-4 py-4">{al.date}</td>
                <td className="px-4 py-4">
                  <span className={`text-[10px] px-2 py-1 rounded font-bold ${
                    al.status.status === 'danger' ? 'bg-red-100 text-red-600' :
                    al.status.status === 'warning' ? 'bg-amber-100 text-amber-600' :
                    'bg-emerald-100 text-emerald-600'
                  }`}>
                    {al.status.text}
                  </span>
                </td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center py-8 text-slate-500">No hay vencimientos próximos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* Side Panels */}
    <div className="space-y-6 flex flex-col shrink-0">
      {/* Rapid Upload Section */}
      <div className="bg-blue-600 rounded-3xl p-6 text-white shadow-lg">
        <h4 className="font-bold mb-4">Subida Rápida</h4>
        <label className="border-2 border-dashed border-blue-400 rounded-2xl p-4 flex flex-col items-center justify-center bg-blue-700/50 cursor-pointer hover:bg-blue-700/70 transition-colors">
          <UploadCloud className="w-8 h-8 mb-2 opacity-80" />
          <p className="text-xs font-medium text-center">
            Suelte documentos aquí
          </p>
          <input type="file" multiple className="hidden" onChange={(e) => {
            if (e.target.files?.length) alert(`Funcionalidad de subida lista para integrar con Storage. Se han seleccionado ${e.target.files.length} archivos.`);
          }} />
        </label>
      </div>

      {/* Real-time Maintenance Dashboard */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 flex-1 shadow-sm flex flex-col">
        <h4 className="font-bold text-slate-800 mb-4">Estado Flota</h4>
        <div className="relative h-32 flex items-center justify-center mb-4">
          <div className="w-24 h-24 rounded-full border-[12px] border-slate-100 relative">
            <div
              className="absolute inset-0 rounded-full border-[12px] border-blue-500"
              style={{ clipPath: 'polygon(50% 0%, 100% 0%, 100% 50%, 50% 50%)' }}
            ></div>
            <div className="absolute inset-0 flex items-center justify-center text-xl font-bold">
              {Math.round((stats.operativo / (stats.total || 1)) * 100)}%
            </div>
          </div>
        </div>
        <div className="mt-auto space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span> Operativo
            </span>
            <span className="font-bold">{stats.operativo}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> Con Alertas
            </span>
            <span className="font-bold">{stats.criticas}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);
