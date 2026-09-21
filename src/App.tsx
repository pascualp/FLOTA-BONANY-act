import { useState, useEffect } from 'react';
import {
  Car,
  AlertCircle,
  Plus,
  CheckCircle2,
  Mail,
  Bell
} from 'lucide-react';
import { db } from './lib/firebase';
import { collection, addDoc, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { seedData } from './lib/seedData';
import { Vehicle, VehicleDocument } from './types';
import { getAllAlerts, calculateStats } from './utils';
import { EmailService } from './lib/email';

// Components
import { AlertsList } from './components/AlertsList';
import { VehicleModal } from './components/VehicleModal';
import { AddVehicleModal } from './components/AddVehicleModal';

export default function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('alerts');
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [vehicleDocuments, setVehicleDocuments] = useState<VehicleDocument[]>([]);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  useEffect(() => {
    EmailService.init();
  }, []);

  const sendEmailReport = async () => {
    if (alerts.length === 0) {
      alert('No hay alertas pendientes para enviar.');
      return;
    }

    setIsSendingEmail(true);
    try {
      const dangerAlerts = alerts.filter(a => a.status.status === 'danger');
      const warningAlerts = alerts.filter(a => a.status.status === 'warning');

      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">Resumen de Alertas - Flotas Bonany</h2>
          <p style="color: #64748b;">Se han detectado los siguientes trámites pendientes en la flota:</p>
          
          ${dangerAlerts.length > 0 ? `
            <h3 style="color: #dc2626; margin-bottom: 10px;">⚠️ VENCIDOS (${dangerAlerts.length})</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              ${dangerAlerts.map(a => `
                <tr style="border-bottom: 1px solid #fee2e2; background-color: #fef2f2;">
                  <td style="padding: 12px; font-weight: bold; color: #1e293b; border-bottom: 1px solid #fee2e2;">${a.vehicle.matricula}</td>
                  <td style="padding: 12px; color: #1e293b; border-bottom: 1px solid #fee2e2;">${a.type}</td>
                  <td style="padding: 12px; color: #dc2626; font-weight: bold; text-align: right; border-bottom: 1px solid #fee2e2;">${a.date}</td>
                </tr>
              `).join('')}
            </table>
          ` : ''}

          ${warningAlerts.length > 0 ? `
            <h3 style="color: #d97706; margin-bottom: 10px;">🔔 PRÓXIMOS A VENCER (${warningAlerts.length})</h3>
            <table style="width: 100%; border-collapse: collapse;">
              ${warningAlerts.map(a => `
                <tr style="border-bottom: 1px solid #fef3c7; background-color: #fffbeb;">
                  <td style="padding: 12px; font-weight: bold; color: #1e293b; border-bottom: 1px solid #fef3c7;">${a.vehicle.matricula}</td>
                  <td style="padding: 12px; color: #1e293b; border-bottom: 1px solid #fef3c7;">${a.type}</td>
                  <td style="padding: 12px; color: #d97706; font-weight: bold; text-align: right; border-bottom: 1px solid #fef3c7;">${a.date}</td>
                </tr>
              `).join('')}
            </table>
          ` : ''}

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
            Este es un correo automático generado por el Sistema de Gestión de Flotas Bonany.
          </div>
        </div>
      `;

      await EmailService.sendEmail({
        to: 'porteousfacundo@gmail.com',
        subject: `⚠️ Alerta de Vencimientos: ${dangerAlerts.length} vencidos / ${warningAlerts.length} próximos`,
        html
      });
      alert('Reporte enviado correctamente a porteousfacundo@gmail.com');
    } catch (error: any) {
      console.error(error);
      alert('Error al enviar el correo: ' + (error.error || error.message || 'Error desconocido'));
    } finally {
      setIsSendingEmail(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'vehicles'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const existingData = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as Vehicle[];
      const existingMatriculas = existingData.map(d => d.matricula);
      
      const missing = seedData.filter(v => !existingMatriculas.includes(v.matricula));
      if (missing.length > 0) {
        for (const v of missing) {
          await addDoc(collection(db, 'vehicles'), {
            ...v,
            createdAt: serverTimestamp()
          });
        }
      }
      setVehicles(existingData);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedVehicle || !selectedVehicle.id) {
      setVehicleDocuments([]);
      return;
    }
    const q = query(collection(db, 'documents'), where('vehicleId', '==', selectedVehicle.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as VehicleDocument[];
      data.sort((a, b) => {
        if (!a.uploadedAt) return -1;
        if (!b.uploadedAt) return 1;
        return b.uploadedAt.toMillis() - a.uploadedAt.toMillis();
      });
      setVehicleDocuments(data);
    });
    return () => unsubscribe();
  }, [selectedVehicle]);

  const stats = calculateStats(vehicles);
  const alerts = getAllAlerts(vehicles);

  const currentVehicle = selectedVehicle ? vehicles.find(v => v.id === selectedVehicle.id) || selectedVehicle : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Car className="w-12 h-12 text-blue-600 animate-bounce" />
          <p className="text-slate-500 font-medium">Cargando Flota...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col p-6 shrink-0">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="bg-blue-600 text-white p-2 rounded-xl shadow-lg shadow-blue-200">
            B
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">Flotas Bonany</h1>
        </div>
        
        <nav className="flex-1">
          <ul className="space-y-2 text-sm font-medium">
              <li 
                onClick={() => setActiveTab('alerts')} 
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 ${activeTab === 'alerts' ? 'text-blue-600 bg-blue-50 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                <AlertCircle className="w-5 h-5" />
                Alertas de Vencimiento
                {alerts.length > 0 && (
                  <span className="ml-auto bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    {alerts.length}
                  </span>
                )}
              </li>
              <li 
                onClick={sendEmailReport}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 group ${isSendingEmail ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Mail className="w-5 h-5 group-hover:scale-110 transition-transform" />
                {isSendingEmail ? 'Enviando...' : 'Enviar Reporte Email'}
              </li>
          </ul>
        </nav>

        <div className="mt-auto p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Usuario</p>
          <p className="text-sm font-bold text-slate-700">Administrador</p>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-8 space-y-6 overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">
              Estado de la Flota
            </h2>
            <p className="text-slate-500 text-sm">Resumen en tiempo real y trámites pendientes.</p>
          </div>
          <button 
            onClick={() => setShowAddModal(true)} 
            className="bg-blue-600 text-white px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 shadow-sm hover:bg-blue-700 transition-all hover:scale-105 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Añadir Vehículo
          </button>
        </div>

        {/* Dynamic Content */}
        {activeTab === 'alerts' && (
          <AlertsList 
            alerts={alerts} 
            setSelectedVehicle={setSelectedVehicle} 
            setIsEditing={setIsEditing} 
          />
        )}

        {/* Notification Footer Bar */}
        <div className="bg-slate-900 text-white p-4 rounded-2xl flex items-center justify-between px-6 shadow-xl shrink-0 mt-auto">
          <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-wider">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              Notificaciones Activas
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Sincronización Cloud OK
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-bold">
            v2.4.0 • Flotas Bonany Management System
          </div>
        </div>
      </main>
      
      {/* Modals */}
      {showAddModal && <AddVehicleModal setShowAddModal={setShowAddModal} />}
      
      {currentVehicle && (
        <VehicleModal 
          selectedVehicle={currentVehicle} 
          setSelectedVehicle={setSelectedVehicle} 
          isEditing={isEditing} 
          setIsEditing={setIsEditing} 
          vehicleDocuments={vehicleDocuments} 
        />
      )}
    </div>
  );
}
