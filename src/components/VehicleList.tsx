import { useState, type ReactNode } from 'react';
import { Car, FileSearch, ArchiveX, CheckCircle2, FileWarning, Copy, AlertTriangle } from 'lucide-react';
import { Vehicle, VehicleDocument } from '../types';
import { estadoDocumentacion } from '../documentos';
import { copiaDe } from '../copiaCamion';
import { fechaEnPantalla, fraseVencimiento, getVehicleAlerts, NOMBRE_CORTO, papelesCaducados, problemasDe, VENCIMIENTOS, type AlertaVehiculo } from '../utils';
import { incidenciasDe } from '../incidencias';

interface VehicleListProps {
  vehicles: Vehicle[];                                // la flota que SÍ tenemos
  fuera: Vehicle[];                                   // fuera de la flota (campo «baja»: no está en el GPS, vendido…)
  docsPorVehiculo: Record<string, VehicleDocument[]>; // id del vehículo → sus documentos
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setSelectedVehicle: (vehicle: Vehicle) => void;
}

// String(): en la base hay fichas con campos vacíos o que no son texto; así el buscador no se rompe con ninguna.
const coincide = (v: Vehicle, term: string) =>
  !term ||
  [v.matricula, v.marca, v.bastidor, v.chofer].some(x => String(x ?? '').toLowerCase().includes(term));

