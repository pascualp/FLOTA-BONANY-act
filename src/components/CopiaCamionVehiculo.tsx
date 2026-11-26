import { useState } from 'react';
import { deleteField } from 'firebase/firestore';
import { CheckCircle2, Copy } from 'lucide-react';
import type { Vehicle } from '../types';
import { copiaDe, fechaCopiaMal } from '../copiaCamion';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';

// ¿Lleva ya el camión su COPIA de los papeles? (26/11/2026, Facu: en los vehículos va una copia; los originales se quedan
// en la oficina). Va en la ficha, debajo de la lista de papeles.
const hoy = () => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const avisar = (que: string, e: any) => alert(esCuotaAgotada(e) ? AVISO_CUOTA : `${que}: ${e?.message || e}`);

export const CopiaCamionVehiculo = ({ vehiculo: v }: { vehiculo: Vehicle }) => {
  const [guardando, setGuardando] = useState(false);
  const copia = copiaDe(v);

  const apuntar = async () => {
    const f = window.prompt(
      `¿Qué día se puso la copia de los papeles en el ${v.matricula}? (dd/mm/aaaa)\n\nLos originales se quedan en la oficina.`,
      copia?.fecha || hoy());
    if (f === null) return;
    const mal = fechaCopiaMal(f, hoy());
    if (mal) { alert(mal); return; }
    setGuardando(true);
    try {
      await guardarCambios(v, { copiaCamion: { fecha: f.trim(), por: quienWeb() } },
        copia ? `Copia nueva de los papeles en el camión: ${copia.fecha} → ${f.trim()}` : `Copia de los papeles puesta en el camión (${f.trim()})`);
    } catch (e) { avisar('No se pudo apuntar', e); } finally { setGuardando(false); }
  };

  const quitar = async () => {
    if (!window.confirm(`¿Quitar la marca de que el ${v.matricula} lleva copia de los papeles?`)) return;
    setGuardando(true);
    try { await guardarCambios(v, { copiaCamion: deleteField() }, 'Quitada la marca de copia de los papeles en el camión'); }
    catch (e) { avisar('No se pudo quitar', e); } finally { setGuardando(false); }
  };

  const botonPeq = 'text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 shrink-0';
  return copia ? (
    <div className="mb-4 p-3 rounded-2xl border border-emerald-200 bg-emerald-50 flex justify-between items-center gap-3 flex-wrap">
      <div className="flex items-start gap-2 min-w-[220px] flex-1">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-emerald-900">Lleva copia de los papeles en el camión</p>
          <p className="text-xs text-emerald-800/80">Desde el {copia.fecha}. Los originales están en la oficina.</p>
        </div>
      </div>
      <span className="flex gap-1">
        <button onClick={apuntar} disabled={guardando} title="Se ha puesto una copia nueva (p. ej. tras renovar la ITV)"
          className={`${botonPeq} bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100`}>Copia nueva</button>
        <button onClick={quitar} disabled={guardando} className={`${botonPeq} text-slate-500 hover:bg-white`}>Quitar</button>
      </span>
    </div>
  ) : (
    <div className="mb-4 p-3 rounded-2xl border border-slate-200 bg-slate-50 flex justify-between items-center gap-3 flex-wrap">
      <div className="flex items-start gap-2 min-w-[220px] flex-1">
        <Copy className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-700">Todavía no lleva copia de los papeles en el camión</p>
          <p className="text-xs text-slate-500">En el camión va una copia; los originales se quedan en la oficina.</p>
        </div>
      </div>
      <button onClick={apuntar} disabled={guardando}
        className={`${botonPeq} bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1`}>
        <Copy className="w-3.5 h-3.5" />{guardando ? 'Guardando…' : 'Ya lleva la copia'}
      </button>
    </div>
  );
};
