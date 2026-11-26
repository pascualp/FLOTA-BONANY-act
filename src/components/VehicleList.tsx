import { useState, type ReactNode } from 'react';
import { Car, FileSearch, ArchiveX, CheckCircle2, FileWarning, Copy } from 'lucide-react';
import { Vehicle, VehicleDocument } from '../types';
import { estadoDocumentacion } from '../documentos';
import { copiaDe } from '../copiaCamion';
import { fechaEnPantalla, fraseVencimiento, getVehicleAlerts, NOMBRE_CORTO, papelesCaducados, problemasDe, VENCIMIENTOS } from '../utils';
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
  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${clase}`}>{children}</span>
);

// Color de cada fecha en la tarjeta: rojo vencido, ámbar vence pronto, azul con cita, gris si no se entiende.
const COLOR_FECHA: Record<string, string> = {
  danger: 'text-red-600 font-bold', warning: 'text-amber-600 font-bold', unknown: 'text-slate-400 italic', success: 'font-medium',
};

// Filtro de la lista: todos, solo a los que faltan papeles por subir o solo los que no llevan la copia en el camión.
type Filtro = 'todos' | 'faltanPapeles' | 'sinCopia';

export const VehicleList = ({ vehicles, fuera, docsPorVehiculo, searchQuery, setSearchQuery, setSelectedVehicle }: VehicleListProps) => {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const term = searchQuery.trim().toLowerCase();
  const estado = (v: Vehicle) => estadoDocumentacion(v, docsPorVehiculo[v.id || ''] || []);
  const incompletos = vehicles.filter(v => estado(v).faltan.length > 0).length;
  const conCopia = vehicles.filter(v => copiaDe(v)).length;
  const pasaFiltro = (v: Vehicle) =>
    filtro === 'faltanPapeles' ? estado(v).faltan.length > 0 : filtro === 'sinCopia' ? !copiaDe(v) : true;
  const activos = vehicles.filter(v => coincide(v, term) && pasaFiltro(v));
  const deFuera = fuera.filter(v => coincide(v, term));
  const botonFiltro = (f: Filtro, texto: string, activo: string) => (
    <button
      onClick={() => setFiltro(filtro === f ? 'todos' : f)}
      className={`px-4 py-2 rounded-full text-xs font-bold border transition-colors ${filtro === f ? activo : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
    >
      {filtro === f ? `${texto} · ver todos` : texto}
    </button>
  );

  return (
    <div className="flex-1 min-w-0 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h4 className="font-bold text-slate-800">En la flota ({vehicles.length})</h4>
          <p className="text-xs text-slate-500">
            {incompletos === 0 ? 'Todos tienen sus papeles subidos.' : `A ${incompletos} ${incompletos === 1 ? 'le faltan' : 'les faltan'} papeles por subir. Toca uno para ver su ficha.`}
          </p>
          <p className="text-xs text-slate-500">
            {conCopia === vehicles.length ? 'Todos llevan la copia de los papeles en el camión.'
              : `Llevan copia de los papeles en el camión: ${conCopia} de ${vehicles.length}.`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {botonFiltro('faltanPapeles', filtro === 'faltanPapeles' ? 'Viendo solo a los que faltan papeles' : 'Ver solo a los que faltan papeles', 'bg-red-50 text-red-600 border-red-200')}
          {botonFiltro('sinCopia', filtro === 'sinCopia' ? 'Viendo solo los que no llevan copia' : 'Ver solo los que no llevan copia', 'bg-blue-50 text-blue-700 border-blue-200')}
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
            <p>{term ? 'No se encontraron vehículos que coincidan con la búsqueda.'
              : filtro === 'sinCopia' ? 'Todos llevan ya la copia de los papeles en el camión.'
              : filtro === 'faltanPapeles' ? 'A ninguno le faltan papeles.' : 'No hay vehículos en la flota.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activos.map(v => {
              const p = problemasDe(v);
              const fechas = getVehicleAlerts(v);
              const e = estado(v);
              // Papeles que tiene pero cuya fecha ya pasó: «tener el PDF» no es estar en regla.
              const vencidos = papelesCaducados(v).filter(c => e.exigidos.some(x => x.categoria === c && x.docs.length));
              return (
                <div
                  key={v.id}
                  onClick={() => setSelectedVehicle(v)}
                  className="border border-slate-100 p-4 rounded-2xl hover:shadow-md hover:border-blue-200 transition-all cursor-pointer bg-white relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h5 className="font-bold text-slate-900">{v.matricula}</h5>
                      <p className="text-xs text-slate-500">{v.marca} - {v.tipo}{v.chofer ? ` · ${v.chofer}` : ''}</p>
                      {/* Solo lo que hay que mirar: lo que está en regla no cuenta como alerta. */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {p.vencidos > 0 && <Insignia clase="bg-red-100 text-red-700">{p.vencidos} {p.vencidos === 1 ? 'caducado' : 'caducados'}</Insignia>}
                        {p.pronto > 0 && <Insignia clase="bg-amber-100 text-amber-800">{p.pronto === 1 ? '1 caduca pronto' : `${p.pronto} caducan pronto`}</Insignia>}
                        {p.revisar > 0 && <Insignia clase="bg-slate-100 text-slate-600">{p.revisar === 1 ? 'falta 1 fecha' : `faltan ${p.revisar} fechas`}</Insignia>}
                        {p.conCita > 0 && <Insignia clase="bg-blue-100 text-blue-700">📅 {p.conCita === 1 ? 'cita pedida' : `${p.conCita} citas pedidas`}</Insignia>}
                        {incidenciasDe(v).length > 0 && <Insignia clase="bg-orange-100 text-orange-800">🛠 {incidenciasDe(v).length === 1 ? '1 aviso del taller' : `${incidenciasDe(v).length} avisos del taller`}</Insignia>}
                        {p.vencidos + p.pronto + p.revisar + p.conCita + incidenciasDe(v).length === 0 && <Insignia clase="bg-emerald-50 text-emerald-700">✔ Todo en regla</Insignia>}
                      </div>
                    </div>
                    <Car className="w-5 h-5 text-blue-400 shrink-0" />
                  </div>
                  <div className="space-y-1 mt-3 text-xs">
                    {VENCIMIENTOS.map(t => {
                      const f = fechas.find(a => a.clave === t.clave);
                      return (
                        // Fecha siempre dd/mm/aaaa; y en palabras lo que no es una fecha («falta apuntarla», «no le toca»).
                        <div key={t.clave} className="flex justify-between gap-2">
                          <span className="text-slate-500 truncate">{NOMBRE_CORTO[t.clave]}{t.clave === 'seguro' && v.aseguradora ? ` (${v.aseguradora})` : ''}</span>
                          <span className={`whitespace-nowrap ${f ? (f.cita ? 'text-blue-700 font-bold' : COLOR_FECHA[f.status]) : 'text-slate-400'}`}
                            title={f ? fraseVencimiento(f) : 'A este vehículo no le toca'}>
                            {!f ? 'no le toca' : f.text === 'Falta la fecha' ? 'falta apuntarla' : f.cita ? `📅 cita el ${f.cita.fecha}`
                              : f.status === 'unknown' ? `${f.date} (?)` : `${f.status === 'danger' ? 'caducó el ' : 'hasta el '}${fechaEnPantalla(f.date)}`}
                          </span>
                        </div>
                      );
                    })}
                    <div className="pt-2 mt-1 border-t border-slate-50">
                      {e.faltan.length === 0 ? (
                        <p className="flex items-center gap-1 text-emerald-700 font-bold"><CheckCircle2 className="w-3.5 h-3.5" /> Papeles: están todos ({e.total})</p>
                      ) : (
                        <p className="flex items-start gap-1 text-red-600"><FileWarning className="w-3.5 h-3.5 shrink-0 mt-px" /><span><b>Faltan papeles:</b> {e.faltan.join(', ')}</span></p>
                      )}
                      {vencidos.length > 0 && <p className="text-[11px] text-amber-700 mt-1">⚠ Hay que subir el papel nuevo de: {vencidos.join(', ')} (el guardado ya caducó)</p>}
                      {copiaDe(v) ? (
                        <p className="flex items-center gap-1 text-emerald-700 mt-1"><Copy className="w-3.5 h-3.5" /> Copia en el camión desde el {copiaDe(v)!.fecha}</p>
                      ) : (
                        <p className="flex items-center gap-1 text-slate-400 mt-1"><Copy className="w-3.5 h-3.5" /> Todavía sin copia en el camión</p>
                      )}
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
