// «Kilómetros y aceite» en la ficha (27/11/2026, Facu: «hay que ir poniendo los kilómetros para llevar un control» del
// cambio de aceite y filtros). Se apunta en dos toques: «Apuntar km» y «Cambio de aceite hecho». Debajo, lo último que
// se leyó del GPS (chófer, taller, última señal): del GPS solo se lee.
import { useState } from 'react';
import { Gauge, Droplets, Satellite, Wrench, Loader2 } from 'lucide-react';
import type { Vehicle } from '../types';
import { estadoAceite, leerKm, textoKm, textoLecturaKm, ACEITE_CADA_KM, ACEITE_CADA_MESES } from '../aceite';
import { cuandoLeido, diasSinSenal } from '../gps';
import { fechaEnPantalla, parseEsDate } from '../utils';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';

const PUNTO: Record<string, string> = { danger: 'bg-red-500', warning: 'bg-amber-500', unknown: 'bg-slate-400', success: 'bg-emerald-500' };
const FONDO: Record<string, string> = {
  danger: 'bg-red-50 border-red-200', warning: 'bg-amber-50 border-amber-200', unknown: 'bg-slate-50 border-slate-200', success: 'bg-white border-slate-100',
};
const hoyTexto = () => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const avisar = (que: string, e: any) => alert(esCuotaAgotada(e) ? AVISO_CUOTA : `${que}: ${e?.message || e}`);

export const KmAceiteVehiculo = ({ vehiculo: v, demo }: { vehiculo: Vehicle; demo?: boolean }) => {
  const [ocupado, setOcupado] = useState(false);
  const aceite = estadoAceite(v);
  const lectura = textoLecturaKm(v);
  const sinSenal = diasSinSenal(v);

  const guardar = async (cambios: Record<string, unknown>, resumen: string) => {
    if (demo) { alert(`Modo prueba: no se guarda nada.\n${resumen}`); return; }
    setOcupado(true);
    try { await guardarCambios(v, cambios, resumen); } catch (e) { avisar('No se pudo guardar', e); } finally { setOcupado(false); }
  };

  const apuntarKm = async () => {
    const txt = window.prompt(`Km que marca AHORA el cuentakilómetros de ${v.matricula}:`, v.km ? String(v.km) : '');
    if (txt === null) return;
    const km = leerKm(txt);
    if (km === null) { alert(`«${txt}» no es un número de km válido.`); return; }
    if (v.km && km < v.km && !window.confirm(`${textoKm(km)} es MENOS que lo apuntado (${textoKm(v.km)}). ¿Lo corrijo igualmente?`)) return;
    await guardar({ km, kmFecha: hoyTexto(), kmFuente: quienWeb() }, `Km: ${v.km ? textoKm(v.km) : '—'} → ${textoKm(km)}`);
  };

  const aceiteHecho = async () => {
    const fecha = window.prompt(`¿Qué día se cambió el aceite y los filtros de ${v.matricula}? (dd/mm/aaaa)`, hoyTexto());
    if (fecha === null) return;
    const d = parseEsDate(fecha);
    if (!d || d.getTime() > Date.now() + 86400000) { alert(`«${fecha}» no es una fecha válida.`); return; }
    const txtKm = window.prompt(`¿Con cuántos km? (lo que marcaba el cuentakilómetros; déjalo vacío si no se sabe)`, v.km ? String(v.km) : '');
    if (txtKm === null) return;
    const km = txtKm.trim() ? leerKm(txtKm) : null;
    if (txtKm.trim() && km === null) { alert(`«${txtKm}» no es un número de km válido.`); return; }
    const f = fechaEnPantalla(fecha);
    const cambios: Record<string, unknown> = { aceiteFecha: f, aceiteKm: km ?? null, aceiteFuente: quienWeb() };
    // Si el km del cambio es más nuevo que la última lectura, también es la lectura de km más nueva.
    if (km !== null && (!v.km || km > v.km)) Object.assign(cambios, { km, kmFecha: f, kmFuente: `Cambio de aceite · ${quienWeb()}` });
    await guardar(cambios, `Cambio de aceite y filtros hecho el ${f}${km !== null ? ` a los ${textoKm(km)}` : ''}`);
  };

  const cadaKm = v.aceiteCadaKm || ACEITE_CADA_KM;
  const cadaMeses = v.aceiteCadaMeses || ACEITE_CADA_MESES;
  const boton = 'px-3 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 disabled:opacity-50';

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-3"><Gauge className="w-4 h-4" />Kilómetros y aceite</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border bg-white border-slate-100">
          <p className="font-bold text-sm text-slate-800">Kilómetros</p>
          <p className="text-sm text-slate-600">{lectura || 'Todavía no se han apuntado'}</p>
          <button onClick={apuntarKm} disabled={ocupado} className={`${boton} mt-2 bg-blue-50 text-blue-600 hover:bg-blue-100`}>
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}Apuntar km
          </button>
        </div>
        <div className={`p-3 rounded-xl border ${FONDO[aceite.status]}`}>
          <p className="font-bold text-sm text-slate-800 flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${PUNTO[aceite.status]}`} />Aceite y filtros
          </p>
          <p className="text-sm text-slate-600">{aceite.frase}</p>
          <p className="text-xs text-slate-500 mt-1">
            {v.aceiteFecha || v.aceiteKm ? `Último: ${[v.aceiteFecha && fechaEnPantalla(v.aceiteFecha), v.aceiteKm && `a los ${textoKm(v.aceiteKm)}`].filter(Boolean).join(' ')}${v.aceiteFuente ? ` · ${v.aceiteFuente}` : ''}. ` : ''}
            Se cambia cada {textoKm(cadaKm)} o {cadaMeses} meses{!v.aceiteCadaKm && !v.aceiteCadaMeses ? ' (lo general: se cambia en «Editar información»)' : ''}.
          </p>
          <button onClick={aceiteHecho} disabled={ocupado} className={`${boton} mt-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
            <Droplets className="w-4 h-4" />Cambio de aceite hecho
          </button>
        </div>
      </div>
      {v.gps && (
        <div className="mt-3 p-3 rounded-xl border bg-slate-50 border-slate-200 text-sm text-slate-600 flex items-start gap-2">
          {v.gps.taller ? <Wrench className="w-4 h-4 shrink-0 mt-0.5 text-orange-600" /> : <Satellite className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>
            <b className="text-slate-700">GPS:</b>{' '}
            {v.gps.taller ? <b className="text-orange-700">en el taller ({v.gps.taller})</b> : v.gps.conductor ? `lo lleva ${v.gps.conductor}` : 'sin conductor puesto'}
            {` · última señal ${v.gps.senal}`}{v.gps.motor ? ` · ${v.gps.motor.toLowerCase()}` : ''}
            {sinSenal !== null && sinSenal >= 3 && <b className="text-red-600">{` · sin señal desde hace ${sinSenal} días`}</b>}
            <span className="block text-xs text-slate-400">{cuandoLeido(v)} (del GPS solo se lee)</span>
          </span>
        </div>
      )}
    </div>
  );
};
