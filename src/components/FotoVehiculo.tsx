// Imagen de cada vehículo (26/11/2026): la foto REAL si alguien la ha puesto; si no, una foto de MUESTRA de su modelo
// (src/modelos.ts); y si no se sabe el modelo, el dibujo de siempre. En la ficha, además, se pone, cambia o quita la real.
import { useEffect, useRef, useState } from 'react';
import { Camera, Car, Loader2, Trash2 } from 'lucide-react';
import { deleteField } from 'firebase/firestore';
import type { Vehicle } from '../types';
import { modeloDe } from '../modelos';
import { AVISO_CUOTA, esCuotaAgotada } from '../documentos';
import { borrarFoto, reducirFoto, subirFoto } from '../lib/documentosApi';
import { guardarCambios, quienWeb } from '../lib/guardarVehiculo';

// Si el enlace de la foto real falla (caducado, sin conexión…), se cae a la de muestra en vez de dejar un hueco roto.
function useFuente(v: Vehicle, url?: string) {
  const [falla, setFalla] = useState(false);
  useEffect(() => setFalla(false), [url]);
  const modelo = modeloDe(v);
  const real = !!url && !falla;
  // La de muestra es el vehículo recortado sobre blanco: se enseña ENTERO (contain) sobre blanco. La real llena el hueco.
  const encaje = real ? 'object-cover bg-slate-100' : 'object-contain bg-white';
  return { modelo, real, encaje, src: real ? url : modelo?.img, alFallar: () => url && setFalla(true) };
}

// Solo la imagen, en pequeño (tarjetas de la lista).
export function ImagenVehiculo({ v, url, className = '' }: { v: Vehicle; url?: string; className?: string }) {
  const { modelo, real, encaje, src, alFallar } = useFuente(v, url);
  if (!src) {
    return <div className={`${className} bg-slate-100 flex items-center justify-center`}><Car className="w-1/2 h-1/2 text-slate-300" /></div>;
  }
  return (
    <img src={src} alt={real ? `Foto de ${v.matricula}` : `${modelo?.nombre} (foto de muestra)`} loading="lazy" onError={alFallar}
      title={real ? 'Foto real' : `Foto de muestra: ${modelo?.nombre}`} className={`${className} ${encaje}`} />
  );
}

const hoyTexto = () => new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const avisar = (que: string, e: any) => alert(esCuotaAgotada(e) ? AVISO_CUOTA : `${que}: ${e?.message || e}`);

interface FotoFichaProps {
  v: Vehicle;
  url?: string;
  demo?: boolean;                                          // modo prueba: no sube nada, solo la enseña en esta pestaña
  onFotoLocal: (vehicleId: string, url: string | null) => void;   // para verla al momento, sin esperar al almacén
}

// En la ficha: la imagen en grande, de quién es y los botones.
export function FotoFicha({ v, url, demo, onFotoLocal }: FotoFichaProps) {
  const { modelo, real, encaje, src, alFallar } = useFuente(v, url);
  const selector = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState('');

  const poner = async (file?: File) => {
    if (!file || !v.id) return;
    try {
      setOcupado('Preparando la foto…');
      const foto = await reducirFoto(file);
      if (!demo) await subirFoto(v.id, foto, (pct) => setOcupado(`Subiendo… ${pct} %`));
      // Primero se ve aquí; al guardar la ficha, todas las pantallas piden el enlace nuevo y sustituye a esta vista previa.
      onFotoLocal(v.id, URL.createObjectURL(foto));
      if (!demo) {
        await guardarCambios(v, { foto: { fecha: hoyTexto(), por: quienWeb(), v: Date.now() } },
          v.foto ? 'Foto del vehículo cambiada' : 'Foto del vehículo puesta');
      }
    } catch (e) {
      avisar('No se pudo poner la foto', e);
    } finally {
      setOcupado('');
    }
  };

  const quitar = async () => {
    if (!v.id || !window.confirm(`¿Quitar la foto de ${v.matricula}? Volverá a salir la foto de muestra del modelo.`)) return;
    try {
      setOcupado('Quitando…');
      if (!demo) {
        await borrarFoto(v.id);
        await guardarCambios(v, { foto: deleteField() }, 'Foto del vehículo quitada');
      }
      onFotoLocal(v.id, null);
    } catch (e) {
      avisar('No se pudo quitar la foto', e);
    } finally {
      setOcupado('');
    }
  };

  const boton = 'px-3 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 disabled:opacity-50';
  return (
    <div className="mb-6 flex flex-col sm:flex-row gap-4 sm:items-end">
      <div className="relative w-full sm:w-72 shrink-0">
        {src ? (
          <img src={src} alt={real ? `Foto de ${v.matricula}` : `${modelo?.nombre} (foto de muestra)`} onError={alFallar}
            className={`w-full aspect-[3/2] rounded-2xl border border-slate-200 ${encaje}`} />
        ) : (
          <div className="w-full aspect-[3/2] rounded-2xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center">
            <Car className="w-16 h-16 text-slate-300" />
          </div>
        )}
        {!real && src && (
          <span className="absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/90 text-slate-600 shadow-sm">Foto de muestra</span>
        )}
        {ocupado && (
          <div className="absolute inset-0 rounded-2xl bg-white/70 flex items-center justify-center gap-2 text-sm font-bold text-slate-700">
            <Loader2 className="w-4 h-4 animate-spin" />{ocupado}
          </div>
        )}
      </div>
      <div className="space-y-3 min-w-0">
        <p className="text-xs text-slate-500 leading-relaxed">
          {real ? (
            <>Foto real{v.foto ? `, puesta el ${v.foto.fecha} (${v.foto.por.replace(/^Web · /, '')})` : ''}.</>
          ) : modelo ? (
            <>
              <b className="text-slate-700">{modelo.nombre}</b>: foto de muestra del modelo, no es el nuestro.{' '}
              <a href={modelo.pagina} target="_blank" rel="noreferrer" className="underline hover:text-slate-700">
                Foto: {modelo.autor} · {modelo.licencia} (Wikimedia Commons), fondo quitado
              </a>
            </>
          ) : (
            <>No sé qué modelo es: pon la marca y el modelo en «Editar información», o haz una foto.</>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => selector.current?.click()} disabled={!!ocupado}
            className={`${boton} bg-blue-50 text-blue-600 hover:bg-blue-100`}>
            <Camera className="w-4 h-4" />{real ? 'Cambiar la foto' : 'Poner foto real'}
          </button>
          {real && (
            <button onClick={quitar} disabled={!!ocupado} className={`${boton} text-slate-500 hover:bg-slate-100`}>
              <Trash2 className="w-4 h-4" />Quitar
            </button>
          )}
        </div>
        {/* En el móvil deja elegir entre hacer la foto con la cámara o cogerla de la galería. */}
        <input ref={selector} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; poner(f); }} />
      </div>
    </div>
  );
}
