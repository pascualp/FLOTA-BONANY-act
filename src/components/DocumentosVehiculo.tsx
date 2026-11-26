import { useRef, useState } from 'react';
import { doc as firestoreDoc, updateDoc } from 'firebase/firestore';
import { Download, FileText, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { db } from '../lib/firebase';
import type { Vehicle, VehicleDocument } from '../types';
import { AVISO_CUOTA, CATEGORIAS, type Categoria, categoriaDe, esCuotaAgotada, estadoDocumentacion, MAX_BYTES, TIPOS_ARCHIVO } from '../documentos';
import { papelesCaducados } from '../utils';
import { abrirDocumento, borrarDocumento, subirDocumento, tipoDe } from '../lib/documentosApi';

// Documentación de un vehículo: qué papeles se le piden (✔ lo tiene y está en vigor, ⚠ lo tiene pero la fecha ya pasó,
// ✗ no lo tiene), subir (al almacén de archivos, nunca a la base), abrir, cambiar el tipo y borrar.

export const formatoTamano = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const avisarError = (que: string, error: any) => alert(esCuotaAgotada(error) ? AVISO_CUOTA : `${que}: ${error?.message || error}`);

export const DocumentosVehiculo = ({ vehiculo, documentos }: { vehiculo: Vehicle; documentos: VehicleDocument[] }) => {
  const estado = estadoDocumentacion(vehiculo, documentos);
  // Papeles que TIENE pero cuya fecha ya pasó (si no lo tiene, ya sale como que falta).
  const caducados = papelesCaducados(vehiculo).filter((c) => estado.exigidos.some((x) => x.categoria === c && x.docs.length));
  const [categoriaSubida, setCategoriaSubida] = useState<Categoria>(() => estado.faltan[0] || 'Otro');
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);   // el botón «Subir» de cada papel que falta abre este selector

  const abrir = async (d: VehicleDocument) => {
    if (d.storagePath) {
      // La pestaña se abre YA (con el clic); si se abre cuando llega el enlace, el navegador la bloquea.
      const ventana = window.open('', '_blank');
      ventana?.document.write('<p style="font-family:sans-serif;padding:2rem">Abriendo documento…</p>');
      try {
        setAbriendo(d.id);
        await abrirDocumento(d.id, ventana);
      } catch (error) {
        ventana?.close();
        avisarError('No se pudo abrir el documento', error);
      } finally {
        setAbriendo(null);
      }
      return;
    }
    // Muy viejos, con el archivo entero en «url»: se descarga sin leer nada más de la base.
    if (d.url) {
      const a = document.createElement('a');
      a.href = d.url; a.download = d.name;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    // Viejos troceados en la base: NO se leen sus trozos desde aquí (un PDF de 5 MB son ~1.250 lecturas: así se agotó
    // la cuota el 25/11). Se pasan al almacén con scripts/migrar-docs-viejos.cjs.
    alert('Este documento es de los antiguos y todavía no se ha pasado al almacén nuevo. Vuelve a intentarlo más tarde.');
  };

  const subir = async (files: File[]) => {
    if (!vehiculo.id || !files.length) return;
    setSubiendo(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const cuenta = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
      if (file.size > MAX_BYTES) { alert(`«${file.name}» pesa más de 25 MB. Súbelo más reducido.`); continue; }
      if (!TIPOS_ARCHIVO.includes(tipoDe(file))) { alert(`«${file.name}» no es un PDF ni una foto: no se sube.`); continue; }
      try {
        setProgreso(`Subiendo${cuenta}: ${file.name} (${formatoTamano(file.size)})… 0%`);
        await subirDocumento(vehiculo.id, file, categoriaSubida,
          (pct) => setProgreso(`Subiendo${cuenta}: ${file.name} (${formatoTamano(file.size)})… ${pct}%`));
      } catch (error) {
        console.error('Error al subir archivo:', error);
        avisarError(`No se pudo subir «${file.name}»`, error);
      }
    }
    setSubiendo(false);
    setProgreso(null);
  };

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <div className="flex justify-between items-start mb-4 gap-3 flex-wrap">
        <div>
          <h4 className="font-bold text-slate-800">Documentación</h4>
          <p className="text-xs text-slate-400">
            {estado.faltan.length === 0
              ? `Tiene los ${estado.total} papeles que se le piden.`
              : `Tiene ${estado.completos} de ${estado.total} papeles. Falta: ${estado.faltan.join(', ')}.`}
            {caducados.length > 0 && <span className="text-amber-700"> Vencido: {caducados.join(', ')} (hay que subir el papel nuevo y cambiar la fecha).</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={categoriaSubida} onChange={(e) => setCategoriaSubida(e.target.value as Categoria)} disabled={subiendo}
            title="¿Qué documento vas a subir?"
            className="border border-slate-200 rounded-xl px-2 py-2 text-xs font-semibold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className={`bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-xs cursor-pointer shadow-md shadow-blue-200 flex items-center gap-2 ${subiendo ? 'opacity-60 pointer-events-none' : 'hover:bg-blue-700 active:scale-95'}`}>
            {subiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {subiendo ? 'Subiendo…' : 'Subir archivo o foto'}
            {/* En el móvil ofrece hacer la foto con la cámara directamente. */}
            <input ref={archivoRef} type="file" multiple accept=".pdf,image/*,application/pdf" className="hidden" disabled={subiendo}
              onChange={async (e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; await subir(fs); }} />
          </label>
        </div>
      </div>

      {/* Qué papeles tiene que tener y cómo está cada uno, dicho con palabras (26/11/2026, Facu: «la ✗ confunde un
          poco; que no confunda a una persona que lo ve por primera vez»). Lo que falta lleva su botón «Subir». */}
      <div className="mb-4 rounded-2xl border border-slate-100 overflow-hidden">
        <p className="px-3 py-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50">Papeles que tiene que tener este vehículo</p>
        <ul className="divide-y divide-slate-100">
          {estado.exigidos.map((ex) => {
            const falta = !ex.docs.length;
            const vencido = !falta && caducados.includes(ex.categoria);
            return (
              <li key={ex.categoria} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${falta ? 'bg-red-500' : vencido ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  {ex.categoria}
                </span>
                {falta ? (
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-red-600">Falta</span>
                    <button type="button" disabled={subiendo}
                      onClick={() => { setCategoriaSubida(ex.categoria); archivoRef.current?.click(); }}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1 disabled:opacity-50">
                      <UploadCloud className="w-3.5 h-3.5" />Subir
                    </button>
                  </span>
                ) : vencido ? (
                  <span className="text-xs font-bold text-amber-700 text-right">Subido, pero la fecha ya pasó</span>
                ) : (
                  <span className="text-xs font-bold text-emerald-700 shrink-0">✓ Subido</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {progreso && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-center gap-2 text-xs text-blue-800 font-semibold">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" /><span>{progreso}</span>
        </div>
      )}

      <div className="space-y-2">
        {documentos.length === 0 ? (
          <div className="bg-slate-50 border border-slate-100 border-dashed rounded-xl p-6 text-center">
            <p className="text-sm text-slate-500 font-medium">No hay documentos de este vehículo.</p>
          </div>
        ) : documentos.map((d) => (
          <div key={d.id} className="flex justify-between items-center gap-2 p-3 border border-slate-100 rounded-xl hover:bg-slate-50 flex-wrap">
            <div className="flex items-center gap-3 min-w-[200px] flex-1">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0"><FileText className="w-5 h-5" /></div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700 break-words">{d.name}</p>
                <p className="text-[10px] text-slate-400 font-medium flex items-center gap-2 flex-wrap">
                  {/* toDate?.(): si la fecha no viene como fecha de la base (copia de prueba, caché vieja) no se rompe la ficha. */}
                  <span>{d.uploadedAt ? new Date((d.uploadedAt as any).toDate?.() ?? (d.uploadedAt as any)).toLocaleDateString('es-ES') : 'Subiendo…'}</span>
                  {d.size ? <span>• {formatoTamano(d.size)}</span> : null}
                  {d.subidoPor ? <span>• {d.subidoPor}</span> : null}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select value={categoriaDe(d)} title="Tipo de documento"
                onChange={async (e) => {
                  try { await updateDoc(firestoreDoc(db, 'documents', d.id), { categoria: e.target.value }); }
                  catch (error) { avisarError('No se pudo cambiar el tipo', error); }
                }}
                className={`border rounded-lg px-1.5 py-1 text-[11px] font-semibold bg-white outline-none focus:ring-2 focus:ring-blue-500 ${d.categoria ? 'border-slate-200 text-slate-600' : 'border-dashed border-amber-300 text-amber-700'}`}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => abrir(d)} disabled={abriendo === d.id} title="Abrir documento"
                className="p-2 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-slate-500 disabled:opacity-50">
                {abriendo === d.id ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> : <Download className="w-4 h-4" />}
              </button>
              <button title="Eliminar documento" className="p-2 hover:bg-red-50 rounded-lg text-red-400"
                onClick={async () => {
                  if (!window.confirm(`¿Eliminar el documento «${d.name}»?`)) return;
                  try { await borrarDocumento(d.id); }   // lo borra el servidor: trozos viejos, ficha y archivo del almacén
                  catch (error) { avisarError('No se pudo eliminar el documento', error); }
                }}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
