import React, { useState, useEffect } from 'react';
import { 
  Database, RefreshCw, Server, CheckSquare, Square, 
  HardDrive, Play, Layers
} from 'lucide-react';
import { api } from '../services/api';
import { Server as IServer, Database as IDatabase, DatabaseEstimate } from '../types';
import { showToast, showConfirm } from '../utils/toast';

export const DatabasesPage: React.FC<{ onNavigateToBackups: () => void }> = ({ onNavigateToBackups }) => {
  const [servers, setServers] = useState<IServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [databases, setDatabases] = useState<IDatabase[]>([]);
  const [selectedDbIds, setSelectedDbIds] = useState<number[]>([]);
  const [estimate, setEstimate] = useState<DatabaseEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [startingBackup, setStartingBackup] = useState(false);
  
  // Discover modal
  const [isDiscoverModalOpen, setIsDiscoverModalOpen] = useState(false);
  const [engine, setEngine] = useState<'MYSQL' | 'POSTGRESQL' | 'MARIADB' | 'SQLSERVER'>('SQLSERVER');
  const [connName, setConnName] = useState('Instancia Local');
  const [dbHost, setDbHost] = useState('127.0.0.1');
  const [dbPort, setDbPort] = useState(1433);
  const [dbUser, setDbUser] = useState('sa');
  const [dbPassword, setDbPassword] = useState('');
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    api.get('/servers').then(res => {
      setServers(res.data);
      if (res.data.length > 0) {
        setSelectedServerId(res.data[0].id);
      }
    }).catch(err => {
      showToast.error(err.response?.data?.detail || 'Error al obtener servidores');
    });
  }, []);

  const fetchDatabases = async (serverId: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/databases/server/${serverId}`);
      setDatabases(res.data);
      setSelectedDbIds([]);
      setEstimate(null);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error cargando bases de datos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedServerId) {
      fetchDatabases(selectedServerId);
    }
  }, [selectedServerId]);

  useEffect(() => {
    if (selectedDbIds.length === 0) {
      setEstimate(null);
      return;
    }

    api.post('/databases/estimate', { database_ids: selectedDbIds })
      .then(res => setEstimate(res.data))
      .catch(err => console.error(err));
  }, [selectedDbIds]);

  const toggleSelectDb = (id: number) => {
    setSelectedDbIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedDbIds.length === databases.length) {
      setSelectedDbIds([]);
    } else {
      setSelectedDbIds(databases.map(d => d.id));
    }
  };

  const handleDiscoverDatabases = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServerId) return;

    setDiscovering(true);

    try {
      const res = await api.post(`/databases/server/${selectedServerId}/discover`, {
        engine,
        name: connName,
        host: dbHost,
        port: dbPort,
        username: dbUser,
        password: dbPassword || undefined
      });

      showToast.success(`Detección finalizada: se sincronizaron ${res.data.length} bases de datos.`);
      setIsDiscoverModalOpen(false);
      fetchDatabases(selectedServerId);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error detectando bases de datos en el servidor.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleStartBackup = async () => {
    if (!selectedServerId || selectedDbIds.length === 0) return;

    const confirmed = await showConfirm(
      '¿Iniciar Tarea de Backup?',
      `Se respaldarán ${selectedDbIds.length} bases de datos hacia Google Drive con compresión gzip.`,
      'Sí, iniciar backup'
    );
    if (!confirmed) return;

    setStartingBackup(true);
    try {
      await api.post('/backups', {
        server_id: selectedServerId,
        database_ids: selectedDbIds,
        compression_type: 'GZIP'
      });
      showToast.success('Tarea de backup encolada exitosamente en el Worker.');
      onNavigateToBackups();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error iniciando backup.');
      setStartingBackup(false);
    }
  };

  const currentServer = servers.find(s => s.id === selectedServerId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white">Bases de Datos (Windows / Linux)</h1>
          <p className="text-xs text-slate-400">Seleccione las bases de datos para análisis y generación de backups</p>
        </div>

        {/* Server Selector & Scan Button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 sm:py-1.5 flex-1 min-w-0">
            <Server className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <select
              value={selectedServerId || ''}
              onChange={e => setSelectedServerId(Number(e.target.value))}
              className="bg-transparent text-xs text-white focus:outline-none cursor-pointer w-full truncate"
            >
              {servers.map(s => (
                <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                  [{s.os_type || 'LINUX'}] {s.name} ({s.host})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsDiscoverModalOpen(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all shadow-md shadow-blue-600/20 flex-shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Detectar / Escanear</span>
          </button>
        </div>
      </div>

      {/* Databases Table and Estimation Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Databases Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/40">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                className="text-slate-400 hover:text-white p-1"
                title="Seleccionar todas"
              >
                {databases.length > 0 && selectedDbIds.length === databases.length ? (
                  <CheckSquare className="w-4 h-4 text-blue-500" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
              <span className="text-xs font-medium text-slate-300">
                {databases.length} Bases encontradas en {currentServer?.name || 'el servidor'}
              </span>
            </div>
            <span className="text-xs text-slate-400">
              {selectedDbIds.length} seleccionadas
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 w-10"></th>
                  <th className="py-3 px-4">Base de Datos</th>
                  <th className="py-3 px-4">Motor</th>
                  <th className="py-3 px-4">Tamaño Real</th>
                  <th className="py-3 px-4">Último Backup</th>
                  <th className="py-3 px-4">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-500 mb-2" />
                      Cargando bases de datos...
                    </td>
                  </tr>
                ) : databases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      No hay bases de datos detectadas en este servidor.
                      <div className="mt-2">
                        <button
                          onClick={() => setIsDiscoverModalOpen(true)}
                          className="text-blue-400 hover:underline font-medium text-xs"
                        >
                          Escanear ahora con credenciales del motor de BD
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  databases.map(db => {
                    const isSelected = selectedDbIds.includes(db.id);
                    return (
                      <tr 
                        key={db.id}
                        onClick={() => toggleSelectDb(db.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-600/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3 px-4">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-500" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500" />
                          )}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white flex items-center gap-2">
                          <Database className="w-3.5 h-3.5 text-slate-400" />
                          {db.name}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">{db.engine}</td>
                        <td className="py-3 px-4 font-mono font-medium text-blue-300">
                          {db.size_formatted || '0 B'}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {db.last_backup_at ? new Date(db.last_backup_at).toLocaleDateString('es-ES') : 'Nunca'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                            db.last_backup_status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
                          }`}>
                            {db.last_backup_status || 'SIN BACKUP'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Real-time Estimation and Backup Trigger */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-blue-500" />
              Cálculo y Estimación del Backup
            </h3>

            <div className="space-y-3 pt-2">
              <div className="flex justify-between items-center text-xs pb-2 border-b border-slate-800">
                <span className="text-slate-400">Bases seleccionadas:</span>
                <span className="font-bold text-white font-mono text-sm">
                  {estimate?.selected_count || 0}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs pb-2 border-b border-slate-800">
                <span className="text-slate-400">Tamaño total original:</span>
                <span className="font-bold text-blue-400 font-mono text-sm">
                  {estimate?.total_original_formatted || '0 B'}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs pb-2 border-b border-slate-800">
                <span className="text-slate-400">Tamaño estimado comprimido:</span>
                <span className="font-bold text-emerald-400 font-mono text-sm">
                  {estimate?.estimated_compressed_formatted || '0 B'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 leading-relaxed">
              ℹ️ {estimate?.disclaimer || 'El tamaño final puede variar según el contenido, índices y nivel de compresión gzip.'}
            </p>

            <button
              onClick={handleStartBackup}
              disabled={selectedDbIds.length === 0 || startingBackup}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/30"
            >
              <Play className="w-4 h-4" />
              <span>{startingBackup ? 'Iniciando Tarea...' : 'Crear Backup Ahora'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Discover Databases */}
      {isDiscoverModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" />
                Detectar Bases de Datos ({currentServer?.os_type || 'Servidor'})
              </h3>
              <button onClick={() => setIsDiscoverModalOpen(false)} className="text-slate-400 text-sm">✕</button>
            </div>

            <form onSubmit={handleDiscoverDatabases} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Motor</label>
                <select
                  value={engine}
                  onChange={e => {
                    const eng = e.target.value as any;
                    setEngine(eng);
                    if (eng === 'SQLSERVER') {
                      setDbPort(1433);
                      setDbUser('sa');
                    } else if (eng === 'POSTGRESQL') {
                      setDbPort(5432);
                      setDbUser('postgres');
                    } else {
                      setDbPort(3306);
                      setDbUser('root');
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                >
                  <option value="SQLSERVER">Microsoft SQL Server (MSSQL)</option>
                  <option value="MYSQL">MySQL</option>
                  <option value="MARIADB">MariaDB</option>
                  <option value="POSTGRESQL">PostgreSQL</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Host de BD</label>
                  <input
                    type="text"
                    required
                    value={dbHost}
                    onChange={e => setDbHost(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Puerto</label>
                  <input
                    type="number"
                    required
                    value={dbPort}
                    onChange={e => setDbPort(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Usuario de BD</label>
                <input
                  type="text"
                  required
                  value={dbUser}
                  onChange={e => setDbUser(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Contraseña de BD</label>
                <input
                  type="password"
                  placeholder="Dejar vacío si no requiere contraseña"
                  value={dbPassword}
                  onChange={e => setDbPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDiscoverModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={discovering}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
                >
                  {discovering ? 'Conectando...' : 'Escanear Ahora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabasesPage;
