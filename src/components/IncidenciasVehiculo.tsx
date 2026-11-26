import { useState } from 'react';
import { CheckCircle2, Plus, Wrench } from 'lucide-react';
import type { Vehicle } from '../types';
import { conIncidencia, incidenciasDe, nuevaIncidencia, sinIncidencia } from '../incidencias';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';

// Incidencias PENDIENTES del vehículo (26/11/2026): lo que avisa el taller («pastillas delanteras para cambiar») o una
// avería apuntada a mano. Salen también en el reporte de Telegram de cada mañana y el bot las consulta y resuelve.
const hoy = () => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const avisar = (que: string, e: any) => alert(esCuotaAgotada(e) ? AVISO_CUOTA : `${que}: ${e?.message || e}`);

export const IncidenciasVehiculo = ({ vehiculo }: { vehiculo: Vehicle }) => {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const lista = incidenciasDe(vehiculo);

  const apuntar = async () => {
    if (!texto.trim()) return;
    setGuardando(true);
    try {
      await guardarCambios(vehiculo, { incidencias: conIncidencia(vehiculo, nuevaIncidencia(texto, hoy(), quienWeb())) }, `Incidencia: ${texto.trim()}`);
      setTexto(''); setAbierto(false);
    } catch (e) { avisar('No se pudo apuntar', e); } finally { setGuardando(false); }
  };

  const resolver = async (id: string, t: string) => {
    if (!window.confirm(`¿Dar por resuelta «${t}»?`)) return;
    try { await guardarCambios(vehiculo, { incidencias: sinIncidencia(vehiculo, id) }, `Incidencia resuelta: ${t}`); }
    catch (e) { avisar('No se pudo marcar como resuelta', e); }
  };

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <div>
          <h4 className="font-bold text-slate-800 flex items-center gap-2"><Wrench className="w-4 h-4" />Incidencias pendientes</h4>
          <p className="text-xs text-slate-400">Averías o avisos del taller por arreglar. Salen cada mañana en Telegram hasta que se marcan como resueltas.</p>
        </div>
        {!abierto && (
          <button onClick={() => setAbierto(true)} className="text-xs font-bold px-3 py-2 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" />Apuntar incidencia
          </button>
        )}
      </div>
      {abierto && (
        <div className="mb-3 flex gap-2 flex-wrap">
          <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apuntar()}
            placeholder="Qué pasa (p. ej. ruido al frenar)" className="flex-1 min-w-[200px] border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-amber-400 outline-none" />
          <button onClick={apuntar} disabled={guardando || !texto.trim()} className="bg-amber-500 text-white px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-50">{guardando ? 'Guardando…' : 'Apuntar'}</button>
          <button onClick={() => { setAbierto(false); setTexto(''); }} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
        </div>
      )}
      {lista.length === 0 ? (
        <p className="text-sm text-slate-400">No tiene incidencias pendientes.</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((i) => (
            <li key={i.id} className="p-3 rounded-xl border border-amber-200 bg-amber-50 flex justify-between items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900">⚠ {i.texto}</p>
                <p className="text-xs text-amber-800/80">{i.fecha}{i.origen ? ` · ${i.origen}` : ''}</p>
              </div>
              <button onClick={() => resolver(i.id, i.texto)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />Resuelta
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
