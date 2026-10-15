import React, { useState } from 'react';
import { Lock, ArrowRight, LogOut, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LockScreenModal: React.FC = () => {
  const { user, unlockSession, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Por favor ingrese su contraseña.');
      return;
    }
    setUnlocking(true);
    setError('');

    try {
      await unlockSession(password);
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Contraseña incorrecta. Verifique mayúsculas o espacios.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Glow decoration */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center p-3 shadow-xl mb-3">
            <img src="/alkosto-mascot-logo-clean.png" alt="Alkosto" className="w-full h-full object-contain" />
          </div>
          <div className="flex justify-center mb-1.5">
            <img src="/alkosto-logo-color-clean.png" alt="Alkosto" className="h-6 w-auto object-contain" />
          </div>
          <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            Pantalla Bloqueada por Inactividad
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Has estado inactivo por más de 15 minutos. Ingresa tu contraseña de acceso para continuar interactuando en el sistema.
          </p>
        </div>

        {/* User preview */}
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user?.full_name || 'Usuario'}</p>
              <p className="text-[11px] text-slate-400 font-mono truncate">{user?.email}</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
            {user?.role?.name || (user as any)?.role || 'ACTIVO'}
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Contraseña de Acceso
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                onKeyUp={(e) => setCapsLockActive(e.getModifierState('CapsLock'))}
                placeholder="Ingresa tu contraseña"
                className="w-full pl-10 pr-10 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {capsLockActive && (
              <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1 font-medium animate-in fade-in">
                <span>⚠️</span> Bloq Mayús (Caps Lock) está activado
              </p>
            )}
            {error && (
              <p className="text-xs text-red-400 mt-1.5 font-medium">{error}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={unlocking}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 focus:outline-none disabled:opacity-50 transition-colors shadow-lg shadow-blue-600/30 cursor-pointer"
          >
            {unlocking ? (
              <span>Validando...</span>
            ) : (
              <>
                <span>Desbloquear y Continuar</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer: opción de cambiar de cuenta o cerrar sesión */}
        <div className="pt-2 text-center border-t border-slate-800/80">
          <button
            type="button"
            onClick={() => logout()}
            className="text-xs text-slate-400 hover:text-red-400 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            ¿No eres tú? Cerrar sesión completamente
          </button>
        </div>
      </div>
    </div>
  );
};
