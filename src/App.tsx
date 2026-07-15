/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  Car,
  FileText,
  AlertCircle,
  LayoutDashboard,
  Plus,
  UploadCloud,
  CheckCircle2,
  FileSearch,
  Check,
  AlertTriangle,
  Clock,
  X,
  Trash2,
  Download
} from 'lucide-react';
import { db } from './lib/firebase';
import { collection, getDocs, addDoc, onSnapshot, query, serverTimestamp, where, deleteDoc, doc as firestoreDoc, updateDoc } from 'firebase/firestore';
import { seedData } from './lib/seedData';
import { parse, isAfter, isBefore, addDays, isValid, format } from 'date-fns';

export default function App() {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [vehicleDocuments, setVehicleDocuments] = useState<any[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'vehicles'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const existingData = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      const existingMatriculas = existingData.map((d: any) => d.matricula);
      
      const missing = seedData.filter(v => !existingMatriculas.includes(v.matricula));
      if (missing.length > 0) {
        console.log(`Seeding ${missing.length} missing vehicles...`);
        for (const v of missing) {
          await addDoc(collection(db, 'vehicles'), {
            ...v,
            createdAt: serverTimestamp()
          });
        }
      }
      
      // We don't necessarily want to set missing data immediately because the onSnapshot will fire again
      // when the addDocs complete.
      setVehicles(existingData);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedVehicle) {
      setVehicleDocuments([]);
      return;
    }
    const q = query(collection(db, 'documents'), where('vehicleId', '==', selectedVehicle.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      // Sort in memory since we don't have indexes guaranteed
      data.sort((a: any, b: any) => {
        if (!a.uploadedAt) return -1;
        if (!b.uploadedAt) return 1;
        return b.uploadedAt.toMillis() - a.uploadedAt.toMillis();
      });
      setVehicleDocuments(data);
    });
    return () => unsubscribe();
  }, [selectedVehicle]);

  const parseEsDate = (dateStr: any) => {
    if (!dateStr || typeof dateStr !== 'string' || dateStr.toLowerCase().includes('no')) return null;
    let clean = dateStr.split('(')[0].trim();
    const divider = clean.includes('/') ? '/' : clean.includes('-') ? '-' : null;
    if (divider) {
      const parts = clean.split(divider);
      if (parts.length === 3) {
        if (parts[2].length === 2) parts[2] = '20' + parts[2];
        const parsed = parse(`${parts[0]}/${parts[1]}/${parts[2]}`, 'dd/MM/yyyy', new Date());
        return isValid(parsed) ? parsed : null;
      }
      if (parts.length === 2) {
         const parsed = parse(`01/${parts[0]}/${parts[1].length === 2 ? '20'+parts[1] : parts[1]}`, 'dd/MM/yyyy', new Date());
         return isValid(parsed) ? parsed : null;
      }
    }
    return null;
  };

  const getAlertStatus = (dateStr: string) => {
    const d = parseEsDate(dateStr);
    if (!d) return { status: 'unknown', text: 'Desconocido' };
    const now = new Date();
    if (isBefore(d, now)) return { status: 'danger', text: 'VENCIDO' };
    if (isBefore(d, addDays(now, 30))) return { status: 'warning', text: 'Vence < 30 días' };
    if (isBefore(d, addDays(now, 60))) return { status: 'warning', text: 'Vence < 60 días' };
    return { status: 'success', text: 'Vigente' };
  };

  const getMissingFields = (v: any) => {
    const missing = [];
    if (!v.proximaITV) missing.push('Próxima ITV');
    if (!v.aseguradora) missing.push('Aseguradora');
    if (!v.poliza) missing.push('Póliza');
    if (!v.fechaMatriculacion) missing.push('Fecha Matriculación');
    if (!v.bastidor) missing.push('Nº Bastidor');
    if (!v.tipoCaja && v.tipo !== 'COCHE') missing.push('Tipo de Caja');
    return missing;
  };

  const getAllAlerts = () => {
    const alerts: any[] = [];
    vehicles.forEach(v => {
      if (v.proximaITV) {
        const st = getAlertStatus(v.proximaITV);
        if (st.status === 'warning' || st.status === 'danger') {
          alerts.push({ vehicle: v, type: 'ITV Técnica', date: v.proximaITV, status: st });
        }
      }
      if (v.vencimientoATP) {
        const st = getAlertStatus(v.vencimientoATP);
        if (st.status === 'warning' || st.status === 'danger') {
          alerts.push({ vehicle: v, type: 'Vencimiento ATP', date: v.vencimientoATP, status: st });
        }
      }
      if (v.revisionTacografo) {
        const st = getAlertStatus(v.revisionTacografo);
        if (st.status === 'warning' || st.status === 'danger') {
          alerts.push({ vehicle: v, type: 'Revisión Tacógrafo', date: v.revisionTacografo, status: st });
        }
      }
    });
    return alerts.sort((a, b) => {
      const da = parseEsDate(a.date);
      const db = parseEsDate(b.date);
      if (!da) return 1; if (!db) return -1;
      return da.getTime() - db.getTime();
    });
  };

  const calculateStats = () => {
    let vehiculosCriticos = 0;
    let vehiculosWarning = 0;

    vehicles.forEach(v => {
      let hasCritical = false;
      let hasWarning = false;
      const check = (d: string) => {
         const st = getAlertStatus(d);
         if (st.status === 'danger') hasCritical = true;
         if (st.status === 'warning') hasWarning = true;
      };
      if (v.proximaITV) check(v.proximaITV);
      if (v.vencimientoATP) check(v.vencimientoATP);
      if (v.revisionTacografo) check(v.revisionTacografo);

      if (hasCritical) vehiculosCriticos++;
      else if (hasWarning) vehiculosWarning++;
    });

    return { 
      total: vehicles.length, 
      itvProxMes: vehiculosWarning, // renamed for backward compatibility with UI
      criticas: vehiculosCriticos, 
      operativo: vehicles.length - vehiculosCriticos - vehiculosWarning 
    };
  };

  const stats = calculateStats();

  const renderDashboard = () => (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
      {/* Alerts List (Left/Main) */}
      <div className="col-span-1 lg:col-span-2 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h4 className="font-bold text-slate-800">Vencimientos Próximos</h4>
          <button onClick={() => setActiveTab('alerts')} className="text-xs text-blue-600 font-bold bg-blue-50 px-3 py-1 rounded-full hover:bg-blue-100 transition-colors">
            Ver Todo
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                <th className="px-4 py-3">Vehículo</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Fecha Límite</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {getAllAlerts().slice(0, 8).map((al, idx) => {
                return (
                  <tr 
                    key={idx} 
                    onClick={() => {
                       setActiveTab('vehicles');
                       setSelectedVehicle(al.vehicle);
                    }}
                    className="border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-4">
                      <div className="font-bold">{al.vehicle.marca}</div>
                      <div className="text-xs text-slate-500">{al.vehicle.matricula}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{al.type}</td>
                    <td className="px-4 py-4">{al.date}</td>
                    <td className="px-4 py-4">
                      <span className={`text-[10px] px-2 py-1 rounded font-bold ${
                        al.status.status === 'danger' ? 'bg-red-100 text-red-600' :
                        al.status.status === 'warning' ? 'bg-amber-100 text-amber-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}>
                        {al.status.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {getAllAlerts().length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-slate-500">No hay vencimientos próximos.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side Panels */}
      <div className="space-y-6 flex flex-col shrink-0">
        {/* Rapid Upload Section */}
        <div className="bg-blue-600 rounded-3xl p-6 text-white shadow-lg">
          <h4 className="font-bold mb-4">Subida Rápida</h4>
          <label className="border-2 border-dashed border-blue-400 rounded-2xl p-4 flex flex-col items-center justify-center bg-blue-700/50 cursor-pointer hover:bg-blue-700/70 transition-colors">
            <UploadCloud className="w-8 h-8 mb-2 opacity-80" />
            <p className="text-xs font-medium text-center">
              Suelte documentos aquí
            </p>
            <input type="file" className="hidden" onChange={(e) => {
              if (e.target.files?.length) alert("Funcionalidad de subida lista para integrar con Storage");
            }} />
          </label>
        </div>

        {/* Real-time Maintenance Dashboard */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 flex-1 shadow-sm flex flex-col">
          <h4 className="font-bold text-slate-800 mb-4">Estado Flota</h4>
          <div className="relative h-32 flex items-center justify-center mb-4">
            <div className="w-24 h-24 rounded-full border-[12px] border-slate-100 relative">
              <div
                className="absolute inset-0 rounded-full border-[12px] border-blue-500"
                style={{ clipPath: 'polygon(50% 0%, 100% 0%, 100% 50%, 50% 50%)' }}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center text-xl font-bold">
                {Math.round((stats.operativo / (stats.total || 1)) * 100)}%
              </div>
            </div>
          </div>
          <div className="mt-auto space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Operativo
              </span>
              <span className="font-bold">{stats.operativo}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> Con Alertas
              </span>
              <span className="font-bold">{stats.criticas}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderVehicles = () => {
    const filteredVehicles = vehicles.filter(v => {
      if (!searchQuery) return true;
      const term = searchQuery.toLowerCase();
      return (
        v.matricula?.toLowerCase().includes(term) ||
        v.marca?.toLowerCase().includes(term) ||
        v.bastidor?.toLowerCase().includes(term)
      );
    });

    return (
      <div className="flex-1 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
         <div className="p-6 border-b border-slate-100 flex justify-between items-center flex-wrap gap-4">
            <h4 className="font-bold text-slate-800">Todos los Vehículos</h4>
            <div className="relative w-full max-w-sm">
              <input 
                type="text" 
                placeholder="Buscar por matrícula, marca, bastidor..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full border border-slate-200 rounded-full pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <FileSearch className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            </div>
         </div>
         <div className="flex-1 overflow-y-auto p-4">
           {filteredVehicles.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <Car className="w-12 h-12 mb-4 opacity-50" />
               <p>No se encontraron vehículos que coincidan con la búsqueda.</p>
             </div>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
               {filteredVehicles.map(v => (
                 <div 
                   key={v.id} 
                   onClick={() => setSelectedVehicle(v)}
                   className="border border-slate-100 p-4 rounded-2xl hover:shadow-md hover:border-blue-200 transition-all cursor-pointer bg-white"
                 >
                   <div className="flex justify-between items-start mb-2">
                     <div>
                       <h5 className="font-bold text-slate-900">{v.matricula}</h5>
                       <p className="text-xs text-slate-500">{v.marca} - {v.tipo}</p>
                     </div>
                     <Car className="w-5 h-5 text-blue-400" />
                   </div>
                   <div className="space-y-1 mt-4 text-xs">
                     <div className="flex justify-between"><span className="text-slate-500">Próxima ITV:</span> <span className="font-medium">{v.proximaITV || 'N/A'}</span></div>
                     <div className="flex justify-between"><span className="text-slate-500">Vencimiento ATP:</span> <span className="font-medium">{v.vencimientoATP || 'N/A'}</span></div>
                     <div className="flex justify-between"><span className="text-slate-500">Seguro:</span> <span className="font-medium">{v.aseguradora || 'N/A'}</span></div>
                   </div>
                 </div>
               ))}
             </div>
           )}
         </div>
      </div>
    );
  };

  const renderAlerts = () => {
    const alerts = getAllAlerts();
    return (
      <div className="flex-1 bg-white rounded-3xl border border-slate-200 overflow-hidden flex flex-col">
         <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <div>
              <h4 className="font-bold text-slate-800">Centro de Alertas</h4>
              <p className="text-sm text-slate-500">Gestiona los trámites vencidos o próximos a vencer de toda la flota.</p>
            </div>
         </div>
         <div className="flex-1 overflow-y-auto p-2">
           {alerts.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-500">
               <CheckCircle2 className="w-12 h-12 mb-4 text-emerald-400 opacity-50" />
               <p>Todo en orden. No hay alertas pendientes.</p>
             </div>
           ) : (
             <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                    <th className="px-4 py-3">Vehículo</th>
                    <th className="px-4 py-3">Trámite</th>
                    <th className="px-4 py-3">Fecha Límite</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Acción</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {alerts.map((al, idx) => (
                    <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-4">
                        <div className="font-bold">{al.vehicle.matricula}</div>
                        <div className="text-xs text-slate-500">{al.vehicle.marca}</div>
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-700">{al.type}</td>
                      <td className="px-4 py-4">{al.date}</td>
                      <td className="px-4 py-4">
                        <span className={`text-[10px] px-2 py-1 rounded font-bold ${
                          al.status.status === 'danger' ? 'bg-red-100 text-red-600' :
                          'bg-amber-100 text-amber-600'
                        }`}>
                          {al.status.text}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <button 
                          onClick={() => {
                             setActiveTab('vehicles');
                             setSelectedVehicle(al.vehicle);
                             // Set editing mode immediately so they can update the date
                             setIsEditing(true);
                          }}
                          className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                          Renovar / Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
             </table>
           )}
         </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-50 text-slate-900 w-full min-h-screen h-full flex overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <nav className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
              B
            </div>
            <h1 className="text-xl font-bold tracking-tight">Flotas Bonany</h1>
          </div>
          <ul className="space-y-4 text-sm font-medium">
            <li onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${activeTab === 'dashboard' ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}>
              <LayoutDashboard className="w-5 h-5" />
              Panel de Control
            </li>
            <li onClick={() => setActiveTab('vehicles')} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${activeTab === 'vehicles' ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}>
              <Car className="w-5 h-5" />
              Gestión de Vehículos
            </li>
            <li onClick={() => setActiveTab('alerts')} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${activeTab === 'alerts' ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}>
              <AlertCircle className="w-5 h-5" />
              Alertas de Vencimiento
            </li>
          </ul>
        </div>
        <div className="mt-auto p-6 border-t border-slate-100">
          <div className="flex items-center gap-3 p-2">
            <div className="w-10 h-10 rounded-full bg-slate-200"></div>
            <div className="text-xs">
              <p className="font-bold text-slate-800">Admin Flota</p>
              <p className="text-slate-500">admin@flotasbonany.es</p>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-8 space-y-6 overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              {activeTab === 'dashboard' ? 'Estado de la Flota' : activeTab === 'alerts' ? 'Alertas de Vencimiento' : 'Directorio de Vehículos'}
            </h2>
            <p className="text-slate-500 text-sm">Resumen en tiempo real y trámites pendientes.</p>
          </div>
          <button onClick={() => setShowAddModal(true)} className="bg-blue-600 text-white px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 shadow-sm hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            Añadir Vehículo
          </button>
        </div>

        {/* Statistics Row */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Vehículos Totales</p>
              <h3 className="text-3xl font-bold text-slate-900">{stats.total}</h3>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Vehículos con Alerta Próxima</p>
              <h3 className="text-3xl font-bold text-amber-500">{stats.itvProxMes}</h3>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Vehículos con Alerta Crítica</p>
              <h3 className="text-3xl font-bold text-red-500">{stats.criticas}</h3>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Totalmente Operativos</p>
              <h3 className="text-3xl font-bold text-blue-500">{stats.operativo}</h3>
            </div>
          </div>
        )}

        {/* Dynamic Content */}
        {activeTab === 'dashboard' ? renderDashboard() : activeTab === 'alerts' ? renderAlerts() : renderVehicles()}

        {/* Notification Footer Bar */}
        <div className="bg-slate-900 text-white p-3 rounded-2xl flex items-center justify-between px-6 shadow-xl shrink-0 mt-auto">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              Notificaciones Push Activas
            </span>
            <span className="opacity-40">|</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Sincronizado con servidor
            </span>
          </div>
        </div>
      </main>
      
      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">Nuevo Vehículo</h3>
              <button onClick={() => setShowAddModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              await addDoc(collection(db, 'vehicles'), {
                matricula: formData.get('matricula'),
                marca: formData.get('marca'),
                tipo: 'Añadido Manual',
                proximaITV: formData.get('itv'),
                createdAt: serverTimestamp()
              });
              setShowAddModal(false);
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Matrícula</label>
                <input name="matricula" required className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Marca / Modelo</label>
                <input name="marca" required className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Próxima ITV</label>
                <input name="itv" placeholder="DD/MM/YYYY" className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white font-bold rounded-lg p-3 hover:bg-blue-700 mt-4">Guardar Vehículo</button>
            </form>
          </div>
        </div>
      )}

      {/* Vehicle Details Modal */}
      {selectedVehicle && (
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
                      await deleteDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id));
                      setSelectedVehicle(null);
                      setIsEditing(false);
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

            {!isEditing && getMissingFields(selectedVehicle).length > 0 && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-amber-800 text-sm">Información Incompleta</h4>
                  <p className="text-amber-700 text-xs mt-1">Faltan los siguientes datos: {getMissingFields(selectedVehicle).join(', ')}</p>
                </div>
              </div>
            )}

            {isEditing ? (
              <form onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const updates = {
                  tipo: formData.get('tipo'),
                  tipoCaja: formData.get('tipoCaja'),
                  capacidad: formData.get('capacidad'),
                  bastidor: formData.get('bastidor'),
                  fechaMatriculacion: formData.get('fechaMatriculacion'),
                  chofer: formData.get('chofer'),
                  proximaITV: formData.get('proximaITV'),
                  vencimientoATP: formData.get('vencimientoATP'),
                  revisionTacografo: formData.get('revisionTacografo'),
                  aseguradora: formData.get('aseguradora'),
                  poliza: formData.get('poliza'),
                };
                await updateDoc(firestoreDoc(db, 'vehicles', selectedVehicle.id), updates);
                setSelectedVehicle({ ...selectedVehicle, ...updates });
                setIsEditing(false);
              }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información General</h4>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label><input name="tipo" defaultValue={selectedVehicle.tipo} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo Caja</label><input name="tipoCaja" defaultValue={selectedVehicle.tipoCaja} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacidad</label><input name="capacidad" defaultValue={selectedVehicle.capacidad} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nº Bastidor</label><input name="bastidor" defaultValue={selectedVehicle.bastidor} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">F. Matriculación</label><input name="fechaMatriculacion" defaultValue={selectedVehicle.fechaMatriculacion} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chofer</label><input name="chofer" defaultValue={selectedVehicle.chofer} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Legal y Vencimientos</h4>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Próxima ITV</label><input name="proximaITV" defaultValue={selectedVehicle.proximaITV} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vencimiento ATP</label><input name="vencimientoATP" defaultValue={selectedVehicle.vencimientoATP} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Revisión Tacógrafo</label><input name="revisionTacografo" defaultValue={selectedVehicle.revisionTacografo} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Aseguradora</label><input name="aseguradora" defaultValue={selectedVehicle.aseguradora} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nº Póliza</label><input name="poliza" defaultValue={selectedVehicle.poliza} className="w-full border border-slate-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-slate-100">
                  <button type="button" onClick={() => setIsEditing(false)} className="px-5 py-2.5 rounded-lg font-bold text-sm text-slate-600 hover:bg-slate-100 transition-colors">Cancelar</button>
                  <button type="submit" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-blue-700 transition-colors">Guardar Cambios</button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Información General */}
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información General</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo</p>
                    <p className="font-medium text-sm">{selectedVehicle.tipo || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo Caja</p>
                    <p className="font-medium text-sm">{selectedVehicle.tipoCaja || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Capacidad</p>
                    <p className="font-medium text-sm">{selectedVehicle.capacidad || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nº Bastidor</p>
                    <p className="font-medium text-sm">{selectedVehicle.bastidor || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">F. Matriculación</p>
                    <p className="font-medium text-sm">{selectedVehicle.fechaMatriculacion || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Chofer</p>
                    <p className="font-medium text-sm">{selectedVehicle.chofer || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Legal y Vencimientos */}
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Legal y Vencimientos</h4>
                <div className="grid grid-cols-1 gap-4">
                  <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Próxima ITV</p>
                      <p className="font-bold text-sm">{selectedVehicle.proximaITV || 'N/A'}</p>
                    </div>
                    {selectedVehicle.proximaITV && (
                      <span className={`text-[10px] px-2 py-1 rounded font-bold ${
                        getAlertStatus(selectedVehicle.proximaITV).status === 'danger' ? 'bg-red-100 text-red-600' :
                        getAlertStatus(selectedVehicle.proximaITV).status === 'warning' ? 'bg-amber-100 text-amber-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}>
                        {getAlertStatus(selectedVehicle.proximaITV).text}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center p-2">
                    <span className="text-sm font-medium text-slate-600">Vencimiento ATP</span>
                    <span className="font-bold text-sm">{selectedVehicle.vencimientoATP || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-2">
                    <span className="text-sm font-medium text-slate-600">Revisión Tacógrafo</span>
                    <span className="font-bold text-sm">{selectedVehicle.revisionTacografo || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-2">
                    <span className="text-sm font-medium text-slate-600">Aseguradora</span>
                    <span className="font-bold text-sm">{selectedVehicle.aseguradora || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-2">
                    <span className="text-sm font-medium text-slate-600">Nº Póliza</span>
                    <span className="font-bold text-sm">{selectedVehicle.poliza || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Documentos Adjuntos */}
            <div className="mt-8 border-t border-slate-100 pt-6">
              <div className="flex justify-between items-center mb-4">
                 <h4 className="font-bold text-slate-800">Documentación Adjunta</h4>
                 <label className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg font-bold text-xs cursor-pointer hover:bg-blue-100 transition-colors flex items-center gap-2">
                    <UploadCloud className="w-4 h-4" />
                    Subir Archivo
                    <input type="file" className="hidden" onChange={async (e) => {
                      if (e.target.files && e.target.files[0]) {
                         const file = e.target.files[0];
                         await addDoc(collection(db, 'documents'), {
                           vehicleId: selectedVehicle.id,
                           name: file.name,
                           type: file.type || 'application/octet-stream',
                           url: URL.createObjectURL(file), // temporary URL for preview logic
                           uploadedAt: serverTimestamp()
                         });
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
                          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-700">{doc.name}</p>
                            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                              {doc.uploadedAt ? new Date(doc.uploadedAt.toDate()).toLocaleDateString() : 'Subiendo...'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <a href={doc.url} target="_blank" rel="noreferrer" className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors">
                            <Download className="w-4 h-4" />
                          </a>
                          <button onClick={async () => await deleteDoc(firestoreDoc(db, 'documents', doc.id))} className="p-2 hover:bg-red-100 rounded-lg text-red-500 transition-colors">
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
      )}
    </div>
  );
}
