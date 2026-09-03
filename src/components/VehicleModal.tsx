import React, { useState } from 'react';
import { X, Trash2, AlertTriangle, UploadCloud, FileText, Download, Loader2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, deleteDoc, doc as firestoreDoc, updateDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { Vehicle, VehicleDocument } from '../types';
import { getAlertStatus, getMissingFields, getVehicleAlerts } from '../utils';

interface VehicleModalProps {
  selectedVehicle: Vehicle;
  setSelectedVehicle: (vehicle: Vehicle | null) => void;
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
  vehicleDocuments: VehicleDocument[];
}

export const VehicleModal = ({ 
  selectedVehicle, 
  setSelectedVehicle, 
  isEditing, 
  setIsEditing, 
  vehicleDocuments 
}: VehicleModalProps) => {
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);

  const handleDownload = async (doc: VehicleDocument) => {
    if (!doc.isChunked) {
      const link = document.createElement('a');
      link.href = doc.url;
      link.download = doc.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    try {
      setDownloadingDocId(doc.id);
      const chunksRef = collection(db, `documents/${doc.id}/chunks`);
      const q = query(chunksRef, orderBy('index'));
      const querySnapshot = await getDocs(q);
      
      let fullBase64 = '';
      querySnapshot.forEach((chunkDoc) => {
        fullBase64 += chunkDoc.data().data;
      });

      const link = document.createElement('a');
      link.href = fullBase64;
      link.download = doc.name;
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
             <h4 className="font-bold text-slate-800">Documentación Adjunta</h4>
             <label className={`bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-xs cursor-pointer transition-colors flex items-center gap-2 ${uploading ? 'opacity-50 pointer-events-none' : 'hover:bg-blue-100'}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {uploading ? 'Subiendo...' : 'Subir Archivo'}
                <input type="file" multiple className="hidden" disabled={uploading} onChange={async (e) => {
                  if (e.target.files && e.target.files.length > 0) {
                     setUploading(true);
                     const files = Array.from(e.target.files);
                     for (const file of files) {
                       try {
                         const reader = new FileReader();
                         const fileData = await new Promise<string>((resolve, reject) => {
                           reader.onload = (e) => resolve(e.target?.result as string);
                           reader.onerror = reject;
                           reader.readAsDataURL(file);
                         });

                         const MAX_CHUNK_SIZE = 700 * 1024;
                         const totalChunks = Math.ceil(fileData.length / MAX_CHUNK_SIZE);
                         const isChunked = totalChunks > 1;

                         const docRef = await addDoc(collection(db, 'documents'), {
                           vehicleId: selectedVehicle.id,
                           name: file.name,
                           type: file.type || 'application/octet-stream',
                           url: isChunked ? '' : fileData,
                           isChunked,
                           totalChunks,
                           uploadedAt: serverTimestamp()
                         });

                         if (isChunked) {
                           for (let i = 0; i < totalChunks; i++) {
                             const chunk = fileData.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
                             await addDoc(collection(db, `documents/${docRef.id}/chunks`), {
                               index: i,
                               data: chunk
                             });
                           }
                         }
                       } catch (error) {
                         console.error("Error al subir archivo:", error);
                         alert("Error al subir el archivo: " + file.name);
                       }
                     }
                     setUploading(false);
                  }
                }} />
             </label>
          </div>
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
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                          {doc.uploadedAt ? new Date(doc.uploadedAt.toDate()).toLocaleDateString() : 'Subiendo...'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleDownload(doc)}
                        disabled={downloadingDocId === doc.id}
                        className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors disabled:opacity-50"
                      >
                        {downloadingDocId === doc.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </button>
                      <button 
                        onClick={async () => {
                          if (window.confirm('¿Eliminar este documento?')) {
                            if (doc.isChunked) {
                              const chunksRef = collection(db, `documents/${doc.id}/chunks`);
                              const snapshot = await getDocs(chunksRef);
                              for (const chunkDoc of snapshot.docs) {
                                await deleteDoc(chunkDoc.ref);
                              }
                            }
                            await deleteDoc(firestoreDoc(db, 'documents', doc.id));
                          }
                        }}
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
