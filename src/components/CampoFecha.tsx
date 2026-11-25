import { useState } from 'react';
import { aFechaInput, deFechaInput, noAplica } from '../utils';

// Fecha con el calendario del navegador (en el móvil sale la rueda de fechas) en vez de texto libre: se acabaron
// «sep/2026», «00/00/00» o «FALTA». Se guarda siempre como dd/mm/aaaa.
// - «No le toca»: guarda «N/A» (ese trámite no es para este vehículo: no avisa ni sale como que falta).
// - Si lo guardado no se entiende, lo enseña para que se elija la fecha buena.
// - Solo avisa al padre cuando la persona TOCA el campo: si no, se guarda tal cual estaba (no se reescribe «23/03/27»
//   como «23/03/2027» sin que nadie lo haya cambiado).
interface Props {
  label: string;
  original: string | undefined;
  onCambio: (valor: string) => void;     // dd/mm/aaaa, 'N/A' o '' (borrar)
  permitirNoAplica?: boolean;
  nota?: string;                         // p. ej. «al guardar una fecha nueva se quita la cita del 02/12»
}

export const CampoFecha = ({ label, original, onCambio, permitirNoAplica = true, nota }: Props) => {
  const [iso, setIso] = useState(() => aFechaInput(original));
  const [noToca, setNoToca] = useState(() => noAplica(original));
  const [tocado, setTocado] = useState(false);
  const raro = !!original && String(original).trim() !== '' && !noAplica(original) && !aFechaInput(original);

  const cambiarFecha = (v: string) => { setIso(v); setTocado(true); onCambio(deFechaInput(v)); };
  const cambiarNoToca = (v: boolean) => { setNoToca(v); setTocado(true); onCambio(v ? 'N/A' : deFechaInput(iso)); };

  return (
    <div>
      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={noToca ? '' : iso}
          disabled={noToca}
          onChange={(e) => cambiarFecha(e.target.value)}
          className="flex-1 min-w-[150px] border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm disabled:bg-slate-50 disabled:text-slate-400"
        />
        {permitirNoAplica && (
          <label className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap cursor-pointer select-none">
            <input type="checkbox" checked={noToca} onChange={(e) => cambiarNoToca(e.target.checked)} />
            No le toca
          </label>
        )}
      </div>
      {raro && !tocado && (
        <p className="text-[11px] text-amber-700 mt-1">Ahora pone «{original}», que no se entiende: elige la fecha en el calendario.</p>
      )}
      {nota && tocado && !noToca && iso && <p className="text-[11px] text-blue-700 mt-1">{nota}</p>}
    </div>
  );
};
