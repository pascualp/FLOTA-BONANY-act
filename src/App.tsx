import { useState, useEffect, type ReactNode } from 'react';
import { Car, AlertCircle, Plus, Mail, LogOut, Truck, Wifi, WifiOff, Database } from 'lucide-react';
import { db, auth } from './lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { LoginScreen } from './components/LoginScreen';
import { Vehicle, VehicleDocument } from './types';
import { getAllAlerts, problemasDe } from './utils';
import { AVISO_CUOTA, esCuotaAgotada } from './documentos';
import { AVISO_SIN_ACCESO, tieneAcceso } from './acceso';

// Components
import { AlertsList } from './components/AlertsList';
import { VehicleList } from './components/VehicleList';
import { VehicleModal } from './components/VehicleModal';
import { AddVehicleModal } from './components/AddVehicleModal';

// MODO PRUEBA, solo al programar en este PC (npm run dev → http://localhost:3000/?demo): enseña la app con una copia de
// los datos en public/demo-flota.json (que NO va a GitHub) sin entrar con Google ni leer la base. Sirve para ver cómo
// queda la pantalla cuando la base no se puede usar. En la web publicada no existe (import.meta.env.DEV es false).
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo');

export default function App() {
  // Todas las fichas, también las que están fuera de la flota (campo «baja»).
  const [todos, setTodos] = useState<Vehicle[]>([]);
  // Fichas de los documentos de cada vehículo (id del vehículo → documentos, los más nuevos primero). Es la ÚNICA
  // lectura de `documents` de la app: de aquí salen la lista de la ficha y el control de qué papeles faltan.
  const [docsPorVehiculo, setDocsPorVehiculo] = useState<Record<string, VehicleDocument[]>>({});
  // La base de Firestore agotó su cuota diaria (vuelve a las 9:00): se avisa arriba sin echar a nadie de la app.
  const [cuotaAgotada, setCuotaAgotada] = useState(false);
  // Lo que se ve viene de la copia guardada en el navegador (todavía no ha contestado la base, o no hay conexión).
  const [desdeCache, setDesdeCache] = useState(false);
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);
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

  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (DEMO) {
      setUser({ email: 'modo-prueba' } as User);
      fetch('/demo-flota.json').then((r) => r.json()).then((d) => {
        setTodos(d.vehicles || []);
        // ?demo&tab=vehicles&ver=4666HWY&editar: para hacer capturas de cada pantalla sin tocar nada.
        const p = new URLSearchParams(window.location.search);
        if (p.get('tab')) setActiveTab(p.get('tab')!);
        const ver = (d.vehicles || []).find((v: Vehicle) => v.matricula === p.get('ver'));
        if (ver) { setSelectedVehicle(ver); setIsEditing(p.has('editar')); }
        if (p.has('alta')) setShowAddModal(true);
        const porVehiculo: Record<string, VehicleDocument[]> = {};
        for (const doc of d.documents || []) if (doc.vehicleId) (porVehiculo[doc.vehicleId] ||= []).push(doc);
        setDocsPorVehiculo(porVehiculo);
        setLoading(false);
      }).catch(() => setDataError('Modo prueba: falta public/demo-flota.json'));
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      // Solo las cuentas de la lista (src/acceso.ts). Con otra cuenta de Google: aviso y fuera, sin leer nada
      // (aunque se quedara dentro, las reglas de la base no le dejarían leer).
      if (u && !tieneAcceso(u.email, u.emailVerified)) {
        setDataError(AVISO_SIN_ACCESO(u.email));
        signOut(auth);
        setUser(null);
        return;
      }
      setUser(u);
      if (!u) { setTodos([]); setDocsPorVehiculo({}); setLoading(true); }
    });
  }, []);

  // Manda ya el mismo reporte que sale solo cada mañana (lo arma y lo envía el servidor: /api/reporte-diario).
  const sendEmailReport = async () => {
    if (!auth.currentUser) return;
    if (!window.confirm('¿Mandar ahora el reporte de vencimientos por correo?')) return;
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
    if (!user || DEMO) return;
    const q = query(collection(db, 'vehicles'));
    // 23/11/2026: antes aquí se volvían a crear los vehículos de la lista inicial (seedData) que «faltaban» en cada
    // cambio de la base. Eso duplicaba fichas (5875NDS ×4) y resucitaba cualquier vehículo borrado. La flota ya
    // está en Firestore: solo se lee.
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      const existingData = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })) as Vehicle[];
      existingData.sort((a, b) => String(a.matricula || '').localeCompare(String(b.matricula || '')));
      setDataError('');
      setDesdeCache(snapshot.metadata.fromCache);
      if (!snapshot.metadata.fromCache) setCuotaAgotada(false);
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
        ? AVISO_SIN_ACCESO(user.email)
        : `No se pudo cargar la flota: ${error.message}`);
      signOut(auth);   // vuelve a la pantalla de entrada con el aviso, para poder probar con otra cuenta
    });
    return () => unsubscribe();
  }, [user]);

  // Fichas de TODOS los documentos (son ligeras: el archivo está en Google Cloud Storage; los viejos, troceados en
  // /chunks, que aquí no se leen). Antes había además otra lectura por vehículo abierto: ahora sale de aquí.
  useEffect(() => {
    if (!user || DEMO) return;
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
  // Contador del menú: trámites vencidos, que vencen pronto o con fecha que falta o no se entiende, sin cita sacada.
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
          {dataError && <p className="text-sm text-amber-700">{dataError}</p>}
        </div>
      </div>
    );
  }

  // Estado real (antes el pie decía «Sincronización Cloud OK» y «Notificaciones Activas» siempre, pasara lo que pasara).
  const estadoDatos = cuotaAgotada ? { texto: 'La base no responde hasta las 9:00 (tope diario): ves lo último que se cargó', color: 'text-amber-300' }
    : !enLinea ? { texto: 'Sin conexión: ves lo último que se cargó', color: 'text-amber-300' }
    : desdeCache ? { texto: 'Conectando con la base…', color: 'text-slate-300' }
    : { texto: 'Datos al día', color: 'text-emerald-300' };

  const pestana = (id: string, icono: ReactNode, texto: string, extra?: ReactNode) => (
    <li
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 ${activeTab === id ? 'text-blue-600 bg-blue-50 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
    >
      {icono}{texto}{extra}
    </li>
  );

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Menú lateral: solo en pantallas grandes. En el móvil, la barra de abajo (al final). */}
      <div className="hidden md:flex w-72 bg-white border-r border-slate-200 flex-col p-6 shrink-0">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="bg-blue-600 text-white p-2 rounded-xl shadow-lg shadow-blue-200">B</div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">Flotas Bonany</h1>
        </div>
        <nav className="flex-1">
          <ul className="space-y-2 text-sm font-medium">
            {pestana('alerts', <AlertCircle className="w-5 h-5" />, 'Alertas de Vencimiento', porMirar > 0 ? (
              <span className="ml-auto bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-bold" title="Trámites por mirar (sin cita sacada)">{porMirar}</span>
            ) : undefined)}
            {pestana('vehicles', <Truck className="w-5 h-5" />, 'Vehículos', (
              <span className="ml-auto bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold">{vehicles.length}</span>
            ))}
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
          <button onClick={() => signOut(auth)} className="mt-3 text-xs font-semibold text-slate-500 hover:text-red-600 flex items-center gap-1">
            <LogOut className="w-3 h-3" />Salir
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {/* min-w-0: sin esto, en el móvil la tabla ensanchaba la página más que la pantalla y se cortaba por la derecha. */}
      <main className="flex-1 min-w-0 flex flex-col p-3 md:p-8 space-y-4 md:space-y-6 overflow-y-auto overflow-x-hidden pb-24 md:pb-8">
        {cuotaAgotada && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-medium shrink-0">
            ⚠️ {AVISO_CUOTA}
          </div>
        )}
        {DEMO && (
          <div className="bg-violet-50 border border-violet-200 text-violet-800 rounded-2xl p-3 text-sm font-medium shrink-0">
            Modo prueba: datos de una copia, sin conexión con la base. Lo que se guarde aquí no se guarda de verdad.
          </div>
        )}

        <div className="flex justify-between items-center gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-slate-800">
              <span className="md:hidden">Flotas Bonany</span>
              <span className="hidden md:inline">Estado de la Flota</span>
            </h2>
            <p className="text-slate-500 text-xs md:text-sm">{porMirar > 0 ? `${porMirar} cosas por mirar` : 'Todo en regla'} · {vehicles.length} vehículos</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 text-white px-4 md:px-5 py-2.5 rounded-full font-semibold text-sm flex items-center gap-2 shadow-sm hover:bg-blue-700 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Añadir Vehículo</span><span className="sm:hidden">Añadir</span>
          </button>
        </div>

        {activeTab === 'alerts' && (
          <AlertsList alerts={alerts} setSelectedVehicle={setSelectedVehicle} setIsEditing={setIsEditing} />
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

        <div className="hidden md:flex bg-slate-900 text-white p-4 rounded-2xl items-center justify-between px-6 shadow-xl shrink-0 mt-auto gap-4">
          <div className="flex items-center gap-6 text-[11px] font-bold">
            <span className={`flex items-center gap-2 ${enLinea ? 'text-emerald-300' : 'text-amber-300'}`}>
              {enLinea ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}{enLinea ? 'Conectado' : 'Sin conexión'}
            </span>
            <span className={`flex items-center gap-2 ${estadoDatos.color}`}><Database className="w-3.5 h-3.5" />{estadoDatos.texto}</span>
          </div>
          <div className="text-[10px] text-slate-500 font-bold">Flotas Bonany</div>
        </div>
        {/* En el móvil, el estado solo sale si algo va mal. */}
        {estadoDatos.texto !== 'Datos al día' && (
          <p className={`md:hidden text-xs font-semibold text-center ${estadoDatos.color === 'text-emerald-300' ? 'text-emerald-600' : 'text-amber-700'}`}>{estadoDatos.texto}</p>
        )}
      </main>

      {/* Barra de abajo en el móvil (en vez del menú lateral, que en el móvil se comía la pantalla). */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex justify-around py-2 z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
        {[
          { id: 'alerts', icono: <AlertCircle className="w-5 h-5" />, texto: 'Alertas', badge: porMirar },
          { id: 'vehicles', icono: <Truck className="w-5 h-5" />, texto: 'Vehículos', badge: 0 },
        ].map((b) => (
          <button key={b.id} onClick={() => setActiveTab(b.id)} className={`relative flex flex-col items-center gap-0.5 px-4 py-1 text-[11px] font-bold ${activeTab === b.id ? 'text-blue-600' : 'text-slate-400'}`}>
            {b.icono}{b.texto}
            {b.badge > 0 && <span className="absolute -top-1 right-2 bg-red-500 text-white rounded-full text-[9px] px-1.5">{b.badge}</span>}
          </button>
        ))}
        <button onClick={sendEmailReport} disabled={isSendingEmail} className="flex flex-col items-center gap-0.5 px-4 py-1 text-[11px] font-bold text-slate-400 disabled:opacity-50">
          <Mail className="w-5 h-5" />{isSendingEmail ? 'Enviando' : 'Reporte'}
        </button>
        <button onClick={() => window.confirm('¿Salir de la cuenta?') && signOut(auth)} className="flex flex-col items-center gap-0.5 px-4 py-1 text-[11px] font-bold text-slate-400">
          <LogOut className="w-5 h-5" />Salir
        </button>
      </nav>

      {/* Modals */}
      {showAddModal && <AddVehicleModal setShowAddModal={setShowAddModal} todos={todos} />}

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
