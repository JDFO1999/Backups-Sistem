import React, { useState, useEffect } from 'react';
import { 
  Server as ServerIcon, Plus, Wifi, Trash2, Edit3,
  CheckCircle, XCircle, RefreshCw, Key, Lock
} from 'lucide-react';
import { api } from '../services/api';
import { Server, ServerTestResult } from '../types';
import { showToast, showConfirm } from '../utils/toast';

export const ServersPage: React.FC = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);

  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<{ [id: number]: ServerTestResult }>({});
  
  // Create / Edit Form State
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [username, setUsername] = useState('Administrator');
  const [osType, setOsType] = useState<'LINUX' | 'WINDOWS'>('WINDOWS');
  const [authType, setAuthType] = useState<'KEY' | 'PASSWORD'>('PASSWORD');
  const [sshKey, setSshKey] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchServers = async () => {
    try {
      const res = await api.get('/servers');
      setServers(res.data);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al cargar servidores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const openCreateModal = () => {
    setName('');
    setHost('');
    setSshPort(22);
    setOsType('WINDOWS');
    setUsername('Administrator');
    setAuthType('PASSWORD');
    setSshKey('');
    setPassword('');
    setIsCreateModalOpen(true);
  };

  const openEditModal = (s: Server) => {
    setEditingServer(s);
    setName(s.name);
    setHost(s.host);
    setSshPort(s.ssh_port);
    setOsType(s.os_type || 'WINDOWS');
    setUsername(s.username);
    setAuthType((s.auth_type as any) || 'PASSWORD');
    setSshKey('');
    setPassword('');
    setIsEditModalOpen(true);
  };

  const handleOsTypeChange = (selected: 'LINUX' | 'WINDOWS') => {
    setOsType(selected);
    if (selected === 'WINDOWS') {
      if (username === 'root') setUsername('Administrator');
    } else {
      if (username === 'Administrator') setUsername('root');
    }
  };

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await api.post('/servers', {
        name,
        host,
        ssh_port: sshPort,
        username,
        os_type: osType,
        auth_type: authType,
        ssh_key: authType === 'KEY' ? sshKey : undefined,
        password: authType === 'PASSWORD' ? password : undefined,
      });

      showToast.success(`Servidor ${name} (${osType}) registrado exitosamente`);
      setIsCreateModalOpen(false);
      fetchServers();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al guardar servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingServer) return;
    setSubmitting(true);

    try {
      await api.put(`/servers/${editingServer.id}`, {
        name,
        host,
        ssh_port: sshPort,
        username,
        os_type: osType,
        auth_type: authType,
        ssh_key: sshKey ? sshKey : undefined,
        password: password ? password : undefined,
      });

      showToast.success(`Servidor "${name}" actualizado exitosamente`);
      setIsEditModalOpen(false);
      setEditingServer(null);
      fetchServers();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al actualizar servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async (id: number) => {
    setTestingId(id);
    try {
      const res = await api.post(`/servers/${id}/test`);
      setTestResults(prev => ({ ...prev, [id]: res.data }));
      if (res.data.success) {
        showToast.success(`Conexión exitosa con ${res.data.os_detected || 'el servidor'} (${res.data.latency_ms} ms)`);
      } else {
        showToast.error(res.data.message || 'Fallo en la prueba de conexión');
      }
      fetchServers();
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Error de conexión remota';
      setTestResults(prev => ({
        ...prev,
        [id]: { success: false, message: msg }
      }));
      showToast.error(msg);
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteServer = async (id: number, serverName: string) => {
    const confirmed = await showConfirm(
      '¿Eliminar Servidor?',
      `Se eliminará "${serverName}" y todas sus conexiones de bases de datos asociadas.`,
      'Sí, eliminar servidor'
    );
    if (!confirmed) return;

    try {
      await api.delete(`/servers/${id}`);
      showToast.success(`Servidor ${serverName} eliminado`);
      fetchServers();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al eliminar servidor.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Servidores Remotos (Windows & Linux)</h1>
          <p className="text-xs text-slate-400">Administre conexiones SSH a servidores Windows Server o Linux de origen</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg shadow-blue-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          Registrar Servidor
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : servers.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <ServerIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white">No hay servidores registrados</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Añada servidores Windows Server o Linux para analizar y respaldar sus bases de datos hacia Google Drive.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((s) => {
            const testResult = testResults[s.id];
            const isTesting = testingId === s.id;
            const isWindows = s.os_type === 'WINDOWS';

            // Clean display: do not say Linux if it's a Windows server that timed out
            const displayedOs = s.status === 'ONLINE' 
              ? (s.os_info || s.os_type || 'Detectado')
              : `${s.os_type || 'Servidor'} (Sin conectar)`;

            return (
              <div 
                key={s.id} 
                className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white text-base">{s.name}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isWindows 
                            ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' 
                            : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                        }`}>
                          {s.os_type || 'LINUX'}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400 mt-1">
                        {s.username}@{s.host}:{s.ssh_port}
                      </div>
                    </div>
                    <span className={`
                      inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold
                      ${s.status === 'ONLINE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        s.status === 'OFFLINE' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        'bg-slate-800 text-slate-400 border border-slate-700'}
                    `}>
                      {s.status}
                    </span>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-2 text-xs text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Autenticación:</span>
                      <span className="font-mono flex items-center gap-1 text-slate-200">
                        {s.auth_type === 'KEY' ? <Key className="w-3 h-3 text-blue-400" /> : <Lock className="w-3 h-3 text-amber-400" />}
                        {s.auth_type} (Cifrado AES-256)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sistema Detectado:</span>
                      <span className="text-slate-200 truncate max-w-[170px]" title={displayedOs}>
                        {displayedOs}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Último Contacto:</span>
                      <span className="text-slate-200">
                        {s.last_contact_at ? new Date(s.last_contact_at).toLocaleTimeString('es-ES') : 'Nunca'}
                      </span>
                    </div>
                  </div>

                  {testResult && (
                    <div className={`mt-3 p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                      testResult.success 
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' 
                        : 'bg-red-500/10 border border-red-500/20 text-red-300'
                    }`}>
                      {testResult.success ? (
                        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      )}
                      <div>
                        <div>{testResult.message}</div>
                        {testResult.latency_ms && (
                          <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                            Latencia: {testResult.latency_ms} ms
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestConnection(s.id)}
                    disabled={isTesting}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
                  >
                    <Wifi className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse text-blue-400' : ''}`} />
                    <span>{isTesting ? 'Probando...' : 'Probar Conexión'}</span>
                  </button>

                  <button
                    onClick={() => openEditModal(s)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                    title="Editar Servidor"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteServer(s.id, s.name)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Eliminar Servidor"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Crear Servidor */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <ServerIcon className="w-5 h-5 text-blue-500" />
                Registrar Nuevo Servidor
              </h3>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateServer} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Sistema Operativo del Servidor
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleOsTypeChange('WINDOWS')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 ${
                      osType === 'WINDOWS'
                        ? 'bg-sky-600/20 border-sky-500 text-sky-400 shadow-lg shadow-sky-600/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span>🪟 Windows Server / PC</span>
                    <span className="text-[10px] font-normal text-slate-400">OpenSSH Server nativo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOsTypeChange('LINUX')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 ${
                      osType === 'LINUX'
                        ? 'bg-orange-600/20 border-orange-500 text-orange-400 shadow-lg shadow-orange-600/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span>🐧 Linux</span>
                    <span className="text-[10px] font-normal text-slate-400">Ubuntu, Debian, RHEL</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nombre Identificador</label>
                <input
                  type="text"
                  required
                  placeholder={osType === 'WINDOWS' ? 'ej. windows-db-server-01' : 'ej. produccion-linux-01'}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Host o Dirección IP</label>
                  <input
                    type="text"
                    required
                    placeholder="10.10.10.21 o winserver.local"
                    value={host}
                    onChange={e => setHost(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Puerto SSH</label>
                  <input
                    type="number"
                    required
                    value={sshPort}
                    onChange={e => setSshPort(parseInt(e.target.value) || 22)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Usuario {osType === 'WINDOWS' ? '(Windows: ej. Administrator, .\\usuario)' : '(Linux: ej. root, deploy)'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={osType === 'WINDOWS' ? 'Administrator o .\\usuario' : 'root'}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Método de Autenticación</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthType('KEY')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 ${
                      authType === 'KEY' 
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    Llave SSH
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthType('PASSWORD')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 ${
                      authType === 'PASSWORD' 
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Contraseña
                  </button>
                </div>
              </div>

              {authType === 'KEY' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Clave SSH Privada
                  </label>
                  <textarea
                    rows={3}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                    value={sshKey}
                    onChange={e => setSshKey(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    🔒 Cifrada con AES-256-GCM.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Contraseña</label>
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Guardando...' : 'Guardar Servidor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Servidor */}
      {isEditModalOpen && editingServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-500" />
                Editar Servidor: {editingServer.name}
              </h3>
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateServer} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Sistema Operativo del Servidor
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleOsTypeChange('WINDOWS')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 ${
                      osType === 'WINDOWS'
                        ? 'bg-sky-600/20 border-sky-500 text-sky-400 shadow-lg shadow-sky-600/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span>🪟 Windows Server / PC</span>
                    <span className="text-[10px] font-normal text-slate-400">OpenSSH Server</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOsTypeChange('LINUX')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 ${
                      osType === 'LINUX'
                        ? 'bg-orange-600/20 border-orange-500 text-orange-400 shadow-lg shadow-orange-600/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span>🐧 Linux</span>
                    <span className="text-[10px] font-normal text-slate-400">Ubuntu, Debian, RHEL</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nombre Identificador</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Host o Dirección IP</label>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={e => setHost(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Puerto SSH</label>
                  <input
                    type="number"
                    required
                    value={sshPort}
                    onChange={e => setSshPort(parseInt(e.target.value) || 22)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Usuario</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Método de Autenticación</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAuthType('KEY')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 ${
                      authType === 'KEY' 
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    Llave SSH
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthType('PASSWORD')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 ${
                      authType === 'PASSWORD' 
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Contraseña
                  </button>
                </div>
              </div>

              {authType === 'KEY' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nueva Clave SSH Privada (Opcional - dejar vacío para conservar la actual)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Pegar nueva clave o dejar en blanco para no modificar"
                    value={sshKey}
                    onChange={e => setSshKey(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nueva Contraseña (Opcional - dejar vacío para conservar la actual)
                  </label>
                  <input
                    type="password"
                    placeholder="Dejar en blanco para conservar contraseña actual"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServersPage;
