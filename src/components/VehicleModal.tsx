import React, { useState } from 'react';
import { X, Trash2, UploadCloud, FileText, Download, Loader2, ArchiveX, Undo2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, deleteDoc, deleteField, doc as firestoreDoc, updateDoc, getDocs } from 'firebase/firestore';
import { Vehicle, VehicleDocument } from '../types';
import { getAlertStatus } from '../utils';
import { AVISO_CUOTA, CATEGORIAS, Categoria, categoriaDe, esCuotaAgotada, estadoDocumentacion, MAX_BYTES, TIPOS_ARCHIVO } from '../documentos';
import { abrirDocumento, borrarDocumento, subirDocumento, tipoDe } from '../lib/documentosApi';

interface VehicleModalProps {
  selectedVehicle: Vehicle;
  setSelectedVehicle: (vehicle: Vehicle | null) => void;
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
  vehicleDocuments: VehicleDocument[];
}

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const VehicleModal = ({ 
  selectedVehicle, 
  setSelectedVehicle, 
  isEditing, 
  setIsEditing, 
  vehicleDocuments 
}: VehicleModalProps) => {
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  // Qué papeles exige este vehículo y cuáles tiene (25/11/2026: «tener la documentación al día»).
  const estadoDocs = estadoDocumentacion(selectedVehicle, vehicleDocuments);
  // Tipo de lo que se va a subir: por defecto, el primer papel que le falta.
  const [categoriaSubida, setCategoriaSubida] = useState<Categoria>(() => estadoDocs.faltan[0] || 'Otro');

  const avisarError = (que: string, error: any) =>
    alert(esCuotaAgotada(error) ? AVISO_CUOTA : `${que}: ${error?.message || error}`);

  const handleDownload = async (docItem: VehicleDocument) => {
    // Nuevos (desde el 25/11/2026): el archivo está en Google Cloud Storage y el servidor da un enlace temporal.
    // La pestaña se abre YA (con el clic), si no el navegador la bloquea al llegar el enlace.
    if (docItem.storagePath) {
      const ventana = window.open('', '_blank');
      ventana?.document.write('<p style="font-family:sans-serif;padding:2rem">Abriendo documento…</p>');
      try {
        setDownloadingDocId(docItem.id);
        await abrirDocumento(docItem.id, ventana);
      } catch (error) {
        ventana?.close();
        avisarError('No se pudo abrir el documento', error);
      } finally {
        setDownloadingDocId(null);
      }
      return;
    }
    // Viejos: el archivo está troceado dentro de Firestore (hasta que se migren todos).
    // Backward compatibility for previously uploaded non-chunked docs with url
    if (!docItem.isChunked && docItem.url) {
      const link = document.createElement('a');
      link.href = docItem.url;
      link.download = docItem.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    try {
      setDownloadingDocId(docItem.id);
      const chunksRef = collection(db, `documents/${docItem.id}/chunks`);
      const querySnapshot = await getDocs(chunksRef);
      
      if (querySnapshot.empty) {
        if (docItem.url) {
          const link = document.createElement('a');
          link.href = docItem.url;
          link.download = docItem.name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        }
        throw new Error("No se encontraron partes del documento.");
      }

      const chunks: { index: number; data: string }[] = [];
      querySnapshot.forEach((chunkDoc) => {
        chunks.push(chunkDoc.data() as { index: number; data: string });
      });
      chunks.sort((a, b) => a.index - b.index);

      let fullBase64 = '';
      for (let i = 0; i < chunks.length; i++) {
        fullBase64 += chunks[i].data;
      }

      const link = document.createElement('a');
      link.href = fullBase64;
      link.download = docItem.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Error al descargar archivo:", error);
      alert("No se pudo descargar el archivo.");
    } finally {
      setDownloadingDocId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 w-full max-w-2xl shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-900">{selectedVehicle.matricula}</h3>
            <p className="text-slate-500 font-medium">{selectedVehicle.marca}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* «Sacar de la flota» en vez de borrar: se puede deshacer, conserva sus documentos y una pestaña
                con la web vieja no lo vuelve a crear. Borrar del todo solo se puede una vez fuera de la flota. */}
            {!selectedVehicle.baja ? (
              <button
                onClick={async () => {
                  if (!selectedVehicle.id) return;
                  const motivo = window.prompt(
                    `¿Sacar ${selectedVehicle.matricula} de la flota? Dejará de salir en las alertas, el correo y Telegram, ` +
                    'pero se queda guardado en «Vehículos → Fuera de la flota» y se puede devolver.\n\nMotivo:',
                    'No está en el GPS'
                  );
                  if (motivo === null) return;
                  try {
                    await updateDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id), {
                      baja: true,
                      bajaMotivo: motivo.trim() || 'Fuera de la flota',
                      bajaFecha: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    });
                    setSelectedVehicle(null);
                    setIsEditing(false);
                  } catch (err: any) {
                    alert('No se pudo sacar de la flota: ' + (err?.message || err));
                  }
                }}
                className="px-4 py-2 rounded-lg font-bold text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors flex items-center gap-2"
              >
                <ArchiveX className="w-4 h-4" />
                Sacar de la flota
              </button>
            ) : (
              <>
                <button
                  onClick={async () => {
                    if (!selectedVehicle.id) return;
                    try {
                      await updateDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id), {
                        baja: deleteField(), bajaMotivo: deleteField(), bajaFecha: deleteField(),
                      });
                    } catch (err: any) {
                      alert('No se pudo devolver a la flota: ' + (err?.message || err));
                    }
                  }}
                  className="px-4 py-2 rounded-lg font-bold text-sm bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-2"
                >
                  <Undo2 className="w-4 h-4" />
                  Volver a la flota
                </button>
                <button
                  onClick={async () => {
                    if (window.confirm(`¿Borrar ${selectedVehicle.matricula} PARA SIEMPRE? Esto no se puede deshacer. Sus documentos no se borran.`)) {
                      if (selectedVehicle.id) {
                        await deleteDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id));
                        setSelectedVehicle(null);
                        setIsEditing(false);
                      }
                    }
                  }}
                  title="Borrar para siempre"
                  className="p-2 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button 
              onClick={() => setIsEditing(!isEditing)} 
              className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
                isEditing ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}
            >
              {isEditing ? 'Cancelar' : 'Editar Información'}
            </button>
            <button onClick={() => { setSelectedVehicle(null); setIsEditing(false); }} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {selectedVehicle.baja && (
          <div className="mb-6 p-3 rounded-xl bg-slate-100 border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
            <ArchiveX className="w-4 h-4 shrink-0" />
            <span>
              <b>Fuera de la flota</b>: {selectedVehicle.bajaMotivo || 'sin motivo'}{selectedVehicle.bajaFecha ? ` (desde ${selectedVehicle.bajaFecha})` : ''}.
              No sale en las alertas, ni en el correo, ni en Telegram.
            </span>
          </div>
        )}

        {!isEditing && (
          <div className="space-y-4 mb-6">
            {/* The active alerts and missing fields summary boxes were removed as per user request */}
          </div>
        )}

        {isEditing ? (
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const updates = {
              tipo: formData.get('tipo') as string,
              tipoCaja: formData.get('tipoCaja') as string,
              capacidad: formData.get('capacidad') as string,
              bastidor: formData.get('bastidor') as string,
              fechaMatriculacion: formData.get('fechaMatriculacion') as string,
              chofer: formData.get('chofer') as string,
              proximaITV: formData.get('proximaITV') as string,
              vencimientoATP: formData.get('vencimientoATP') as string,
              revisionTacografo: formData.get('revisionTacografo') as string,
              aseguradora: formData.get('aseguradora') as string,
              poliza: formData.get('poliza') as string,
              priority: formData.get('priority') as 'low' | 'medium' | 'high',
            };
            if (selectedVehicle.id) {
              await updateDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id), updates);
              setSelectedVehicle({ ...selectedVehicle, ...updates });
              setIsEditing(false);
            }
          }} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información General</h4>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label><input name="tipo" defaultValue={selectedVehicle.tipo} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo Caja</label><input name="tipoCaja" defaultValue={selectedVehicle.tipoCaja} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacidad</label><input name="capacidad" defaultValue={selectedVehicle.capacidad} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nº Bastidor</label><input name="bastidor" defaultValue={selectedVehicle.bastidor} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">F. Matriculación</label><input name="fechaMatriculacion" defaultValue={selectedVehicle.fechaMatriculacion} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chofer</label><input name="chofer" defaultValue={selectedVehicle.chofer} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prioridad de Alertas</label>
                  <select name="priority" defaultValue={selectedVehicle.priority || 'medium'} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white text-sm">
                    <option value="low">Baja (15 días)</option>
                    <option value="medium">Media (30 días)</option>
                    <option value="high">Alta (60 días)</option>
                  </select>
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Legal y Vencimientos</h4>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Próxima ITV</label><input name="proximaITV" defaultValue={selectedVehicle.proximaITV} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vencimiento ATP</label><input name="vencimientoATP" defaultValue={selectedVehicle.vencimientoATP} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Revisión Tacógrafo</label><input name="revisionTacografo" defaultValue={selectedVehicle.revisionTacografo} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Aseguradora</label><input name="aseguradora" defaultValue={selectedVehicle.aseguradora} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nº Póliza</label><input name="poliza" defaultValue={selectedVehicle.poliza} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" /></div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-slate-100">
              <button type="button" onClick={() => setIsEditing(false)} className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-600 hover:bg-slate-100 transition-colors">Cancelar</button>
              <button type="submit" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-blue-700 transition-colors">Guardar Cambios</button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información General</h4>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo</p><p className="font-medium text-sm">{selectedVehicle.tipo || 'N/A'}</p></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo Caja</p><p className="font-medium text-sm">{selectedVehicle.tipoCaja || 'N/A'}</p></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Capacidad</p><p className="font-medium text-sm">{selectedVehicle.capacidad || 'N/A'}</p></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nº Bastidor</p><p className="font-medium text-sm text-slate-600 break-all">{selectedVehicle.bastidor || 'N/A'}</p></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">F. Matriculación</p><p className="font-medium text-sm">{selectedVehicle.fechaMatriculacion || 'N/A'}</p></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chofer</p><p className="font-medium text-sm">{selectedVehicle.chofer || 'N/A'}</p></div>
                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Prioridad</p><p className="font-bold text-sm text-blue-600 uppercase">{selectedVehicle.priority || 'medium'}</p></div>
              </div>
            </div>
            <div className="space-y-4">
              <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Legal y Vencimientos</h4>
              <div className="grid grid-cols-1 gap-3">
                {[
                  { label: 'Próxima ITV', value: selectedVehicle.proximaITV },
                  { label: 'Vencimiento ATP', value: selectedVehicle.vencimientoATP },
                  { label: 'Revisión Tacógrafo', value: selectedVehicle.revisionTacografo }
                ].map((row, i) => {
                  const st = row.value ? getAlertStatus(row.value, selectedVehicle.priority || 'medium') : null;
                  return (
                    <div key={i} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{row.label}</p>
                        <p className="font-bold text-sm text-slate-700">{row.value || 'N/A'}</p>
                      </div>
                      {st && st.status !== 'unknown' && (
                        <span className={`text-[9px] px-2 py-1 rounded font-black ${
                          st.status === 'danger' ? 'bg-red-100 text-red-600' :
                          st.status === 'warning' ? 'bg-amber-100 text-amber-600' :
                          'bg-emerald-100 text-emerald-600'
                        }`}>
                          {st.text}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-between items-center p-2"><span className="text-sm font-medium text-slate-600">Aseguradora</span><span className="font-bold text-sm text-slate-700">{selectedVehicle.aseguradora || 'N/A'}</span></div>
                <div className="flex justify-between items-center p-2 border-t border-slate-50"><span className="text-sm font-medium text-slate-600">Nº Póliza</span><span className="font-bold text-sm text-slate-700">{selectedVehicle.poliza || 'N/A'}</span></div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 border-t border-slate-100 pt-6">
          <div className="flex justify-between items-start mb-4 gap-3 flex-wrap">
             <div>
               <h4 className="font-bold text-slate-800">Documentación</h4>
               <p className="text-xs text-slate-400">
                 {estadoDocs.faltan.length === 0
                   ? `Completa: tiene los ${estadoDocs.total} papeles que se le piden.`
                   : `Tiene ${estadoDocs.completos} de ${estadoDocs.total} papeles. Falta: ${estadoDocs.faltan.join(', ')}.`}
               </p>
             </div>
             <div className="flex items-center gap-2">
               {/* Tipo de lo que se sube (se puede cambiar luego en cada documento) */}
               <select
                 value={categoriaSubida}
                 onChange={(e) => setCategoriaSubida(e.target.value as Categoria)}
                 disabled={uploading}
                 title="¿Qué documento vas a subir?"
                 className="border border-slate-200 rounded-xl px-2 py-2 text-xs font-semibold text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
               >
                 {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
               </select>
               <label className={`bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-xs cursor-pointer transition-all shadow-md shadow-blue-200 flex items-center gap-2 ${uploading ? 'opacity-60 pointer-events-none' : 'hover:bg-blue-700 active:scale-95'}`}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {uploading ? 'Subiendo...' : 'Subir Archivo'}
                  <input
                    type="file"
                    multiple
                    accept=".pdf,image/*,application/pdf"
                    className="hidden"
                    disabled={uploading}
                    onChange={async (e) => {
                      if (!selectedVehicle?.id || !e.target.files || e.target.files.length === 0) return;
                      const files = Array.from(e.target.files);
                      setUploading(true);
                      // 25/11/2026: el archivo va directo a Google Cloud Storage con un enlace temporal del servidor;
                      // en Firestore solo queda su ficha (antes iba troceado en la base y la dejó sin cuota).
                      for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const cuenta = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
                        if (file.size > MAX_BYTES) {
                          alert(`«${file.name}» pesa más de 25 MB. Súbelo más reducido.`);
                          continue;
                        }
                        if (!TIPOS_ARCHIVO.includes(tipoDe(file))) {
                          alert(`«${file.name}» no es un PDF ni una foto: no se sube.`);
                          continue;
                        }
                        try {
                          setUploadStatus(`Subiendo${cuenta}: ${file.name} (${formatFileSize(file.size)})… 0%`);
                          await subirDocumento(selectedVehicle.id, file, categoriaSubida,
                            (pct) => setUploadStatus(`Subiendo${cuenta}: ${file.name} (${formatFileSize(file.size)})… ${pct}%`));
                        } catch (error) {
                          console.error('Error al subir archivo:', error);
                          avisarError(`No se pudo subir «${file.name}»`, error);
                        }
                      }
                      setUploading(false);
                      setUploadStatus(null);
                      e.target.value = '';
                    }}
                  />
               </label>
             </div>
          </div>

          {/* Papeles que se le piden a este vehículo: ✔ si hay al menos un documento de ese tipo */}
          <div className="flex flex-wrap gap-2 mb-4">
            {estadoDocs.exigidos.map(ex => (
              <span key={ex.categoria} className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${ex.docs.length ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                {ex.docs.length ? '✔' : '✗'} {ex.categoria}
              </span>
            ))}
          </div>

          {uploadStatus && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-center gap-2 text-xs text-blue-800 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>{uploadStatus}</span>
            </div>
          )}

          <div className="space-y-2">
            {vehicleDocuments.length === 0 ? (
               <div className="bg-slate-50 border border-slate-100 border-dashed rounded-xl p-6 text-center">
                 <p className="text-sm text-slate-500 font-medium">No hay documentos adjuntos para este vehículo.</p>
               </div>
            ) : (
               vehicleDocuments.map(doc => (
                 <div key={doc.id} className="flex justify-between items-center gap-2 p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0"><FileText className="w-5 h-5" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-700 break-words">{doc.name}</p>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider flex items-center gap-2 flex-wrap">
                          <span>{doc.uploadedAt ? new Date(doc.uploadedAt.toDate()).toLocaleDateString('es-ES') : 'Subiendo...'}</span>
                          {doc.size ? <span>• {formatFileSize(doc.size)}</span> : null}
                          {doc.subidoPor ? <span className="normal-case tracking-normal">• {doc.subidoPor}</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Tipo del documento: si no lo tenía, se deduce del nombre; cambiarlo lo guarda */}
                      <select
                        value={categoriaDe(doc)}
                        onChange={async (e) => {
                          try {
                            await updateDoc(firestoreDoc(db, 'documents', doc.id), { categoria: e.target.value });
                          } catch (error) {
                            avisarError('No se pudo cambiar el tipo', error);
                          }
                        }}
                        title="Tipo de documento"
                        className={`border rounded-lg px-1.5 py-1 text-[11px] font-semibold bg-white outline-none focus:ring-2 focus:ring-blue-500 ${doc.categoria ? 'border-slate-200 text-slate-600' : 'border-dashed border-amber-300 text-amber-700'}`}
                      >
                        {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingDocId === doc.id}
                        title="Abrir documento"
                        className="p-2 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-slate-500 transition-colors disabled:opacity-50"
                      >
                        {downloadingDocId === doc.id ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> : <Download className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`¿Eliminar el documento "${doc.name}"?`)) return;
                          try {
                            // Lo borra el servidor: el archivo del almacén, sus trozos viejos (sin leerlos) y la ficha.
                            await borrarDocumento(doc.id);
                          } catch (error) {
                            console.error('Error al eliminar documento:', error);
                            avisarError('No se pudo eliminar el documento', error);
                          }
                        }}
                        title="Eliminar documento"
                        className="p-2 hover:bg-red-50 rounded-lg text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                 </div>
               ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
