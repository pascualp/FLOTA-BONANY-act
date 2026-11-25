import { useState } from 'react';
import { Car, LogIn } from 'lucide-react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';

// Pantalla de entrada. Desde el 10/11/2026 la base de datos (reglas compartidas con Abonos Bonany)
// solo deja leer la flota a cuentas de oficina con sesión iniciada, así que hay que entrar antes de cargar nada.
const mensajeError = (code: string, message: string) => {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/popup-blocked':
      return 'El navegador ha bloqueado la ventana de Google. Permite las ventanas emergentes para esta página y vuelve a intentarlo.';
    case 'auth/unauthorized-domain':
      return 'Esta dirección web no está autorizada en Firebase (Authentication → Configuración → Dominios autorizados).';
    case 'auth/operation-not-allowed':
      return 'El acceso con Google no está activado en Firebase (Authentication → Método de acceso).';
    case 'auth/network-request-failed':
      return 'No hay conexión con Google. Revisa internet y vuelve a intentarlo.';
    default:
      return `No se ha podido entrar: ${message || code}`;
  }
};

export function LoginScreen({ aviso }: { aviso?: string }) {
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState('');

  const entrar = async () => {
    setEntrando(true);
    setError('');
    try {
      // Que Google pregunte siempre qué cuenta usar: si se entró con una sin permiso, así se puede cambiar.
      const proveedor = new GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, proveedor);
    } catch (e: any) {
      setError(mensajeError(e?.code || '', e?.message || ''));
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-10 w-full max-w-sm flex flex-col items-center gap-6">
        <div className="bg-blue-600 text-white p-3 rounded-2xl shadow-lg shadow-blue-200">
          <Car className="w-8 h-8" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">Flotas Bonany</h1>
          <p className="text-slate-500 text-sm mt-1">Solo con la cuenta de Facu o con la de Bon Any.</p>
        </div>
        {aviso && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">{aviso}</p>}
        <button
          onClick={entrar}
          disabled={entrando}
          className="w-full bg-blue-600 text-white px-5 py-3 rounded-full font-semibold text-sm flex items-center justify-center gap-2 shadow-sm hover:bg-blue-700 transition-all disabled:opacity-60"
        >
          <LogIn className="w-4 h-4" />
          {entrando ? 'Entrando…' : 'Entrar con Google'}
        </button>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      </div>
    </div>
  );
}
