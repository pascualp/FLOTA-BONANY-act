import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Search } from 'lucide-react';
import type { Vehicle } from '../types';
import { fechaEnPantalla, fraseVencimiento, getVehicleAlerts, NOMBRE_CORTO, parseEsDate, type AlertaVehiculo } from '../utils';
import { incidenciasDe } from '../incidencias';
import { ImagenVehiculo } from './FotoVehiculo';

// «Qué hay que hacer» (rehecha el 26/11/2026, Facu: «mejora la interfaz para que no confunda a una persona que lo ve
// por primera vez»). Antes: una tabla con todas las filas en rosa, «EN REGLA» mezclado con lo vencido, fechas escritas
// de tres formas y un botón «Gestionar Vehículo». Ahora: arriba cuántas cosas hay de cada tipo (y tocarlas filtra);
// debajo, cada vehículo con SOLO lo que hay que hacer, dicho con una frase. Lo que está en regla no sale aquí.

type Tipo = 'vencido' | 'pronto' | 'incidencia' | 'falta' | 'cita';
type Cosa = { tipo: Tipo; clave: string; que: string; frase: string; cuando: number };

const TIPOS: { id: Tipo; titulo: string; ayuda: string; punto: string; borde: string; marco: string }[] = [
  { id: 'vencido', titulo: 'Caducado', ayuda: 'Hay que renovarlo ya', punto: 'bg-red-500', borde: 'border-l-red-500', marco: 'ring-red-400 bg-red-50' },
  { id: 'pronto', titulo: 'Caduca pronto', ayuda: 'Pedir cita ya', punto: 'bg-amber-500', borde: 'border-l-amber-500', marco: 'ring-amber-400 bg-amber-50' },
  { id: 'incidencia', titulo: 'Avisos del taller', ayuda: 'Cosas por arreglar', punto: 'bg-orange-400', borde: 'border-l-orange-400', marco: 'ring-orange-300 bg-orange-50' },
  { id: 'falta', titulo: 'Falta la fecha', ayuda: 'Apuntarla en la ficha', punto: 'bg-slate-400', borde: 'border-l-slate-400', marco: 'ring-slate-400 bg-slate-100' },
  { id: 'cita', titulo: 'Con cita pedida', ayuda: 'Solo falta llevarlo', punto: 'bg-blue-500', borde: 'border-l-blue-500', marco: 'ring-blue-400 bg-blue-50' },
];
const ORDEN: Record<Tipo, number> = { vencido: 0, pronto: 1, incidencia: 2, falta: 3, cita: 4 };
const tipo = (id: Tipo) => TIPOS.find((t) => t.id === id)!;

const tipoDe = (a: AlertaVehiculo): Tipo | null =>
  a.cita ? 'cita' : a.status === 'danger' ? 'vencido' : a.status === 'warning' ? 'pronto' : a.status === 'unknown' ? 'falta' : null;
const cuando = (fecha: string) => parseEsDate(fecha)?.getTime() ?? Number.MAX_SAFE_INTEGER;

// Lo que hay que hacer de un vehículo: sus vencimientos que no están en regla y sus incidencias del taller.
const cosasDe = (v: Vehicle): Cosa[] => [
  ...getVehicleAlerts(v).flatMap((a) => {
    const t = tipoDe(a);
    return t ? [{ tipo: t, clave: a.clave, que: NOMBRE_CORTO[a.clave], frase: fraseVencimiento(a), cuando: cuando(a.date) }] : [];
  }),
  ...incidenciasDe(v).map((i) => ({ tipo: 'incidencia' as const, clave: i.id, que: 'Taller', frase: `${i.texto} (desde el ${fechaEnPantalla(i.fecha)})`, cuando: cuando(i.fecha) })),
].sort((x, y) => ORDEN[x.tipo] - ORDEN[y.tipo] || x.cuando - y.cuando);

interface AlertsListProps {
  vehicles: Vehicle[];
  fotos: Record<string, string>;   // id del vehículo → enlace de su foto real (si tiene)
  setSelectedVehicle: (vehicle: Vehicle) => void;
  setIsEditing: (isEditing: boolean) => void;
}

