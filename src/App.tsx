import { useState, useEffect } from 'react';
import {
  Car,
  AlertCircle,
  Plus,
  CheckCircle2,
  Mail,
  Bell,
  LogOut,
  Truck
} from 'lucide-react';
import { db, auth } from './lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { LoginScreen } from './components/LoginScreen';
import { Vehicle, VehicleDocument } from './types';
import { getAllAlerts, problemasDe } from './utils';
import { AVISO_CUOTA, esCuotaAgotada } from './documentos';

// Components
import { AlertsList } from './components/AlertsList';
import { VehicleList } from './components/VehicleList';
import { VehicleModal } from './components/VehicleModal';
import { AddVehicleModal } from './components/AddVehicleModal';

export default function App() {
  // Todas las fichas, también las que están fuera de la flota (campo «baja»).
  const [todos, setTodos] = useState<Vehicle[]>([]);
  // Fichas de los documentos de cada vehículo (id del vehículo → documentos, los más nuevos primero). Es la ÚNICA
  // lectura de `documents` de la app: de aquí salen la lista de la ficha y el control de qué papeles faltan.
  const [docsPorVehiculo, setDocsPorVehiculo] = useState<Record<string, VehicleDocument[]>>({});
  // La base de Firestore agotó su cuota diaria (vuelve a las 9:00): se avisa arriba sin echar a nadie de la app.
  const [cuotaAgotada, setCuotaAgotada] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('alerts');
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  // undefined = todavía comprobando la sesión; null = sin sesión
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [dataError, setDataError] = useState('');

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    if (!u) { setTodos([]); setDocsPorVehiculo({}); setLoading(true); }
  }), []);

  // Manda ya el mismo reporte que sale solo cada mañana (lo arma y lo envía el servidor: /api/reporte-diario).
  const sendEmailReport = async () => {
    if (!auth.currentUser) return;
    setIsSendingEmail(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch('/api/reporte-diario', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
      alert(data.enviado
        ? `Reporte enviado a ${data.para} (${data.vencidos} vencidos, ${data.proximos} próximos${data.revisar ? `, ${data.revisar} fechas a revisar` : ''}).`
        : 'No hay trámites pendientes: no se ha enviado nada.');
    } catch (error: any) {
      console.error(error);
      alert(esCuotaAgotada(error) ? AVISO_CUOTA : 'Error al enviar el correo: ' + (error.message || 'Error desconocido'));
    } finally {
      setIsSendingEmail(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'vehicles'));
    // 23/11/2026: antes aquí se volvían a crear los vehículos de la lista inicial (seedData) que «faltaban» en cada
    // cambio de la base. Eso duplicaba fichas (5875NDS ×4) y resucitaba cualquier vehículo borrado. La flota ya
    // está en Firestore: solo se lee.
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const existingData = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as Vehicle[];
      existingData.sort((a, b) => String(a.matricula || '').localeCompare(String(b.matricula || '')));
      setDataError('');
      setCuotaAgotada(false);
      setTodos(existingData);
      setLoading(false);
    }, (error) => {
      // Antes no había este aviso: con «permiso denegado» la pantalla se quedaba en «Cargando Flota...» para siempre
      console.error('Error leyendo la flota:', error);
      if (esCuotaAgotada(error)) {
        // No es culpa de la cuenta: no se cierra la sesión, se avisa arriba (y se ve lo último que se cargó).
        setCuotaAgotada(true);
        setLoading(false);
        return;
      }
      setDataError(error.code === 'permission-denied'
        ? `La cuenta ${user.email || ''} no tiene permiso para ver la flota. Entra con otra cuenta.`
        : `No se pudo cargar la flota: ${error.message}`);
      signOut(auth);   // vuelve a la pantalla de entrada con el aviso, para poder probar con otra cuenta
    });
    return () => unsubscribe();
  }, [user]);

  // Fichas de TODOS los documentos (son ligeras: el archivo está en Google Cloud Storage; los viejos, troceados en
  // /chunks, que aquí no se leen). Antes había además otra lectura por vehículo abierto: ahora sale de aquí.
  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, 'documents'), (snapshot) => {
      const porVehiculo: Record<string, VehicleDocument[]> = {};
      snapshot.docs.forEach(d => {
        const doc = { id: d.id, ...(d.data() as any) } as VehicleDocument;
        if (doc.vehicleId) (porVehiculo[doc.vehicleId] ||= []).push(doc);
      });
      // Los más nuevos primero; los que se están subiendo (sin fecha todavía) arriba del todo.
      const cuando = (d: VehicleDocument) => d.uploadedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
      Object.values(porVehiculo).forEach(lista => lista.sort((a, b) => cuando(b) - cuando(a)));
      setDocsPorVehiculo(porVehiculo);
    }, (error) => {
      console.error('Error leyendo los documentos:', error);
      if (esCuotaAgotada(error)) setCuotaAgotada(true);
    });
  }, [user]);

  // Solo la flota que SÍ tenemos cuenta para las alertas; la de fuera sale aparte en «Vehículos».
  const vehicles = todos.filter(v => !v.baja);
  const fuera = todos.filter(v => v.baja);
  const alerts = getAllAlerts(vehicles);
  // Contador del menú: trámites vencidos, que vencen pronto o con fecha que no se entiende, sin cita sacada.
  // Lo que está en regla no cuenta (antes salía el total de fechas de toda la flota).
  const porMirar = vehicles.reduce((n, v) => { const p = problemasDe(v); return n + p.vencidos + p.pronto + p.revisar; }, 0);

  const currentVehicle = selectedVehicle ? todos.find(v => v.id === selectedVehicle.id) || selectedVehicle : null;
  const vehicleDocuments = currentVehicle?.id ? docsPorVehiculo[currentVehicle.id] || [] : [];

  if (user === null) {
    return <LoginScreen aviso={dataError} />;
  }

  if (user === undefined || loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Car className="w-12 h-12 text-blue-600 animate-bounce" />
          <p className="text-slate-500 font-medium">{user === undefined ? 'Comprobando acceso...' : 'Cargando Flota...'}</p>
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
                {porMirar > 0 && (
                  <span className="ml-auto bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-bold" title="Trámites por mirar (sin cita sacada)">
                    {porMirar}
                  </span>
                )}
              </li>
              <li
                onClick={() => setActiveTab('vehicles')}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 ${activeTab === 'vehicles' ? 'text-blue-600 bg-blue-50 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                <Truck className="w-5 h-5" />
                Vehículos
                <span className="ml-auto bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                  {vehicles.length}
                </span>
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
          <p className="text-sm font-bold text-slate-700 truncate" title={user.email || ''}>{user.displayName || user.email || 'Administrador'}</p>
          <button
            onClick={() => signOut(auth)}
            className="mt-3 text-xs font-semibold text-slate-500 hover:text-red-600 flex items-center gap-1"
          >
            <LogOut className="w-3 h-3" />
            Salir
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-8 space-y-6 overflow-y-auto">
        {cuotaAgotada && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-medium shrink-0">
            ⚠️ {AVISO_CUOTA}
          </div>
        )}

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

        {activeTab === 'vehicles' && (
          <VehicleList
            vehicles={vehicles}
            fuera={fuera}
            docsPorVehiculo={docsPorVehiculo}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setSelectedVehicle={setSelectedVehicle}
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
