import { useState } from 'react';
import { Car, FileSearch, ArchiveX, CheckCircle2, FileWarning } from 'lucide-react';
import { Vehicle, Alert, VehicleDocument } from '../types';
import { estadoDocumentacion } from '../documentos';

interface VehicleListProps {
  vehicles: Vehicle[];                                // la flota que SÍ tenemos
  fuera: Vehicle[];                                   // fuera de la flota (campo «baja»: no está en el GPS, vendido…)
  allAlerts: Alert[];
  docsPorVehiculo: Record<string, VehicleDocument[]>; // id del vehículo → sus documentos
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setSelectedVehicle: (vehicle: Vehicle) => void;
}

// String(): en la base hay fichas con campos vacíos o que no son texto; así el buscador no se rompe con ninguna.
const coincide = (v: Vehicle, term: string) =>
  !term ||
  [v.matricula, v.marca, v.bastidor, v.chofer].some(x => String(x ?? '').toLowerCase().includes(term));

export const VehicleList = ({ vehicles, fuera, allAlerts, docsPorVehiculo, searchQuery, setSearchQuery, setSelectedVehicle }: VehicleListProps) => {
  const [soloIncompletos, setSoloIncompletos] = useState(false);
  const term = searchQuery.trim().toLowerCase();
  const estado = (v: Vehicle) => estadoDocumentacion(v, docsPorVehiculo[v.id || ''] || []);
  const incompletos = vehicles.filter(v => estado(v).faltan.length > 0).length;
  const activos = vehicles.filter(v => coincide(v, term) && (!soloIncompletos || estado(v).faltan.length > 0));
  const deFuera = fuera.filter(v => coincide(v, term));

  return (
    <div className="flex-1 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h4 className="font-bold text-slate-800">En la flota ({vehicles.length})</h4>
          <p className="text-xs text-slate-500">
            {incompletos === 0 ? 'Todos tienen la documentación completa.' : `${incompletos} con documentación incompleta.`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setSoloIncompletos(!soloIncompletos)}
            className={`px-4 py-2 rounded-full text-xs font-bold border transition-colors ${soloIncompletos ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
          >
            {soloIncompletos ? 'Viendo solo incompletos' : 'Ver solo incompletos'}
          </button>
          <div className="relative w-full max-w-sm">
            <input
              type="text"
              placeholder="Buscar por matrícula, marca, chófer, bastidor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-slate-200 rounded-full pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <FileSearch className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        {activos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Car className="w-12 h-12 mb-4 opacity-50" />
            <p>No se encontraron vehículos que coincidan con la búsqueda.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activos.map(v => {
              const vAlerts = allAlerts.filter(a => a.vehicle.id === v.id);
              const e = estado(v);
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
                      <p className="text-xs text-slate-500">{v.marca} - {v.tipo}{v.chofer ? ` · ${v.chofer}` : ''}</p>
                    </div>
                    <Car className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="space-y-1 mt-4 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Próxima ITV:</span> <span className="font-medium">{v.proximaITV || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Vencimiento ATP:</span> <span className="font-medium">{v.vencimientoATP || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Seguro:</span> <span className="font-medium">{v.aseguradora || 'N/A'}</span></div>
                    <div className="pt-2 mt-1 border-t border-slate-50">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Documentación:</span>
                        {e.faltan.length === 0 ? (
                          <span className="flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle2 className="w-3.5 h-3.5" /> Completa</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 font-bold"><FileWarning className="w-3.5 h-3.5" /> {e.completos}/{e.total}</span>
                        )}
                      </div>
                      {e.faltan.length > 0 && <p className="text-[11px] text-red-500 mt-1">Falta: {e.faltan.join(', ')}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* La flota que ya no tenemos (no está en el GPS, vendida, devuelta…): aparte y sin alertas. */}
        {fuera.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ArchiveX className="w-5 h-5 text-slate-400" />
              <h4 className="font-bold text-slate-600">Fuera de la flota ({fuera.length})</h4>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              No están en el GPS o ya no los tenemos. No salen en las alertas, ni en el correo, ni en Telegram.
              Ábrelos para devolverlos a la flota.
            </p>
            {deFuera.length === 0 ? (
              <p className="text-sm text-slate-400">Ninguno coincide con la búsqueda.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {deFuera.map(v => (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVehicle(v)}
                    className="border border-dashed border-slate-200 p-4 rounded-2xl hover:border-slate-400 transition-all cursor-pointer bg-slate-50 text-slate-500"
                  >
                    <h5 className="font-bold text-slate-600 line-through decoration-slate-300">{v.matricula}</h5>
                    <p className="text-xs">{v.marca} - {v.tipo}</p>
                    <p className="text-xs mt-3 italic">
                      {v.bajaMotivo || 'Fuera de la flota'}{v.bajaFecha ? ` · desde ${v.bajaFecha}` : ''}
                    </p>
                    <p className="text-xs mt-1">{(docsPorVehiculo[v.id || ''] || []).length} documentos guardados</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
