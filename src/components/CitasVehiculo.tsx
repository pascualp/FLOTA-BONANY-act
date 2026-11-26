import { useState } from 'react';
import { deleteField } from 'firebase/firestore';
import { CalendarPlus, CheckCircle2, Pencil, X } from 'lucide-react';
import type { Cita, ClaveTramite, Vehicle } from '../types';
import { aFechaInput, deFechaInput, getVehicleAlerts, NOMBRE_CORTO, TRAMITES } from '../utils';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';

// Citas de ITV, ATP y tacógrafo en la web (hasta el 25/11/2026 solo se podían ver y cambiar por Telegram).
// Lo mismo que hace el bot: apuntar una cita ya sacada, cambiarla, quitarla, o darla por HECHA poniendo la fecha del
// próximo vencimiento (la cita se quita sola). Todo queda en el historial del vehículo.

type Modo = { clave: ClaveTramite; que: 'nueva' | 'cambiar' | 'hecha' } | null;
const clase = 'border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';

export const CitasVehiculo = ({ vehiculo }: { vehiculo: Vehicle }) => {
  const [modo, setModo] = useState<Modo>(null);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [lugar, setLugar] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Trámites que le tocan a este vehículo (o que tienen cita aunque no le toquen).
  const alertas = getVehicleAlerts(vehiculo);
  const tramites = TRAMITES.filter((t) => alertas.some((a) => a.clave === t.clave) || vehiculo.citas?.[t.clave]);
  if (!tramites.length) return null;

  const abrir = (clave: ClaveTramite, que: 'nueva' | 'cambiar' | 'hecha') => {
    const c = vehiculo.citas?.[clave];
    setModo({ clave, que });
    setFecha(que === 'cambiar' && c ? aFechaInput(c.fecha) : '');
    setHora(que === 'cambiar' && c?.hora ? c.hora : '');
    setLugar(que === 'cambiar' && c?.lugar ? c.lugar : '');
  };

  const hacer = async (cambios: Record<string, unknown>, resumen: string) => {
    setGuardando(true);
    try {
      await guardarCambios(vehiculo, cambios, resumen);
      setModo(null);
    } catch (error: any) {
      alert(esCuotaAgotada(error) ? AVISO_CUOTA : `No se pudo guardar: ${error?.message || error}`);
    } finally {
      setGuardando(false);
    }
  };

  const confirmar = () => {
    if (!modo) return;
    const t = TRAMITES.find((x) => x.clave === modo.clave)!;
    const f = deFechaInput(fecha);
    if (!f) { alert('Elige la fecha'); return; }
    if (modo.que === 'hecha') {
      return hacer({ [t.campo]: f, [`citas.${t.clave}`]: deleteField() },
        `${t.label} hecha: próximo vencimiento ${f} (antes ${vehiculo[t.campo] || '—'}); cita quitada`);
    }
    // Cita nueva o cambiada: objeto entero y sin la marca «aviso2h», para que el aviso de 2 horas antes salga otra vez.
    const cita: Cita = { fecha: f, ...(hora ? { hora } : {}), ...(lugar.trim() ? { lugar: lugar.trim() } : {}), por: quienWeb() };
    return hacer({ [`citas.${t.clave}`]: cita },
      `Cita de ${t.label}: ${f}${hora ? ' ' + hora : ''}${lugar.trim() ? ' (' + lugar.trim() + ')' : ''}`);
  };

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <h4 className="font-bold text-slate-800 mb-1">Citas</h4>
      <p className="text-xs text-slate-400 mb-4">Citas ya sacadas, pendientes de llevar el vehículo. Avisa el día antes, la misma mañana y 2 horas antes.</p>
      <div className="space-y-3">
        {tramites.map((t) => {
          const c = vehiculo.citas?.[t.clave];
          const abierto = modo?.clave === t.clave;
          return (
            <div key={t.clave} className={`rounded-xl border p-3 ${c ? 'border-blue-100 bg-blue-50/50' : 'border-slate-100'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm">
                  <span className="font-bold text-slate-700">{NOMBRE_CORTO[t.clave]}</span>
                  {c ? (
                    <span className="block text-blue-700 font-semibold">
                      📅 {c.fecha}{c.hora ? ` a las ${c.hora}` : ''}{c.lugar ? ` · ${c.lugar}` : ''}
                    </span>
                  ) : (
                    <span className="block text-xs text-slate-400">Sin cita</span>
                  )}
                </div>
                {!abierto && (
                  <div className="flex gap-1 flex-wrap">
                    {c ? (
                      <>
                        <button onClick={() => abrir(t.clave, 'hecha')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Hecha</button>
                        <button onClick={() => abrir(t.clave, 'cambiar')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 flex items-center gap-1"><Pencil className="w-3.5 h-3.5" />Cambiar</button>
                        <button
                          disabled={guardando}
                          onClick={() => window.confirm(`¿Quitar la cita de ${t.label} del ${c.fecha}?`) && hacer({ [`citas.${t.clave}`]: deleteField() }, `Quitada la cita de ${t.label} del ${c.fecha}`)}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg text-red-500 hover:bg-red-50 flex items-center gap-1"><X className="w-3.5 h-3.5" />Quitar</button>
                      </>
                    ) : (
                      <button onClick={() => abrir(t.clave, 'nueva')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-1"><CalendarPlus className="w-3.5 h-3.5" />Apuntar cita</button>
                    )}
                  </div>
                )}
              </div>
              {abierto && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-slate-500">
                    {modo!.que === 'hecha' ? 'Próximo vencimiento' : 'Fecha de la cita'}
                    <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={clase + ' block mt-1'} />
                  </label>
                  {modo!.que !== 'hecha' && (
                    <>
                      <label className="text-xs text-slate-500">Hora
                        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={clase + ' block mt-1'} />
                      </label>
                      <label className="text-xs text-slate-500 flex-1 min-w-[140px]">Lugar
                        <input value={lugar} onChange={(e) => setLugar(e.target.value)} placeholder="Estación o taller" className={clase + ' block mt-1 w-full'} />
                      </label>
                    </>
                  )}
                  <button disabled={guardando} onClick={confirmar} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 disabled:opacity-60">
                    {guardando ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button onClick={() => setModo(null)} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
