import React, { useState, useEffect } from 'react';
import { 
  FolderArchive, 
  RefreshCw, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  HardDrive, 
  Wifi, 
  WifiOff, 
  Folder, 
  Search, 
  FileText, 
  RotateCcw, 
  Trash2, 
  X 
} from 'lucide-react';
import { foldersApi } from '../services/api';
import { Branch, FolderBackupJob } from '../types';
import { toast } from '../utils/toast';

export const FolderBackupsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'branches' | 'history'>('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [jobs, setJobs] = useState<FolderBackupJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [refreshingPing, setRefreshingPing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selection
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);

  // Modal New Backup
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [jobName, setJobName] = useState<string>('');
  const [folderScope, setFolderScope] = useState<'all' | 'critical' | 'custom'>('critical');
  const [customSubfolders, setCustomSubfolders] = useState<string[]>(['Data', 'Datos']);
  const [startingJob, setStartingJob] = useState<boolean>(false);

  // Modal View Files
  const [selectedJobForFiles, setSelectedJobForFiles] = useState<FolderBackupJob | null>(null);

  const commonSubfolders = ['Data', 'Datos', 'DataSQL', 'Formularios', 'Cierre_POS', 'Run', 'Informes'];

  const fetchBranches = async (refreshPing = false) => {
    try {
      if (refreshPing) setRefreshingPing(true);
      const res = await foldersApi.getBranches(refreshPing);
      setBranches(res.data);
    } catch (err: any) {
      toast.error('Error al cargar sucursales: ' + (err.response?.data?.detail || err.message));
    } finally {
      if (refreshPing) setRefreshingPing(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await foldersApi.getJobs();
      setJobs(res.data);
    } catch (err: any) {
      console.error('Error al cargar historial de respaldos:', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchBranches(false), fetchJobs()]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Poll running jobs every 3 seconds
  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'RUNNING' || j.status === 'PENDING');
    if (!hasRunning) return;

    const interval = setInterval(() => {
      fetchJobs();
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs]);

  const handleSyncBranches = async () => {
    try {
      setSyncing(true);
      const res = await foldersApi.syncBranches();
      toast.success(`Sincronización completada: ${res.data.total} sucursales detectadas (${res.data.online_count} en línea).`);
      await fetchBranches(true);
    } catch (err: any) {
      toast.error('Fallo al sincronizar desde SQL Server: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedBranchIds.length === filteredBranches.length) {
      setSelectedBranchIds([]);
    } else {
      setSelectedBranchIds(filteredBranches.map(b => b.id));
    }
  };

  const handleSelectAkBranches = () => {
    const akIds = branches.filter(b => b.code.toUpperCase().startsWith('AK')).map(b => b.id);
    setSelectedBranchIds(akIds);
    toast.success(`${akIds.length} sucursales Alkosto (AK) seleccionadas.`);
  };

  const toggleBranchSelection = (id: number) => {
    if (selectedBranchIds.includes(id)) {
      setSelectedBranchIds(selectedBranchIds.filter(x => x !== id));
    } else {
      setSelectedBranchIds([...selectedBranchIds, id]);
    }
  };

  const openNewBackupModal = (preselectedId?: number) => {
    if (preselectedId) {
      setSelectedBranchIds([preselectedId]);
    }
    const dateStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    setJobName(`Respaldo Carpetas Tiendas - ${dateStr}`);
    setIsModalOpen(true);
  };

  const handleStartBackup = async () => {
    if (selectedBranchIds.length === 0) {
      toast.error('Debes seleccionar al menos una sucursal.');
      return;
    }

    try {
      setStartingJob(true);
      let subfoldersToSend: string[] | undefined = undefined;
      if (folderScope === 'critical') {
        subfoldersToSend = ['Data', 'Datos', 'DataSQL', 'Formularios'];
      } else if (folderScope === 'custom') {
        subfoldersToSend = customSubfolders;
      }

      await foldersApi.createJob({
        job_name: jobName,
        branch_ids: selectedBranchIds,
        subfolders: subfoldersToSend
      });

      toast.success('¡Tarea de respaldo iniciada exitosamente!');
      setIsModalOpen(false);
      setActiveTab('history');
      await fetchJobs();
    } catch (err: any) {
      toast.error('Error al iniciar el respaldo: ' + (err.response?.data?.detail || err.message));
    } finally {
      setStartingJob(false);
    }
  };

  const handleResumeJob = async (jobId: number) => {
    try {
      await foldersApi.resumeJob(jobId);
      toast.success('Reanudando tarea de respaldo...');
      await fetchJobs();
    } catch (err: any) {
      toast.error('Error al reanudar: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    if (!window.confirm('¿Deseas eliminar este registro de respaldo y sus archivos en Google Drive?')) return;
    try {
      await foldersApi.deleteJob(jobId);
      toast.success('Tarea eliminada correctamente.');
      await fetchJobs();
    } catch (err: any) {
      toast.error('Error al eliminar tarea: ' + (err.response?.data?.detail || err.message));
    }
  };

  const filteredBranches = branches.filter(b => 
    b.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.ip_address.includes(searchQuery)
  );

  const onlineBranchesCount = branches.filter(b => b.is_online).length;

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FolderArchive className="h-7 w-7 text-indigo-600" />
            Respaldo de Carpetas de Tiendas
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Respaldo directo de rutas de red UNC (<code className="bg-gray-100 text-indigo-700 px-1.5 py-0.5 rounded font-mono text-xs">\\IP\Sistema\aBC-Soft</code>) a Google Drive sin consumo de disco local (Zero-Disk).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncBranches}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
            title="Sincronizar sucursales desde SQL Server Sistemas.dbo.Sucursal"
          >
            <RefreshCw className={`h-4 w-4 text-indigo-600 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar SQL Server'}
          </button>

          <button
            onClick={() => fetchBranches(true)}
            disabled={refreshingPing}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
            title="Verificar estado de conexión en vivo (Ping SMB)"
          >
            <Wifi className={`h-4 w-4 text-green-600 ${refreshingPing ? 'animate-spin' : ''}`} />
            {refreshingPing ? 'Comprobando...' : 'Verificar Conexión'}
          </button>

          <button
            onClick={() => openNewBackupModal()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg shadow hover:bg-indigo-700"
          >
            <Play className="h-4 w-4" />
            Nuevo Respaldo
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
            <Folder className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Total Sucursales</p>
            <h3 className="text-2xl font-bold text-gray-900">{branches.length}</h3>
            <p className="text-xs text-gray-400">Registradas en SQL Server</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg">
            <Wifi className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Sucursales en Línea</p>
            <h3 className="text-2xl font-bold text-green-700">{onlineBranchesCount} / {branches.length}</h3>
            <p className="text-xs text-green-600">Conexión SMB activa</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <FolderArchive className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Tareas de Respaldo</p>
            <h3 className="text-2xl font-bold text-gray-900">{jobs.length}</h3>
            <p className="text-xs text-gray-400">Historial de ejecuciones</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg">
            <HardDrive className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Tecnología Zero-Disk</p>
            <h3 className="text-xl font-bold text-purple-700">0 B en Disco C:</h3>
            <p className="text-xs text-purple-600">RAM Stream directo a Drive</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('branches')}
            className={`pb-4 px-1 text-sm font-medium border-b-2 flex items-center gap-2 ${
              activeTab === 'branches'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Folder className="h-4 w-4" />
            Sucursales y Rutas UNC ({branches.length})
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`pb-4 px-1 text-sm font-medium border-b-2 flex items-center gap-2 ${
              activeTab === 'history'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Clock className="h-4 w-4" />
            Historial de Respaldos ({jobs.length})
          </button>
        </nav>
      </div>

      {/* Tab 1: Branches Table */}
      {activeTab === 'branches' && (
        <div className="space-y-4">
          {/* Action bar and search */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por código (AK01), nombre o IP..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAll}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                {selectedBranchIds.length === filteredBranches.length ? 'Desmarcar Todas' : 'Seleccionar Todas'}
              </button>

              <button
                onClick={handleSelectAkBranches}
                className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md"
              >
                Solo Tiendas Alkosto (AK)
              </button>

              {selectedBranchIds.length > 0 && (
                <button
                  onClick={() => openNewBackupModal()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md flex items-center gap-1.5"
                >
                  <Play className="h-3.5 w-3.5" />
                  Respaldar {selectedBranchIds.length} Seleccionada(s)
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-600 font-semibold text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={filteredBranches.length > 0 && selectedBranchIds.length === filteredBranches.length}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="py-3 px-4 text-left">Código</th>
                    <th className="py-3 px-4 text-left">Sucursal / Nombre</th>
                    <th className="py-3 px-4 text-left">IP y Ruta de Red UNC</th>
                    <th className="py-3 px-4 text-center">Estado Red</th>
                    <th className="py-3 px-4 text-left">Último Respaldo</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500">
                        Cargando sucursales...
                      </td>
                    </tr>
                  ) : filteredBranches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500">
                        No se encontraron sucursales. Haz clic en "Sincronizar SQL Server".
                      </td>
                    </tr>
                  ) : (
                    filteredBranches.map(branch => {
                      const isSelected = selectedBranchIds.includes(branch.id);
                      return (
                        <tr 
                          key={branch.id} 
                          className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50/40' : ''}`}
                        >
                          <td className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleBranchSelection(branch.id)}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-indigo-900">
                            {branch.code}
                          </td>
                          <td className="py-3 px-4 font-medium text-gray-900">
                            {branch.name}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono text-xs text-gray-800 bg-gray-50 px-2 py-1 rounded border border-gray-200 inline-block">
                              {branch.unc_path}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {branch.is_online ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                                ONLINE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                                <WifiOff className="h-3 w-3" />
                                OFFLINE
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-500">
                            {branch.last_backup_at ? (
                              <div>
                                <p>{new Date(branch.last_backup_at).toLocaleString()}</p>
                                <p className="font-semibold text-gray-700">{formatBytes(branch.last_backup_size_bytes || 0)}</p>
                              </div>
                            ) : (
                              <span className="text-gray-400">Sin respaldos</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => openNewBackupModal(branch.id)}
                              className="px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md inline-flex items-center gap-1"
                              title="Respaldar esta carpeta"
                            >
                              <Play className="h-3 w-3" />
                              Respaldar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: History Table */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-gray-600 font-semibold text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4 text-left">ID</th>
                    <th className="py-3 px-4 text-left">Tarea</th>
                    <th className="py-3 px-4 text-center">Estado</th>
                    <th className="py-3 px-4 text-left">Progreso / Paso</th>
                    <th className="py-3 px-4 text-center">Tiendas</th>
                    <th className="py-3 px-4 text-left">Tamaño Total</th>
                    <th className="py-3 px-4 text-left">Fecha</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-500">
                        Aún no se han ejecutado respaldos de carpetas.
                      </td>
                    </tr>
                  ) : (
                    jobs.map(job => {
                      const isRunning = job.status === 'RUNNING' || job.status === 'PENDING';
                      return (
                        <tr key={job.id} className="hover:bg-gray-50">
                          <td className="py-3 px-4 font-mono font-bold text-gray-500">#{job.id}</td>
                          <td className="py-3 px-4 font-medium text-gray-900">{job.job_name}</td>
                          <td className="py-3 px-4 text-center">
                            {job.status === 'COMPLETED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                                <CheckCircle2 className="h-3 w-3" /> Completado
                              </span>
                            )}
                            {isRunning && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 animate-pulse">
                                <RefreshCw className="h-3 w-3 animate-spin" /> En Curso
                              </span>
                            )}
                            {job.status === 'FAILED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                                <AlertCircle className="h-3 w-3" /> Fallido
                              </span>
                            )}
                            {job.status === 'INTERRUPTED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                                <Clock className="h-3 w-3" /> Interrumpido
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 min-w-[220px]">
                            <div className="w-full bg-gray-200 rounded-full h-2 mb-1.5 overflow-hidden">
                              <div 
                                className={`h-2 rounded-full transition-all duration-300 ${
                                  job.status === 'FAILED' ? 'bg-red-500' : isRunning ? 'bg-blue-600' : 'bg-green-600'
                                }`} 
                                style={{ width: `${job.progress_percent || 0}%` }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-600 truncate max-w-xs" title={job.current_step}>
                              {job.current_step}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-center font-semibold text-gray-800">
                            {job.completed_branches || 0} / {job.total_branches || 0}
                          </td>
                          <td className="py-3 px-4 font-mono font-medium text-indigo-700">
                            {formatBytes(job.total_size_bytes || 0)}
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-500">
                            {new Date(job.created_at).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1">
                            {(job.status === 'FAILED' || job.status === 'INTERRUPTED') && (
                              <button
                                onClick={() => handleResumeJob(job.id)}
                                className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-md"
                                title="Reanudar tarea con Checkpoints"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}

                            <button
                              onClick={() => setSelectedJobForFiles(job)}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md"
                              title="Ver archivos respaldados en Google Drive"
                            >
                              <FileText className="h-4 w-4" />
                            </button>

                            <button
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-md"
                              title="Eliminar tarea"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Folder Backup */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-lg w-full overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FolderArchive className="h-5 w-5 text-indigo-600" />
                Configurar Respaldo de Carpetas
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Nombre de la Tarea
                </label>
                <input
                  type="text"
                  value={jobName}
                  onChange={e => setJobName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Sucursales Seleccionadas ({selectedBranchIds.length})
                </label>
                <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-700 max-h-24 overflow-y-auto flex flex-wrap gap-1.5">
                  {selectedBranchIds.length === 0 ? (
                    <span className="text-red-500">Ninguna sucursal seleccionada.</span>
                  ) : (
                    selectedBranchIds.map(id => {
                      const b = branches.find(x => x.id === id);
                      return (
                        <span key={id} className="bg-white px-2 py-1 rounded border border-gray-300 font-mono font-medium">
                          {b ? `${b.code} (${b.name})` : id}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-2">
                  Alcance del Respaldo (Filtro de Subcarpetas)
                </label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="folderScope"
                      checked={folderScope === 'critical'}
                      onChange={() => setFolderScope('critical')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Subcarpetas Críticas (Recomendado)</p>
                      <p className="text-xs text-gray-500">
                        Respalda únicamente <code className="text-indigo-600 font-mono">Data, Datos, DataSQL, Formularios</code>. Omite archivos gigantescos como Cierre_POS para máxima rapidez.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="folderScope"
                      checked={folderScope === 'all'}
                      onChange={() => setFolderScope('all')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Directorio Completo (Todo aBC-Soft)</p>
                      <p className="text-xs text-gray-500">
                        Empaqueta absolutamente todos los archivos y subdirectorios de la tienda (puede pesar más de 100 GB).
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="radio"
                      name="folderScope"
                      checked={folderScope === 'custom'}
                      onChange={() => setFolderScope('custom')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="w-full">
                      <p className="text-sm font-medium text-gray-900">Personalizado</p>
                      {folderScope === 'custom' && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {commonSubfolders.map(sf => (
                            <label key={sf} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={customSubfolders.includes(sf)}
                                onChange={e => {
                                  if (e.target.checked) setCustomSubfolders([...customSubfolders, sf]);
                                  else setCustomSubfolders(customSubfolders.filter(x => x !== sf));
                                }}
                                className="rounded text-indigo-600"
                              />
                              {sf}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              <div className="p-3 bg-indigo-50 rounded-lg text-xs text-indigo-800">
                🚀 <strong>Zero-Disk Streaming:</strong> Los archivos se transmitirán en bloques de memoria RAM directamente hacia Google Drive en formato <code>.tar.gz</code> sin ocupar espacio en tu disco C:.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStartBackup}
                disabled={startingJob || selectedBranchIds.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
              >
                {startingJob ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {startingJob ? 'Iniciando...' : 'Iniciar Respaldo en Drive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Files in Job */}
      {selectedJobForFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Archivos en Google Drive - #{selectedJobForFiles.id} {selectedJobForFiles.job_name}
                </h3>
                <p className="text-xs text-gray-500">
                  Total Respaldado: {formatBytes(selectedJobForFiles.total_size_bytes || 0)}
                </p>
              </div>
              <button 
                onClick={() => setSelectedJobForFiles(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {(!selectedJobForFiles.backup_files || selectedJobForFiles.backup_files.length === 0) ? (
                <p className="text-center py-6 text-sm text-gray-500">
                  No hay archivos completados aún para esta tarea.
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedJobForFiles.backup_files.map(file => (
                    <div 
                      key={file.id} 
                      className="p-3.5 bg-gray-50 rounded-lg border border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-mono">
                            {file.branch_code}
                          </span>
                          <span className="text-sm font-semibold text-gray-900 font-mono">
                            {file.file_name}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 font-mono">
                          Drive: {file.google_drive_path}
                        </p>
                        {file.sha256_checksum && (
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                            SHA-256: {file.sha256_checksum.slice(0, 24)}...
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="font-bold text-sm text-gray-900">
                          {formatBytes(file.file_size_bytes)}
                        </span>
                        <p className="text-xs text-green-600 font-medium flex items-center gap-1 justify-end mt-0.5">
                          <CheckCircle2 className="h-3 w-3" /> Subido a Drive
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 bg-gray-50 border-t border-gray-200 text-right">
              <button
                onClick={() => setSelectedJobForFiles(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
