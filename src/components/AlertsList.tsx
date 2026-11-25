import React, { useState, useMemo } from 'react';
import { CheckCircle2, Search, Filter, Mail } from 'lucide-react';
import { Vehicle, Alert } from '../types';
import { parseEsDate, textoCita } from '../utils';

interface AlertsListProps {
  alerts: Alert[];
  setSelectedVehicle: (vehicle: Vehicle) => void;
  setIsEditing: (isEditing: boolean) => void;
}

export const AlertsList = ({ alerts, setSelectedVehicle, setIsEditing }: AlertsListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'danger' | 'warning' | 'unknown' | 'success'>('all');
  const [sortBy, setBy] = useState<'date' | 'matricula' | 'status'>('status');

  const groupedAlerts = useMemo(() => {
    const groups: Record<string, { vehicle: Vehicle; alerts: Alert[] }> = {};
    
    // First, filter based on search and status
    const initialFiltered = alerts.filter(al => {
      // String(): hay fichas con campos vacíos o que no son texto; sin esto la pestaña se quedaba en blanco.
      const t = searchTerm.toLowerCase();
      const matchesSearch = [al.vehicle.matricula, al.vehicle.marca, al.type].some(x => String(x ?? '').toLowerCase().includes(t));
      
      const matchesStatus = statusFilter === 'all' || al.status.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });

    // Group by vehicle ID
    initialFiltered.forEach(al => {
      const vId = al.vehicle.id || al.vehicle.matricula;
      if (!groups[vId]) {
        groups[vId] = { vehicle: al.vehicle, alerts: [] };
      }
      groups[vId].alerts.push(al);
    });

    // Convert back to array
    return Object.values(groups).sort((a, b) => {
      if (sortBy === 'status') {
        const priority = { danger: 0, warning: 1, unknown: 2, success: 3 };   // una fecha que no se entiende va antes que lo que está en regla
        const getWorstStatus = (als: Alert[]) => Math.min(...als.map(al => priority[al.status.status as keyof typeof priority] ?? 4));
        const pA = getWorstStatus(a.alerts);
        const pB = getWorstStatus(b.alerts);
        if (pA !== pB) return pA - pB;
      }

      if (sortBy === 'matricula') {
        return a.vehicle.matricula.localeCompare(b.vehicle.matricula, undefined, { numeric: true, sensitivity: 'base' });
      }

      const getEarliestDate = (als: Alert[]) => {
        const dates = als.map(al => parseEsDate(al.date)).filter(d => d !== null) as Date[];
        if (dates.length === 0) return 8640000000000000;
        return Math.min(...dates.map(d => d.getTime()));
      };
      return getEarliestDate(a.alerts) - getEarliestDate(b.alerts);
    });
  }, [alerts, searchTerm, statusFilter, sortBy]);

  return (
    <div className="flex-1 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h4 className="font-bold text-slate-800 text-lg">Estado de la Flota</h4>
            <p className="text-sm text-slate-500">Control total de trámites, mantenimientos y vencimientos.</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por matrícula, marca o trámite..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'danger', label: 'Vencidos' },
              { id: 'warning', label: 'Próximos' },
              { id: 'unknown', label: 'Fechas a revisar' },
              { id: 'success', label: 'Al día' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  statusFilter === f.id 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200' 
                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-2" />
            <select 
              className="bg-transparent text-xs font-bold text-slate-600 outline-none pr-2 py-1 cursor-pointer"
              value={sortBy}
              onChange={(e) => setBy(e.target.value as any)}
            >
              <option value="status">Prioridad: Estado</option>
              <option value="date">Orden: Fecha</option>
              <option value="matricula">Orden: Numérico (Matrícula)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {groupedAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
            <CheckCircle2 className="w-12 h-12 mb-4 text-emerald-400 opacity-50" />
            <p className="font-medium">No se encontraron resultados</p>
            <p className="text-xs opacity-70">Prueba ajustando los filtros o la búsqueda</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-widest border-b border-slate-100">
                <th className="px-6 py-3 w-10">#</th>
                <th className="px-4 py-3">Vehículo</th>
                <th className="px-4 py-3">Trámites Pendientes</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {groupedAlerts.map((group, idx) => {
                // Lo que ya tiene cita sacada no pinta la fila de rojo/ámbar: pasa a azul (pendiente de llevar).
                const hasDanger = group.alerts.some(a => a.status.status === 'danger' && !a.cita);
                const hasWarning = group.alerts.some(a => a.status.status === 'warning' && !a.cita);
                const hasRevisar = group.alerts.some(a => a.status.status === 'unknown' && !a.cita);
                const hasCita = group.alerts.some(a => a.cita);

                return (
                   <tr
                    key={group.vehicle.id}
                    className={`transition-colors group border-b border-white ${
                      hasDanger ? 'bg-red-100' :
                      hasWarning ? 'bg-amber-100' :
                      hasRevisar ? 'bg-slate-100' :
                      hasCita ? 'bg-blue-50' :
                      'bg-white'
                    }`}
                  >
                    <td className="px-6 py-5 text-[10px] font-bold text-slate-400">{idx + 1}</td>
                    <td className="px-4 py-5">
                      <div className="font-bold text-slate-900">{group.vehicle.matricula}</div>
                      <div className="text-[10px] text-slate-500 font-medium uppercase leading-tight">
                        {group.vehicle.marca} {group.vehicle.tipo}
                      </div>
                    </td>
                    <td className="px-4 py-5">
                      <div className="space-y-3">
                        {group.alerts.map((al, aIdx) => (
                          <div key={aIdx} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <div className="min-w-[140px]">
                              <span className="font-bold text-slate-700 block">{al.type}</span>
                              <span className="text-[10px] text-slate-500 font-medium">{al.date}</span>
                            </div>
                            <span className={`text-[9px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider ${
                              al.status.status === 'danger' ? 'bg-red-600 text-white shadow-sm' :
                              al.status.status === 'warning' ? 'bg-amber-500 text-white shadow-sm' :
                              // Una fecha que no se entiende NO es «en regla»: gris, para que alguien la corrija.
                              al.status.status === 'unknown' ? 'bg-slate-500 text-white shadow-sm' :
                              'bg-emerald-500 text-white shadow-sm'
                            }`}>
                              {al.status.text}
                            </span>
                            {al.cita && (
                              <span className="text-[9px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider bg-blue-600 text-white shadow-sm">
                                📅 {textoCita(al.cita)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <button 
                        onClick={() => {
                          setSelectedVehicle(group.vehicle);
                          setIsEditing(true);
                        }}
                        className="text-[11px] font-bold px-5 py-2.5 rounded-full transition-all shadow-sm bg-white text-blue-600 hover:shadow-md border border-slate-200 whitespace-nowrap"
                      >
                        Gestionar Vehículo
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
