import { useState } from 'react';
import { X, Trash2, ArchiveX, Undo2, History, Pencil } from 'lucide-react';
import { db } from '../lib/firebase';
import { deleteDoc, deleteField, doc as firestoreDoc } from 'firebase/firestore';
import { Vehicle, VehicleDocument } from '../types';
import { getVehicleAlerts, VENCIMIENTOS } from '../utils';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';
import { borrarDocumento } from '../lib/documentosApi';
import { guardarCambios } from '../lib/guardarVehiculo';
import { FichaFormulario } from './FichaFormulario';
import { CitasVehiculo } from './CitasVehiculo';
import { DocumentosVehiculo } from './DocumentosVehiculo';
import { ReparacionesVehiculo } from './ReparacionesVehiculo';

interface VehicleModalProps {
  selectedVehicle: Vehicle;
  setSelectedVehicle: (vehicle: Vehicle | null) => void;
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
  vehicleDocuments: VehicleDocument[];
}

const COLOR: Record<string, string> = {
  danger: 'bg-red-100 text-red-600', warning: 'bg-amber-100 text-amber-700', unknown: 'bg-slate-200 text-slate-600', success: 'bg-emerald-100 text-emerald-700',
};
const PRIORIDAD: Record<string, string> = { low: '15 días antes', medium: '30 días antes', high: '60 días antes' };
const avisarError = (que: string, error: any) => alert(esCuotaAgotada(error) ? AVISO_CUOTA : `${que}: ${error?.message || error}`);
const hoyTexto = () => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Ficha de un vehículo: vencimientos, datos, citas, documentos e historial de cambios. En el móvil ocupa la pantalla.
export const VehicleModal = ({ selectedVehicle: v, setSelectedVehicle, isEditing, setIsEditing, vehicleDocuments }: VehicleModalProps) => {
  const [verTodoHistorial, setVerTodoHistorial] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const cerrar = () => { setSelectedVehicle(null); setIsEditing(false); };
  const alertas = getVehicleAlerts(v);
  const historial = v.historial || [];

  const sacarDeLaFlota = async () => {
    // «Sacar de la flota» en vez de borrar: se puede deshacer, conserva sus documentos y una pestaña con la web vieja
    // no lo vuelve a crear.
    const motivo = window.prompt(
      `¿Sacar ${v.matricula} de la flota? Dejará de salir en las alertas, el correo y Telegram, pero se queda guardado ` +
      'en «Vehículos → Fuera de la flota» y se puede devolver.\n\nMotivo:', 'No está en el GPS');
    if (motivo === null) return;
    try {
      await guardarCambios(v, { baja: true, bajaMotivo: motivo.trim() || 'Fuera de la flota', bajaFecha: hoyTexto() },
        `Sacado de la flota: ${motivo.trim() || 'sin motivo'}`);
      cerrar();
    } catch (err) { avisarError('No se pudo sacar de la flota', err); }
  };

  const volverALaFlota = async () => {
    try {
      await guardarCambios(v, { baja: deleteField(), bajaMotivo: deleteField(), bajaFecha: deleteField() }, 'Vuelve a la flota');
    } catch (err) { avisarError('No se pudo devolver a la flota', err); }
  };

  const borrarParaSiempre = async () => {
    const n = vehicleDocuments.length;
    if (!window.confirm(`¿Borrar ${v.matricula} PARA SIEMPRE${n ? ` y sus ${n} documentos` : ''}? Esto no se puede deshacer.`)) return;
    if (!v.id) return;
    setOcupado(true);
    try {
      // Primero sus documentos (archivo y ficha, por el servidor): antes se quedaban huérfanos en la base y el almacén.
      for (const d of vehicleDocuments) await borrarDocumento(d.id);
      await deleteDoc(firestoreDoc(db, 'vehicles', v.id));
      cerrar();
    } catch (err) {
      avisarError('No se pudo borrar del todo (lo que ya se borró, borrado está)', err);
    } finally {
      setOcupado(false);
    }
  };

  const boton = 'px-3 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2';

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-stretch md:items-center justify-center z-50 md:p-4">
      <div className="bg-white md:rounded-3xl p-4 md:p-6 w-full md:max-w-3xl shadow-2xl overflow-y-auto h-full md:h-auto md:max-h-[90vh]">
        <div className="flex justify-between items-start gap-3 mb-6">
          <div className="min-w-0">
            <h3 className="text-2xl font-bold text-slate-900">{v.matricula}</h3>
            <p className="text-slate-500 font-medium">{[v.marca, v.tipo, v.tipoCaja].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={cerrar} className="p-2 hover:bg-slate-100 rounded-full shrink-0" title="Cerrar"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button onClick={() => setIsEditing(!isEditing)}
            className={`${boton} ${isEditing ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
            <Pencil className="w-4 h-4" />{isEditing ? 'Dejar de editar' : 'Editar información'}
          </button>
          {!v.baja ? (
            <button onClick={sacarDeLaFlota} className={`${boton} bg-slate-100 text-slate-600 hover:bg-slate-200`}><ArchiveX className="w-4 h-4" />Sacar de la flota</button>
          ) : (
            <>
              <button onClick={volverALaFlota} className={`${boton} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}><Undo2 className="w-4 h-4" />Volver a la flota</button>
              <button onClick={borrarParaSiempre} disabled={ocupado} className={`${boton} text-red-500 hover:bg-red-50 disabled:opacity-50`}><Trash2 className="w-4 h-4" />{ocupado ? 'Borrando…' : 'Borrar para siempre'}</button>
            </>
          )}
        </div>

        {v.baja && (
          <div className="mb-6 p-3 rounded-xl bg-slate-100 border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
            <ArchiveX className="w-4 h-4 shrink-0" />
            <span><b>Fuera de la flota</b>: {v.bajaMotivo || 'sin motivo'}{v.bajaFecha ? ` (desde ${v.bajaFecha})` : ''}. No sale en las alertas, ni en el correo, ni en Telegram.</span>
          </div>
        )}

        {isEditing ? (
          <FichaFormulario vehiculo={v} onTerminar={() => setIsEditing(false)} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Vencimientos</h4>
              {VENCIMIENTOS.map((t) => {
                const a = alertas.find((x) => x.clave === t.clave);
                const valor = v[t.campo];
                return (
                  <div key={t.clave} className="flex justify-between items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.label}</p>
                      <p className="font-bold text-sm text-slate-700">{a ? a.date : valor || '—'}</p>
                      {t.clave === 'seguro' && (v.aseguradora || v.poliza) && (
                        <p className="text-xs text-slate-500">{[v.aseguradora, v.poliza && `póliza ${v.poliza}`].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    {a ? (
                      <span className={`text-[10px] px-2 py-1 rounded font-black whitespace-nowrap ${a.cita ? 'bg-blue-100 text-blue-700' : COLOR[a.status]}`}>
                        {a.cita ? `📅 Cita ${a.cita.fecha}` : a.text}
                      </span>
                    ) : <span className="text-[10px] text-slate-400">{valor ? 'No le toca' : '—'}</span>}
                  </div>
                );
              })}
            </div>
            <div className="space-y-3">
              <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Datos</h4>
              <div className="grid grid-cols-2 gap-4">
                {[
                  ['Tipo', v.tipo], ['Tipo de caja', v.tipoCaja], ['Capacidad', v.capacidad], ['F. matriculación', v.fechaMatriculacion],
                  ['Chófer', v.chofer], ['Avisar', PRIORIDAD[v.priority || 'medium']],
                ].map(([k, val]) => (
                  <div key={k}><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{k}</p><p className="font-medium text-sm">{val || '—'}</p></div>
                ))}
                <div className="col-span-2"><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nº bastidor</p><p className="font-medium text-sm text-slate-600 break-all">{v.bastidor || '—'}</p></div>
              </div>
            </div>
          </div>
        )}

        {!isEditing && <CitasVehiculo vehiculo={v} />}
        <DocumentosVehiculo vehiculo={v} documentos={vehicleDocuments} />
        {!isEditing && <ReparacionesVehiculo vehiculo={v} demo={import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')} />}

        {/* Quién cambió qué y cuándo (desde el 25/11/2026; lo de antes no quedó apuntado). */}
        <div className="mt-8 border-t border-slate-100 pt-6">
          <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-3"><History className="w-4 h-4" />Historial de cambios</h4>
          {historial.length === 0 ? (
            <p className="text-xs text-slate-400">Todavía no hay cambios apuntados.</p>
          ) : (
            <ul className="space-y-2">
              {(verTodoHistorial ? historial : historial.slice(0, 5)).map((c, i) => (
                <li key={i} className="text-xs text-slate-600 border-l-2 border-slate-200 pl-3">
                  <span className="text-slate-400">{new Date(c.cuando).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })} · {c.por}</span>
                  <span className="block">{c.que}</span>
                </li>
              ))}
            </ul>
          )}
          {historial.length > 5 && (
            <button onClick={() => setVerTodoHistorial(!verTodoHistorial)} className="mt-2 text-xs font-bold text-blue-600">
              {verTodoHistorial ? 'Ver menos' : `Ver los ${historial.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
