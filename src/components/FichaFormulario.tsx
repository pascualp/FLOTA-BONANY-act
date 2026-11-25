import { useState, type FormEvent } from 'react';
import { deleteField } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import type { Vehicle } from '../types';
import { TRAMITES, VENCIMIENTOS, noAplica } from '../utils';
import { CampoFecha } from './CampoFecha';
import { guardarCambios } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';

// Formulario «Editar información» de la ficha de un vehículo.
// Guarda SOLO lo que se ha cambiado, comparado con lo que había al abrirlo; así no se deshace lo que otro cambió
// entretanto (por Telegram o en otra pestaña). Cada guardado deja una nota en el historial.

type CampoTexto = 'marca' | 'tipo' | 'tipoCaja' | 'capacidad' | 'bastidor' | 'chofer' | 'aseguradora' | 'poliza';
const ETIQUETA: Record<string, string> = {
  marca: 'Marca / modelo', tipo: 'Tipo', tipoCaja: 'Tipo de caja', capacidad: 'Capacidad', bastidor: 'Nº bastidor', chofer: 'Chófer',
  aseguradora: 'Aseguradora', poliza: 'Nº póliza', priority: 'Prioridad', fechaMatriculacion: 'F. matriculación',
  proximaITV: 'Próxima ITV', vencimientoATP: 'Vencimiento ATP', revisionTacografo: 'Revisión tacógrafo', vencimientoSeguro: 'Vencimiento del seguro',
};
export const TIPOS_VEHICULO = ['CAMION', 'FURGONETA', 'COMERCIAL', 'COCHE', 'REMOLQUE'];
export const TIPOS_CAJA = ['FRIGO', 'ISO', 'LONA', 'CAJA SECA', 'SIN CAJA'];
const clase = 'w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm';

export const FichaFormulario = ({ vehiculo, onTerminar }: { vehiculo: Vehicle; onTerminar: () => void }) => {
  // Lo que había al abrir el formulario: contra esto se compara para saber qué ha cambiado.
  const [inicial] = useState<Vehicle>(() => vehiculo);
  const [texto, setTexto] = useState<Record<CampoTexto, string>>(() => ({
    marca: inicial.marca || '', tipo: inicial.tipo || '', tipoCaja: inicial.tipoCaja || '', capacidad: inicial.capacidad || '',
    bastidor: inicial.bastidor || '', chofer: inicial.chofer || '', aseguradora: inicial.aseguradora || '', poliza: inicial.poliza || '',
  }));
  const [prioridad, setPrioridad] = useState(inicial.priority || 'medium');
  const [fechas, setFechas] = useState<Record<string, string>>({});   // solo las que se han tocado
  const [guardando, setGuardando] = useState(false);

  const campoTexto = (c: CampoTexto, extra: Record<string, unknown> = {}) => (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{ETIQUETA[c]}</label>
      <input value={texto[c]} onChange={(e) => setTexto({ ...texto, [c]: e.target.value })} className={clase} {...extra} />
    </div>
  );

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    const cambios: Record<string, unknown> = {};
    const lineas: string[] = [];
    for (const c of Object.keys(texto) as CampoTexto[]) {
      const antes = String(inicial[c] ?? '').trim();
      const ahora = texto[c].trim();
      if (ahora !== antes) { cambios[c] = ahora; lineas.push(`${ETIQUETA[c]}: ${antes || '—'} → ${ahora || '—'}`); }
    }
    if (prioridad !== (inicial.priority || 'medium')) { cambios.priority = prioridad; lineas.push(`Prioridad: ${prioridad}`); }
    for (const [campo, valor] of Object.entries(fechas)) {
      const antes = String((inicial as any)[campo] ?? '');
      if (valor === antes) continue;
      cambios[campo] = valor;
      lineas.push(`${ETIQUETA[campo]}: ${antes || '—'} → ${valor || '—'}`);
      // Fecha nueva en un trámite con cita: el trámite se hizo, la cita se quita (si no, el reporte preguntaría cada día
      // «¿se hizo?» y el planificador seguiría contando ese día como ocupado).
      const t = TRAMITES.find((x) => x.campo === campo);
      if (t && vehiculo.citas?.[t.clave] && valor && !noAplica(valor)) {
        cambios[`citas.${t.clave}`] = deleteField();
        lineas.push(`cita de ${t.label} dada por hecha`);
      }
    }
    if (!lineas.length) { onTerminar(); return; }
    setGuardando(true);
    try {
      await guardarCambios(vehiculo, cambios, lineas.join('; '));
      onTerminar();
    } catch (error: any) {
      alert(esCuotaAgotada(error) ? AVISO_CUOTA : `No se pudo guardar: ${error?.message || error}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} className="space-y-6">
      <datalist id="tipos-vehiculo">{TIPOS_VEHICULO.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="tipos-caja">{TIPOS_CAJA.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información general</h4>
          {campoTexto('marca')}
          {campoTexto('tipo', { list: 'tipos-vehiculo' })}
          {campoTexto('tipoCaja', { list: 'tipos-caja', placeholder: 'FRIGO, ISO… (frigo e isotermo llevan ATP)' })}
          {campoTexto('capacidad', { placeholder: 'p. ej. 6.500 Kg (más de 3.500 kg lleva tacógrafo)' })}
          {campoTexto('bastidor')}
          <CampoFecha label="F. matriculación" original={inicial.fechaMatriculacion} permitirNoAplica={false}
            onCambio={(v) => setFechas((f) => ({ ...f, fechaMatriculacion: v }))} />
          {campoTexto('chofer')}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Avisar con antelación</label>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as any)} className={clase + ' bg-white'}>
              <option value="low">15 días antes</option>
              <option value="medium">30 días antes</option>
              <option value="high">60 días antes</option>
            </select>
          </div>
        </div>
        <div className="space-y-4">
          <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Vencimientos y seguro</h4>
          {VENCIMIENTOS.map((t) => {
            const cita = t.clave !== 'seguro' ? vehiculo.citas?.[t.clave] : undefined;
            return (
              <CampoFecha key={t.campo} label={ETIQUETA[t.campo]} original={(inicial as any)[t.campo]}
                permitirNoAplica={t.clave !== 'itv' && t.clave !== 'seguro'}
                nota={cita ? `Tiene cita el ${cita.fecha}: al guardar la fecha nueva, la cita se da por hecha y se quita.` : undefined}
                onCambio={(v) => setFechas((f) => ({ ...f, [t.campo]: v }))} />
            );
          })}
          {campoTexto('aseguradora')}
          {campoTexto('poliza')}
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-6 border-t border-slate-100">
        <button type="button" onClick={onTerminar} className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
        <button type="submit" disabled={guardando} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
          {guardando && <Loader2 className="w-4 h-4 animate-spin" />}
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
};