const Insignia = ({ clase, children }: { clase: string; children: ReactNode }) => (
  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap ${clase}`}>{children}</span>
);

// Cada parte de la tarjeta con su título y una raya encima (26/11/2026, Facu: «está todo muy junto, divide cada cosa»).
const Parte = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <div className="px-4 py-3 border-t border-slate-100">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{titulo}</p>
    {children}
  </div>
);

// Casilla de cada vencimiento: rojo caducado, ámbar caduca pronto, azul con cita, gris si falta la fecha, blanco en
// regla y punteada si al vehículo no le toca.
const TONO: Record<string, string> = {
  danger: 'bg-red-50 border-red-200 text-red-700', warning: 'bg-amber-50 border-amber-200 text-amber-800',
  unknown: 'bg-slate-50 border-slate-200 text-slate-500', success: 'bg-white border-slate-200 text-slate-800',
  cita: 'bg-blue-50 border-blue-200 text-blue-800', noToca: 'bg-white border-dashed border-slate-200 text-slate-400',
};
// Lo que pone la casilla: fecha siempre dd/mm/aaaa, y en palabras lo que no es una fecha.
const textoCasilla = (f?: AlertaVehiculo) =>
  !f ? 'No le toca' : f.text === 'Falta la fecha' ? 'Falta apuntarla' : f.cita ? `Cita el ${f.cita.fecha}`
    : f.status === 'unknown' ? `${f.date} (no se entiende)` : `${f.status === 'danger' ? 'Caducó el' : 'Hasta el'} ${fechaEnPantalla(f.date)}`;

type Filtro = 'todos' | 'faltanPapeles' | 'sinCopia';

export const VehicleList = ({ vehicles, fuera, docsPorVehiculo, searchQuery, setSearchQuery, setSelectedVehicle }: VehicleListProps) => {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const term = searchQuery.trim().toLowerCase();
  const estado = (v: Vehicle) => estadoDocumentacion(v, docsPorVehiculo[v.id || ''] || []);
  const faltanPapeles = vehicles.filter(v => estado(v).faltan.length > 0).length;
  const sinCopia = vehicles.filter(v => !copiaDe(v)).length;
  const pasaFiltro = (v: Vehicle) =>
    filtro === 'faltanPapeles' ? estado(v).faltan.length > 0 : filtro === 'sinCopia' ? !copiaDe(v) : true;
  const activos = vehicles.filter(v => coincide(v, term) && pasaFiltro(v));
  const deFuera = fuera.filter(v => coincide(v, term));

  // Pestañas que filtran y a la vez dicen cuántos hay de cada cosa (antes: dos frases y dos botones aparte).
  const pestana = (f: Filtro, texto: string, n: number, activa: string) => (
    <button onClick={() => setFiltro(f)}
      className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors flex items-center gap-2 ${filtro === f ? activa : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
      {texto}<span className={`text-xs font-bold px-2 py-0.5 rounded-full ${filtro === f ? 'bg-white text-slate-800' : 'bg-slate-100'}`}>{n}</span>
    </button>
  );

  return (
    <div className="flex-1 min-w-0 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-4 md:p-6 border-b border-slate-100 space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h4 className="font-bold text-slate-800">En la flota ({vehicles.length})</h4>
            <p className="text-xs text-slate-500">Toca un vehículo para ver su ficha.</p>
          </div>
          <div className="relative w-full sm:max-w-sm">
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
        <div className="flex flex-wrap gap-2">
          {pestana('todos', 'Todos', vehicles.length, 'bg-slate-800 text-white border-slate-800')}
          {pestana('faltanPapeles', 'Faltan papeles', faltanPapeles, 'bg-red-50 text-red-700 border-red-300')}
          {pestana('sinCopia', 'Sin copia en el camión', sinCopia, 'bg-blue-50 text-blue-800 border-blue-300')}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8 bg-slate-50/60">
        {activos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Car className="w-12 h-12 mb-4 opacity-50" />
            <p>{term ? 'No se encontraron vehículos que coincidan con la búsqueda.'
              : filtro === 'sinCopia' ? 'Todos llevan ya la copia de los papeles en el camión.'
              : filtro === 'faltanPapeles' ? 'A ninguno le faltan papeles.' : 'No hay vehículos en la flota.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {activos.map(v => {
              const p = problemasDe(v);
              const fechas = getVehicleAlerts(v);
              const e = estado(v);
              const incs = incidenciasDe(v).length;
              const copia = copiaDe(v);
              // Papeles que tiene pero cuya fecha ya pasó: «tener el PDF» no es estar en regla.
              const vencidos = papelesCaducados(v).filter(c => e.exigidos.some(x => x.categoria === c && x.docs.length));
              return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVehicle(v)}
                  className="border border-slate-200 rounded-2xl hover:shadow-md hover:border-blue-300 transition-all cursor-pointer bg-white overflow-hidden flex flex-col"
                >
                  {/* 1. Qué vehículo es y lo que hay que mirar (lo que está en regla no cuenta como alerta). */}
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h5 className="text-lg font-bold text-slate-900 leading-tight">{v.matricula}</h5>
                        <p className="text-xs text-slate-500 truncate">{[v.marca, v.tipo].filter(Boolean).join(' · ')}{v.chofer ? ` · ${v.chofer}` : ''}</p>
                      </div>
                      <Car className="w-5 h-5 text-blue-400 shrink-0" />
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {p.vencidos > 0 && <Insignia clase="bg-red-100 text-red-700">{p.vencidos} {p.vencidos === 1 ? 'caducado' : 'caducados'}</Insignia>}
                      {p.pronto > 0 && <Insignia clase="bg-amber-100 text-amber-800">{p.pronto === 1 ? '1 caduca pronto' : `${p.pronto} caducan pronto`}</Insignia>}
                      {p.revisar > 0 && <Insignia clase="bg-slate-100 text-slate-600">{p.revisar === 1 ? 'falta 1 fecha' : `faltan ${p.revisar} fechas`}</Insignia>}
                      {p.conCita > 0 && <Insignia clase="bg-blue-100 text-blue-700">📅 {p.conCita === 1 ? 'cita pedida' : `${p.conCita} citas pedidas`}</Insignia>}
                      {incs > 0 && <Insignia clase="bg-orange-100 text-orange-800">🛠 {incs === 1 ? '1 aviso del taller' : `${incs} avisos del taller`}</Insignia>}
                      {p.vencidos + p.pronto + p.revisar + p.conCita + incs === 0 && <Insignia clase="bg-emerald-50 text-emerald-700">✔ Todo en regla</Insignia>}
                    </div>
                  </div>

                  {/* 2. Una casilla por vencimiento. */}
                  <Parte titulo="Vencimientos">
                    <div className="grid grid-cols-2 gap-2">
                      {VENCIMIENTOS.map(t => {
                        const f = fechas.find(a => a.clave === t.clave);
                        const tono = !f ? TONO.noToca : f.cita ? TONO.cita : TONO[f.status];
                        return (
                          <div key={t.clave} className={`rounded-xl border px-3 py-2 min-w-0 ${tono}`} title={f ? fraseVencimiento(f) : 'A este vehículo no le toca'}>
                            <p className="text-[10px] font-bold uppercase tracking-wide opacity-70 truncate">
                              {NOMBRE_CORTO[t.clave]}{t.clave === 'seguro' && v.aseguradora ? ` · ${v.aseguradora}` : ''}
                            </p>
                            <p className={`text-[13px] leading-snug ${f && f.status !== 'success' && !f.cita ? 'font-bold' : 'font-medium'}`}>{textoCasilla(f)}</p>
                          </div>
                        );
                      })}
                    </div>
                  </Parte>

                  {/* 3. Papeles subidos a la app. */}
                  <Parte titulo="Papeles">
                    <div className="space-y-1.5 text-sm">
                      {e.faltan.length === 0 ? (
                        <p className="flex items-center gap-1.5 text-emerald-700 font-semibold"><CheckCircle2 className="w-4 h-4 shrink-0" />Están todos ({e.total})</p>
                      ) : (
                        <p className="flex items-start gap-1.5 text-red-700"><FileWarning className="w-4 h-4 shrink-0 mt-0.5" /><span><b>Faltan:</b> {e.faltan.join(', ')}</span></p>
                      )}
                      {vencidos.length > 0 && (
                        <p className="flex items-start gap-1.5 text-amber-800 text-[13px]"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>Subir el nuevo de: <b>{vencidos.join(', ')}</b> (el guardado ya caducó)</span></p>
                      )}
                    </div>
                  </Parte>

                  {/* 4. Copia de los papeles en el camión (los originales, en la oficina). */}
                  <Parte titulo="Copia en el camión">
                    {copia ? (
                      <p className="flex items-center gap-1.5 text-sm text-emerald-700 font-semibold"><CheckCircle2 className="w-4 h-4 shrink-0" />La lleva desde el {copia.fecha}</p>
                    ) : (
                      <p className="flex items-center gap-1.5 text-sm text-slate-500"><Copy className="w-4 h-4 shrink-0" />Todavía no la lleva</p>
                    )}
                  </Parte>
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
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {deFuera.map(v => (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVehicle(v)}
                    className="border border-dashed border-slate-300 p-4 rounded-2xl hover:border-slate-400 transition-all cursor-pointer bg-slate-50 text-slate-500"
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
