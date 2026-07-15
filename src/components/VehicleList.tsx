import { Car, FileSearch } from 'lucide-react';
import { Vehicle, Alert } from '../types';

interface VehicleListProps {
  vehicles: Vehicle[];
  allAlerts: Alert[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setSelectedVehicle: (vehicle: Vehicle) => void;
}

export const VehicleList = ({ vehicles, allAlerts, searchQuery, setSearchQuery, setSelectedVehicle }: VehicleListProps) => {
  const filteredVehicles = vehicles.filter(v => {
    if (!searchQuery) return true;
    const term = searchQuery.toLowerCase();
    return (
      v.matricula?.toLowerCase().includes(term) ||
      v.marca?.toLowerCase().includes(term) ||
      v.bastidor?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="flex-1 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center flex-wrap gap-4">
        <h4 className="font-bold text-slate-800">Todos los Vehículos</h4>
        <div className="relative w-full max-w-sm">
          <input 
            type="text" 
            placeholder="Buscar por matrícula, marca, bastidor..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border border-slate-200 rounded-full pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <FileSearch className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {filteredVehicles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Car className="w-12 h-12 mb-4 opacity-50" />
            <p>No se encontraron vehículos que coincidan con la búsqueda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVehicles.map(v => {
              const vAlerts = allAlerts.filter(a => a.vehicle.id === v.id);
              return (
                <div 
                  key={v.id} 
                  onClick={() => setSelectedVehicle(v)}
                  className="border border-slate-100 p-4 rounded-2xl hover:shadow-md hover:border-blue-200 transition-all cursor-pointer bg-white relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h5 className="font-bold text-slate-900 flex items-center gap-2">
                        {v.matricula}
                        {vAlerts.length > 0 && (
                          <span className="bg-red-100 text-red-600 text-[10px] px-2 py-0.5 rounded-full">
                            {vAlerts.length} {vAlerts.length === 1 ? 'alerta' : 'alertas'}
                          </span>
                        )}
                      </h5>
                      <p className="text-xs text-slate-500">{v.marca} - {v.tipo}</p>
                    </div>
                    <Car className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="space-y-1 mt-4 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Próxima ITV:</span> <span className="font-medium">{v.proximaITV || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Vencimiento ATP:</span> <span className="font-medium">{v.vencimientoATP || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Seguro:</span> <span className="font-medium">{v.aseguradora || 'N/A'}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
