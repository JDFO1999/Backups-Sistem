import React, { useState, useEffect } from 'react';
import { 
  HardDrive, CheckCircle2, XCircle, RefreshCw, 
  ExternalLink, LogOut, Folder, Plus, Trash2, Check
} from 'lucide-react';
import { api } from '../services/api';
import { GoogleDriveStatus, GoogleDriveStorage } from '../types';
import { showToast, showConfirm } from '../utils/toast';

interface DriveAccountItem {
  id: number;
  email: string;
  root_folder_id?: string;
  root_folder_name?: string;
  is_active: boolean;
  storage_total_bytes?: number;
  storage_used_bytes?: number;
  last_synced_at?: string;
}

export const GoogleDrivePage: React.FC = () => {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [storage, setStorage] = useState<GoogleDriveStorage | null>(null);
  const [accounts, setAccounts] = useState<DriveAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const fetchDriveInfo = async () => {
    try {
      const [resStatus, resAccounts] = await Promise.all([
        api.get('/google-drive/status'),
        api.get('/google-drive/accounts').catch(() => ({ data: [] }))
      ]);
      setStatus(resStatus.data);
      setAccounts(resAccounts.data || []);

      if (resStatus.data.is_connected) {
        const resStorage = await api.get('/google-drive/storage');
        setStorage(resStorage.data);
      } else {
        setStorage(null);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDriveInfo();
    const queryParams = new URLSearchParams(window.location.search);
    if (queryParams.get('connected') === 'true') {
      showToast.success('¡Cuenta de Google Drive vinculada exitosamente!');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (queryParams.get('error')) {
      showToast.error(`Error de autorización: ${queryParams.get('error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await api.get('/google-drive/auth');
      if (res.data.auth_url) {
        showToast.info('Redirigiendo a la pantalla de autorización de Google...');
        window.location.href = res.data.auth_url;
      }
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'No se pudo iniciar la conexión con Google Drive.');
      setConnecting(false);
    }
  };

  const handleActivateAccount = async (accountId: number, email: string) => {
    try {
      await api.post(`/google-drive/accounts/${accountId}/activate`);
      showToast.success(`Cuenta ${email} activada como destino principal.`);
      fetchDriveInfo();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al cambiar cuenta activa.');
    }
  };

  const handleDeleteAccount = async (accountId: number, email: string) => {
    const confirmed = await showConfirm(
      '¿Eliminar cuenta vinculada?',
      `Se desvinculará la cuenta ${email} del sistema. Los archivos existentes en Google Drive no serán eliminados.`,
      'Sí, desvincular'
    );
    if (!confirmed) return;

    try {
      await api.delete(`/google-drive/accounts/${accountId}`);
      showToast.success(`Cuenta ${email} desvinculada.`);
      fetchDriveInfo();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al eliminar cuenta.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const usedBytes = storage?.used_bytes || 0;
  const totalBytes = storage?.total_bytes || 0;
  const usagePct = totalBytes > 0 ? Math.min(Math.round((usedBytes / totalBytes) * 100), 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Integración con Google Drive</h1>
          <p className="text-xs text-slate-400">Destino de almacenamiento en la nube mediante OAuth 2.0 y API oficial de Drive</p>
        </div>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>{connecting ? 'Iniciando OAuth...' : 'Vincular Otra Cuenta de Google'}</span>
        </button>
      </div>

      {/* Tarjeta de Cuenta Activa y Cuota */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${status?.is_connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
              <HardDrive className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">Google Drive API v3 (Destino Activo)</h3>
                {status?.is_connected ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    Conectado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                    <XCircle className="w-3 h-3" />
                    Desconectado
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {status?.is_connected 
                  ? `Cuenta autorizada: ${status.email}` 
                  : 'No hay ninguna cuenta activa. Conecte su cuenta para habilitar el guardado de backups.'}
              </p>
            </div>
          </div>
        </div>

        {!status?.is_connected && (
          <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <p className="font-bold text-amber-200">⚠️ Se requiere reconectar Google Drive</p>
              <p className="text-slate-300 mt-0.5">El token ha expirado (límite de 7 días del modo 'Prueba' de Google). Haz clic en el botón para renovarlo al instante.</p>
            </div>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-md transition-all flex items-center gap-2 flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{connecting ? 'Conectando...' : 'Reconectar Google Drive Ahora'}</span>
            </button>
          </div>
        )}

        {status?.is_connected && (
          <div className="mt-6 pt-6 border-t border-slate-800 space-y-4">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Cuota de Almacenamiento de Cuenta Activa
            </h4>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">
                  Espacio Usado: <strong className="text-white font-mono">{storage?.used_formatted || '0 B'}</strong>
                </span>
                <span className="text-slate-400">
                  Capacidad Total: <strong className="text-white font-mono">{storage?.total_formatted || 'Ilimitado'}</strong>
                </span>
              </div>

              {!storage?.is_unlimited && (
                <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden p-0.5">
                  <div 
                    className="bg-blue-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${usagePct}%` }}
                  />
                </div>
              )}

              <div className="flex justify-between text-[11px] text-slate-400 pt-1">
                <span>
                  Espacio disponible: <strong className="text-emerald-400 font-mono">{storage?.available_formatted || 'Ilimitado'}</strong>
                  <span className="text-slate-600 mx-1.5">•</span>
                  Total Usado: <strong className="text-amber-400 font-mono">{storage?.used_formatted || '0 B'}</strong>
                </span>
                {!storage?.is_unlimited && <span>{usagePct}% ocupado</span>}
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <Folder className="w-4 h-4 text-amber-400" />
                <span>Carpeta Raíz: <strong className="font-mono text-white">{status.root_folder_name}</strong></span>
              </div>
              {status.root_folder_id && (
                <a
                  href={`https://drive.google.com/drive/folders/${status.root_folder_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg border border-blue-500/20 transition-colors font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir Carpeta en Google Drive ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lista de Cuentas de Google Vinculadas (Multi-Cuenta) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white">Cuentas de Google Vinculadas ({accounts.length})</h3>
            <p className="text-xs text-slate-400">Puedes alternar entre diferentes cuentas de Google según tus necesidades de respaldo.</p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            No hay cuentas vinculadas. Pulsa en "Vincular Otra Cuenta de Google" para conectar una.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {accounts.map(acc => (
              <div 
                key={acc.id}
                className={`p-4 rounded-xl border transition-all flex items-center justify-between ${
                  acc.is_active 
                    ? 'bg-blue-600/10 border-blue-500/40 shadow-sm shadow-blue-500/10' 
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-white">{acc.email}</span>
                    {acc.is_active && (
                      <span className="text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                        <Check className="w-2.5 h-2.5" /> Principal
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Carpeta: <span className="font-mono text-slate-300">{acc.root_folder_name}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {!acc.is_active && (
                    <button
                      onClick={() => handleActivateAccount(acc.id, acc.email)}
                      className="px-2.5 py-1 text-xs text-blue-400 hover:text-white hover:bg-blue-600 border border-blue-500/30 rounded-lg transition-colors font-medium"
                    >
                      Activar
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteAccount(acc.id, acc.email)}
                    className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Desvincular cuenta"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GoogleDrivePage;
