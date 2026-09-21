import React, { useState } from 'react';
import { X, Trash2, UploadCloud, FileText, Download, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, deleteDoc, doc as firestoreDoc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Vehicle, VehicleDocument } from '../types';
import { getAlertStatus } from '../utils';

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

  const handleDownload = async (docItem: VehicleDocument) => {
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
            <button 
              onClick={async () => {
                if (window.confirm('¿Estás seguro de que deseas eliminar este vehículo? Esta acción no se puede deshacer.')) {
                  if (selectedVehicle.id) {
                    await deleteDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id));
                    setSelectedVehicle(null);
                    setIsEditing(false);
                  }
                }
              }}
              className="px-4 py-2 rounded-lg font-bold text-sm bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar
            </button>
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
          <div className="flex justify-between items-center mb-4">
             <div>
               <h4 className="font-bold text-slate-800">Documentación Adjunta</h4>
               <p className="text-xs text-slate-400">PDFs, ITV, ficha técnica y pólizas del vehículo</p>
             </div>
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
                    if (!selectedVehicle?.id) return;
                    if (e.target.files && e.target.files.length > 0) {
                       setUploading(true);
                       const files = Array.from(e.target.files);

                       for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
                         const file = files[fileIdx];
                         
                         // Limit to 25MB for safety
                         if (file.size > 25 * 1024 * 1024) {
                           alert(`El archivo "${file.name}" supera los 25 MB. Por favor sube una versión más reducida.`);
                           continue;
                         }

                         setUploadStatus(
                           files.length > 1
                             ? `Leyendo (${fileIdx + 1}/${files.length}): ${file.name}...`
                             : `Procesando: ${file.name} (${formatFileSize(file.size)})...`
                         );

                         try {
                           const reader = new FileReader();
                           const fileData = await new Promise<string>((resolve, reject) => {
                             reader.onload = (ev) => resolve(ev.target?.result as string);
                             reader.onerror = reject;
                             reader.readAsDataURL(file);
                           });

                           // 600KB base64 chunk size (~450KB binary)
                           const CHUNK_SIZE = 600 * 1024;
                           const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);

                           setUploadStatus(
                             files.length > 1
                               ? `Guardando (${fileIdx + 1}/${files.length}): ${file.name}...`
                               : `Subiendo a la nube: ${file.name} (${formatFileSize(file.size)})...`
                           );

                           // Save lightweight metadata in parent collection
                           const docRef = await addDoc(collection(db, 'documents'), {
                             vehicleId: selectedVehicle.id,
                             name: file.name,
                             type: file.type || 'application/pdf',
                             size: file.size,
                             url: '',
                             isChunked: true,
                             totalChunks,
                             uploadedAt: serverTimestamp()
                           });

                           // Parallel batch commits: 4 chunks per batch (~2.4MB per batch)
                           const BATCH_SIZE = 4;
                           const batchPromises: Promise<void>[] = [];

                           for (let b = 0; b < totalChunks; b += BATCH_SIZE) {
                             const batch = writeBatch(db);
                             const end = Math.min(b + BATCH_SIZE, totalChunks);
                             for (let i = b; i < end; i++) {
                               const chunk = fileData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                               const chunkDocRef = firestoreDoc(collection(db, `documents/${docRef.id}/chunks`));
                               batch.set(chunkDocRef, {
                                 index: i,
                                 data: chunk
                               });
                             }
                             batchPromises.push(batch.commit());
                           }

                           // Execute all batches concurrently in parallel
                           await Promise.all(batchPromises);

                         } catch (error) {
                           console.error("Error al subir archivo:", error);
                           alert("Error al subir el archivo: " + file.name);
                         }
                       }

                       setUploading(false);
                       setUploadStatus(null);
                       e.target.value = '';
                    }
                  }} 
                />
             </label>
          </div>

          {uploadStatus && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between text-xs text-blue-800 font-semibold animate-pulse">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>{uploadStatus}</span>
              </div>
              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Optimizando subida</span>
            </div>
          )}

          <div className="space-y-2">
            {vehicleDocuments.length === 0 ? (
               <div className="bg-slate-50 border border-slate-100 border-dashed rounded-xl p-6 text-center">
                 <p className="text-sm text-slate-500 font-medium">No hay documentos adjuntos para este vehículo.</p>
               </div>
            ) : (
               vehicleDocuments.map(doc => (
                 <div key={doc.id} className="flex justify-between items-center p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><FileText className="w-5 h-5" /></div>
                      <div>
                        <p className="text-sm font-bold text-slate-700">{doc.name}</p>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider flex items-center gap-2">
                          <span>{doc.uploadedAt ? new Date(doc.uploadedAt.toDate()).toLocaleDateString() : 'Subiendo...'}</span>
                          {doc.size ? <span>• {formatFileSize(doc.size)}</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingDocId === doc.id}
                        title="Descargar documento"
                        className="p-2 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-slate-500 transition-colors disabled:opacity-50"
                      >
                        {downloadingDocId === doc.id ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> : <Download className="w-4 h-4" />}
                      </button>
                      <button 
                        onClick={async () => {
                          if (window.confirm(`¿Eliminar el documento "${doc.name}"?`)) {
                            try {
                              if (doc.isChunked) {
                                const chunksRef = collection(db, `documents/${doc.id}/chunks`);
                                const snapshot = await getDocs(chunksRef);
                                if (!snapshot.empty) {
                                  const batch = writeBatch(db);
                                  snapshot.docs.forEach(chunkDoc => {
                                    batch.delete(chunkDoc.ref);
                                  });
                                  await batch.commit();
                                }
                              }
                              await deleteDoc(firestoreDoc(db, 'documents', doc.id));
                            } catch (err) {
                              console.error("Error al eliminar documento:", err);
                              alert("Error al eliminar el documento.");
                            }
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
