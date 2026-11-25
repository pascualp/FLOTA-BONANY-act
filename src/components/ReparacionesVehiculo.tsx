import { useEffect, useState, type FormEvent } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Wrench, Plus, Paperclip, Trash2, Loader2, Pencil } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Reparacion, Vehicle } from '../types';
import { aFechaInput, deFechaInput } from '../utils';
import { diaDe, euros, gastoPorAnio, leerImporte, ordenar } from '../reparaciones';
import { abrirDocumento, subirDocumento, tipoDe } from '../lib/documentosApi';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada, MAX_BYTES, TIPOS_ARCHIVO } from '../documentos';

// Historial de reparaciones y mantenimiento de un vehículo (vehicles/<id>/reparaciones). Se lee solo mientras la ficha
// está abierta. Cada reparación puede llevar su factura (foto o PDF, que va al almacén de archivos como «Factura de
// taller»). Por Telegram: foto de la factura → el bot la lee y propone guardarla. Lo de Winclass se importa con un script.

const clase = 'w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';
const vacio = { fecha: '', taller: '', que: '', importe: '', km: '', factura: '' };
const avisar = (que: string, e: any) => alert(esCuotaAgotada(e) ? AVISO_CUOTA : `${que}: ${e?.message || e}`);

export const ReparacionesVehiculo = ({ vehiculo, demo }: { vehiculo: Vehicle; demo?: boolean }) => {
  const [lista, setLista] = useState<Reparacion[]>([]);
  const [form, setForm] = useState<typeof vacio | null>(null);
  const [editando, setEditando] = useState<string | null>(null);   // id de la reparación que se edita
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verTodas, setVerTodas] = useState(false);

  useEffect(() => {
    if (!vehiculo.id || demo) return;
    return onSnapshot(collection(db, 'vehicles', vehiculo.id, 'reparaciones'),
      (s) => setLista(ordenar(s.docs.map((d) => ({ id: d.id, ...(d.data() as Reparacion) })))),
      (e) => console.error('Error leyendo las reparaciones:', e));
  }, [vehiculo.id, demo]);

  const anio = String(new Date().getFullYear());
  const gasto = gastoPorAnio(lista);
  const total = lista.reduce((s, x) => s + (x.importe || 0), 0);

  const abrirForm = (r?: Reparacion) => {
    setEditando(r?.id || null);
    setArchivo(null);
    setForm(r ? {
      fecha: aFechaInput(r.fecha), taller: r.taller || '', que: r.que, importe: r.importe != null ? String(r.importe) : '',
      km: r.km ? String(r.km) : '', factura: r.factura || '',
    } : { ...vacio });
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || !vehiculo.id) return;
    const fecha = deFechaInput(form.fecha);
    if (!fecha || !form.que.trim()) { alert('Pon al menos la fecha y qué se le hizo'); return; }
    const importe = form.importe.trim() ? leerImporte(form.importe) : null;
    if (form.importe.trim() && importe === null) { alert('El importe no se entiende (p. ej. 1234,56)'); return; }
    const km = form.km.trim() ? Number(form.km.replace(/\D/g, '')) : null;
    if (archivo && (archivo.size > MAX_BYTES || !TIPOS_ARCHIVO.includes(tipoDe(archivo)))) {
      alert('La factura tiene que ser un PDF o una foto de menos de 25 MB'); return;
    }
    setGuardando(true);
    try {
      // Primero la factura (si hay): así la reparación nace ya enlazada a ella.
      let documentoId: string | undefined;
      if (archivo) documentoId = (await subirDocumento(vehiculo.id, archivo, 'Factura de taller')).id;
      const datos: Record<string, any> = {
        fecha, dia: diaDe(fecha), que: form.que.trim(), taller: form.taller.trim(), factura: form.factura.trim(),
        importe, km: km || null, ...(documentoId ? { documentoId } : {}),
      };
      const resumen = `${fecha} · ${form.que.trim()}${importe != null ? ' · ' + euros(importe) : ''}`;
      if (editando) {
        await updateDoc(doc(db, 'vehicles', vehiculo.id, 'reparaciones', editando), datos);
        await guardarCambios(vehiculo, { ultimaReparacion: fecha }, `Reparación cambiada: ${resumen}`);
      } else {
        await addDoc(collection(db, 'vehicles', vehiculo.id, 'reparaciones'), {
          ...datos, origen: 'web', creadoPor: quienWeb(), creado: serverTimestamp(),
        });
        await guardarCambios(vehiculo, { ultimaReparacion: fecha }, `Reparación: ${resumen}`);
      }
      setForm(null);
    } catch (err) {
      avisar('No se pudo guardar la reparación', err);
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (r: Reparacion) => {
    if (!vehiculo.id || !r.id || !window.confirm(`¿Borrar la reparación del ${r.fecha} (${r.que})? La factura se queda en Documentación.`)) return;
    try {
      await deleteDoc(doc(db, 'vehicles', vehiculo.id, 'reparaciones', r.id));
      await guardarCambios(vehiculo, { ultimaReparacion: lista.find((x) => x.id !== r.id)?.fecha || '' }, `Reparación borrada: ${r.fecha} · ${r.que}`);
    } catch (err) { avisar('No se pudo borrar', err); }
  };

  const verFactura = async (docId: string) => {
    const ventana = window.open('', '_blank');
    ventana?.document.write('<p style="font-family:sans-serif;padding:2rem">Abriendo factura…</p>');
    try { await abrirDocumento(docId, ventana); } catch (err) { ventana?.close(); avisar('No se pudo abrir la factura', err); }
  };

  const visibles = verTodas ? lista : lista.slice(0, 8);

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <div>
          <h4 className="font-bold text-slate-800 flex items-center gap-2"><Wrench className="w-4 h-4" />Reparaciones y mantenimiento</h4>
          <p className="text-xs text-slate-400">
            {lista.length === 0 ? 'Todavía no hay ninguna apuntada. Por Telegram: manda la foto de la factura al bot.'
              : `${anio}: ${euros(gasto[anio]?.total || 0)} en ${gasto[anio]?.n || 0} · Total apuntado: ${euros(total)} en ${lista.length}`}
          </p>
        </div>
        {!form && (
          <button onClick={() => abrirForm()} className="text-xs font-bold px-3 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" />Añadir reparación
          </button>
        )}
      </div>

      {form && (
        <form onSubmit={guardar} className="mb-4 p-4 rounded-2xl border border-blue-100 bg-blue-50/40 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-bold text-slate-500 uppercase">Fecha
            <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={clase + ' mt-1 bg-white'} />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Taller
            <input value={form.taller} onChange={(e) => setForm({ ...form, taller: e.target.value })} className={clase + ' mt-1 bg-white'} />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase sm:col-span-2">Qué se le hizo
            <textarea value={form.que} onChange={(e) => setForm({ ...form, que: e.target.value })} rows={2} className={clase + ' mt-1 bg-white'} placeholder="Cambio de embrague, revisión, neumáticos…" />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Importe (€, IVA incluido)
            <input inputMode="decimal" value={form.importe} onChange={(e) => setForm({ ...form, importe: e.target.value })} className={clase + ' mt-1 bg-white'} placeholder="1234,56" />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Kilómetros
            <input inputMode="numeric" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} className={clase + ' mt-1 bg-white'} />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Nº de factura
            <input value={form.factura} onChange={(e) => setForm({ ...form, factura: e.target.value })} className={clase + ' mt-1 bg-white'} />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Factura (foto o PDF)
            <input type="file" accept=".pdf,image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="block mt-1 text-xs" />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button type="submit" disabled={guardando} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
              {guardando && <Loader2 className="w-4 h-4 animate-spin" />}{guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {lista.length > 0 && (
        <ul className="space-y-2">
          {visibles.map((r) => (
            <li key={r.id} className="p-3 rounded-xl border border-slate-100 flex justify-between gap-3 flex-wrap">
              <div className="min-w-0 text-sm">
                <p className="font-bold text-slate-700">{r.que}</p>
                <p className="text-xs text-slate-500">
                  {r.fecha}{r.taller ? ` · ${r.taller}` : ''}{r.km ? ` · ${r.km.toLocaleString('es-ES')} km` : ''}{r.factura ? ` · factura ${r.factura}` : ''}
                  {r.origen && r.origen !== 'web' ? ` · ${r.origen === 'winclass' ? 'de Winclass' : 'por Telegram'}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.importe != null && <span className="text-sm font-bold text-slate-800">{euros(r.importe)}</span>}
                {r.documentoId && (
                  <button onClick={() => verFactura(r.documentoId!)} title="Ver la factura" className="p-2 rounded-lg text-blue-600 hover:bg-blue-50"><Paperclip className="w-4 h-4" /></button>
                )}
                <button onClick={() => abrirForm(r)} title="Cambiar" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => borrar(r)} title="Borrar" className="p-2 rounded-lg text-red-400 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {lista.length > 8 && (
        <button onClick={() => setVerTodas(!verTodas)} className="mt-2 text-xs font-bold text-blue-600">{verTodas ? 'Ver menos' : `Ver las ${lista.length}`}</button>
      )}
    </div>
  );
};