export const AlertsList = ({ vehicles, fotos, setSelectedVehicle, setIsEditing }: AlertsListProps) => {
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState<Tipo | null>(null);

  const grupos = useMemo(() => vehicles.map((v) => ({ v, cosas: cosasDe(v) })).filter((g) => g.cosas.length), [vehicles]);
  const cuantas = (t: Tipo) => grupos.reduce((n, g) => n + g.cosas.filter((c) => c.tipo === t).length, 0);
  const enRegla = vehicles.length - grupos.length;

  const t = buscar.trim().toLowerCase();
  const visibles = grupos
    .map((g) => ({ ...g, cosas: filtro ? g.cosas.filter((c) => c.tipo === filtro) : g.cosas }))
    .filter((g) => g.cosas.length && (!t || [g.v.matricula, g.v.marca, g.v.chofer, g.v.tipo].some((x) => String(x ?? '').toLowerCase().includes(t))))
    // Lo más urgente arriba: primero por el peor tipo, luego por la fecha más antigua.
    .sort((a, b) => ORDEN[a.cosas[0].tipo] - ORDEN[b.cosas[0].tipo] || a.cosas[0].cuando - b.cosas[0].cuando);

  const abrir = (v: Vehicle) => { setSelectedVehicle(v); setIsEditing(false); };

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-4">
      {/* Cuántas cosas hay de cada tipo. Tocar una caja enseña solo esas (y tocarla otra vez, todo). */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
        {TIPOS.map((x) => {
          const n = cuantas(x.id);
          const activa = filtro === x.id;
          return (
            <button key={x.id} onClick={() => setFiltro(activa ? null : x.id)} disabled={n === 0 && !activa}
              className={`text-left p-3 md:p-4 rounded-2xl border transition-all ${activa ? `ring-2 border-transparent ${x.marco}` : 'bg-white border-slate-200 hover:border-slate-300'} ${n === 0 ? 'opacity-50' : ''}`}>
              <span className="flex items-center gap-2 text-xs md:text-sm font-bold text-slate-700"><span className={`w-2.5 h-2.5 rounded-full shrink-0 ${x.punto}`} />{x.titulo}</span>
              <span className="block text-2xl md:text-3xl font-bold text-slate-900 mt-1">{n}</span>
              <span className="block text-[11px] md:text-xs text-slate-500">{x.ayuda}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="p-4 md:p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="text-sm text-slate-600">
            {filtro ? (
              <p>Viendo solo: <b>{tipo(filtro).titulo.toLowerCase()}</b> · <button onClick={() => setFiltro(null)} className="text-blue-600 font-bold hover:underline">ver todo</button></p>
            ) : (
              <p>Toca un vehículo para abrir su ficha: ahí se apunta la fecha nueva o la cita.</p>
            )}
            {enRegla > 0 && (
              <p className="text-xs text-emerald-700 mt-0.5">✔ {enRegla === 1 ? '1 vehículo tiene' : `${enRegla} vehículos tienen`} todo en regla: no salen aquí (están en «Vehículos»).</p>
            )}
          </div>
          <div className="relative md:w-72 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Buscar matrícula, marca o chófer" value={buscar} onChange={(e) => setBuscar(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
        </div>

        {grupos.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-slate-500 py-16">
            <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" />
            <p className="font-bold text-slate-700">Todo en regla</p>
            <p className="text-sm">Ningún vehículo tiene nada caducado, por caducar ni pendiente.</p>
          </div>
        ) : visibles.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-12">Ningún vehículo coincide con la búsqueda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibles.map(({ v, cosas }) => (
              <li key={v.id} role="button" tabIndex={0} onClick={() => abrir(v)} onKeyDown={(e) => e.key === 'Enter' && abrir(v)}
                className={`flex items-center gap-3 px-4 md:px-5 py-4 border-l-4 cursor-pointer hover:bg-slate-50 focus:bg-slate-50 outline-none ${tipo(cosas[0].tipo).borde}`}>
                <ImagenVehiculo v={v} url={v.id ? fotos[v.id] : undefined} className="self-start w-16 h-12 rounded-lg shrink-0 border border-slate-100" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900">
                    {v.matricula}
                    <span className="ml-2 font-normal text-xs text-slate-500">{[v.marca, v.tipo, v.chofer].filter(Boolean).join(' · ')}</span>
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {cosas.map((c) => (
                      <li key={c.clave} className="flex items-start gap-2 text-sm leading-snug">
                        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${tipo(c.tipo).punto}`} />
                        <span><b className="text-slate-700">{c.que}:</b> <span className="text-slate-600">{c.frase}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="hidden md:flex items-center text-xs font-bold text-blue-600 shrink-0">Abrir ficha<ChevronRight className="w-4 h-4" /></span>
                <ChevronRight className="md:hidden w-5 h-5 text-slate-300 shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
