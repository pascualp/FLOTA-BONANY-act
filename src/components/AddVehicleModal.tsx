import { useState, type FormEvent, type ReactNode } from 'react';
import { X, Loader2, Undo2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import type { Vehicle } from '../types';
import { normalizarMatricula, nuevoCambio, VENCIMIENTOS } from '../utils';
import { CampoFecha } from './CampoFecha';
import { TIPOS_CAJA, TIPOS_VEHICULO } from './FichaFormulario';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';

interface AddVehicleModalProps {
  setShowAddModal: (show: boolean) => void;
  todos: Vehicle[];   // todas las fichas, también las de fuera de la flota: para no crear una matrícula repetida
}

const clase = 'w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';
const Campo = ({ label, children }: { label: string; children: ReactNode }) => (
  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>{children}</div>
);

// Alta de un vehículo. Antes: sin mirar si la matrícula ya existía (ni si estaba «fuera de la flota»), sin normalizarla
// («9151kwj» y «9151KWJ» eran dos) y con doble clic se creaban dos fichas.
export const AddVehicleModal = ({ setShowAddModal, todos }: AddVehicleModalProps) => {
  const [matricula, setMatricula] = useState('');
  const [fechas, setFechas] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const m = normalizarMatricula(matricula);
  const iguales = m.length >= 4 ? todos.filter((v) => normalizarMatricula(v.matricula) === m) : [];
  const fuera = iguales.length === 1 && iguales[0].baja ? iguales[0] : null;
  const yaEsta = iguales.length > 0 && !fuera;

  const avisar = (que: string, error: any) => alert(esCuotaAgotada(error) ? AVISO_CUOTA : `${que}: ${error?.message || error}`);

  const recuperar = async () => {
    if (!fuera) return;
    setGuardando(true);
    try {
      await guardarCambios(fuera, { baja: deleteField(), bajaMotivo: deleteField(), bajaFecha: deleteField() }, 'Vuelve a la flota (desde «Añadir vehículo»)');
      setShowAddModal(false);
    } catch (error) { avisar('No se pudo devolver a la flota', error); } finally { setGuardando(false); }
  };

  const guardar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (guardando || iguales.length) return;
    if (m.length < 4) { alert('La matrícula no es válida'); return; }
    const f = new FormData(e.currentTarget);
    const txt = (k: string) => String(f.get(k) || '').trim();
    setGuardando(true);
    try {
      await addDoc(collection(db, 'vehicles'), {
        matricula: m, marca: txt('marca'), tipo: txt('tipo') || 'S/D', tipoCaja: txt('tipoCaja'), capacidad: txt('capacidad'),
        bastidor: txt('bastidor'), chofer: txt('chofer'), aseguradora: txt('aseguradora'), poliza: txt('poliza'),
        priority: txt('priority') || 'medium',
        ...Object.fromEntries(VENCIMIENTOS.map((t) => [t.campo, fechas[t.campo] || ''])),
        fechaMatriculacion: fechas.fechaMatriculacion || '',
        createdAt: serverTimestamp(),
        historial: [nuevoCambio(quienWeb(), 'Alta del vehículo')],
      });
      setShowAddModal(false);
    } catch (error) {
      avisar('No se pudo dar de alta', error);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-stretch md:items-center justify-center z-50 md:p-4">
      <div className="bg-white md:rounded-3xl p-5 md:p-6 w-full md:max-w-lg shadow-2xl overflow-y-auto h-full md:h-auto md:max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">Nuevo vehículo</h3>
          <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <datalist id="alta-tipos-vehiculo">{TIPOS_VEHICULO.map((t) => <option key={t} value={t} />)}</datalist>
        <datalist id="alta-tipos-caja">{TIPOS_CAJA.map((t) => <option key={t} value={t} />)}</datalist>
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo label="Matrícula">
              <input value={matricula} onChange={(e) => setMatricula(e.target.value)} required className={clase + ' uppercase'} placeholder="1234ABC" />
              {m && m !== matricula.trim() && !iguales.length && <p className="text-[11px] text-slate-400 mt-1">Se guardará como {m}</p>}
            </Campo>
            <Campo label="Avisar con antelación">
              <select name="priority" defaultValue="medium" className={clase + ' bg-white'}>
                <option value="low">15 días antes</option>
                <option value="medium">30 días antes</option>
                <option value="high">60 días antes</option>
              </select>
            </Campo>
          </div>

          {yaEsta && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">{m} ya está en la flota: no se puede dar de alta otra vez.</p>}
          {fuera && (
            <div className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p>{m} ya tiene ficha, pero está <b>fuera de la flota</b> ({fuera.bajaMotivo || 'sin motivo'}{fuera.bajaFecha ? `, desde ${fuera.bajaFecha}` : ''}), con sus datos y documentos.</p>
              <button type="button" onClick={recuperar} disabled={guardando} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 disabled:opacity-60">
                <Undo2 className="w-4 h-4" />Volver a ponerlo en la flota
              </button>
            </div>
          )}

          {!iguales.length && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Campo label="Marca / modelo"><input name="marca" required className={clase} /></Campo>
                <Campo label="Tipo"><input name="tipo" list="alta-tipos-vehiculo" placeholder="CAMION, FURGONETA…" className={clase} /></Campo>
                <Campo label="Tipo de caja"><input name="tipoCaja" list="alta-tipos-caja" placeholder="FRIGO, ISO… (llevan ATP)" className={clase} /></Campo>
                <Campo label="Capacidad"><input name="capacidad" placeholder="p. ej. 6.500 Kg" className={clase} /></Campo>
                <Campo label="Nº bastidor"><input name="bastidor" className={clase} /></Campo>
                <Campo label="Chófer habitual"><input name="chofer" className={clase} /></Campo>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-4 border border-slate-100">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vencimientos y seguro</h4>
                {VENCIMIENTOS.map((t) => (
                  <CampoFecha key={t.campo} label={t.label} original="" permitirNoAplica={t.clave !== 'itv' && t.clave !== 'seguro'}
                    onCambio={(v) => setFechas((x) => ({ ...x, [t.campo]: v }))} />
                ))}
                <CampoFecha label="F. matriculación" original="" permitirNoAplica={false} onCambio={(v) => setFechas((x) => ({ ...x, fechaMatriculacion: v }))} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Campo label="Aseguradora"><input name="aseguradora" className={clase + ' bg-white'} /></Campo>
                  <Campo label="Nº póliza"><input name="poliza" className={clase + ' bg-white'} /></Campo>
                </div>
              </div>
              <button type="submit" disabled={guardando} className="w-full bg-blue-600 text-white font-bold rounded-xl p-3 hover:bg-blue-700 shadow-lg shadow-blue-100 disabled:opacity-60 flex items-center justify-center gap-2">
                {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
                {guardando ? 'Guardando…' : 'Guardar vehículo'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
