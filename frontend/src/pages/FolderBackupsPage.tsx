import React, { useState, useEffect, useMemo } from 'react';
import { 
  FolderArchive, 
  RefreshCw, 
  Play, 
  CheckCircle, 
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
  X,
  ExternalLink,
  ShieldCheck,
  Zap,
  Cloud
} from 'lucide-react';
import { foldersApi } from '../services/api';
import { Branch, FolderBackupJob, FolderBackupStats } from '../types';
import { toast } from '../utils/toast';

export const FolderBackupsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'branches' | 'history'>('branches');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [jobs, setJobs] = useState<FolderBackupJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [refreshingPing, setRefreshingPing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [stats, setStats] = useState<FolderBackupStats | null>(null);

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

  const fetchStats = async () => {
    try {
      const res = await foldersApi.getStats();
      setStats(res.data);
    } catch (err: any) {
      console.error('Error al cargar estadísticas de respaldo:', err);
    }
  };

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchBranches(false), fetchJobs(), fetchStats()]);
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
      fetchStats();
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

  // Tamaño total almacenado en Google Drive por respaldos de sucursales
  const totalDriveSizeBytes = useMemo(() => {
    if (stats?.total_drive_bytes !== undefined && stats.total_drive_bytes > 0) {
      return stats.total_drive_bytes;
    }
    // Suma de archivos completados o trabajos
    let sum = 0;
    jobs.forEach(j => {
      if (j.backup_files && j.backup_files.length > 0) {
        j.backup_files.forEach(f => {
          if (f.status === 'COMPLETED') sum += (f.file_size_bytes || 0);
        });
      } else if (j.status === 'COMPLETED') {
        sum += (j.total_size_bytes || 0);
      }
    });
    if (sum === 0) {
      sum = branches.reduce((acc, b) => acc + (b.last_backup_size_bytes || 0), 0);
    }
    return sum;
  }, [stats, jobs, branches]);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const activeJob = jobs.find(j => j.status === 'RUNNING' || j.status === 'PENDING');

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <FolderArchive className="h-6 w-6 text-blue-500" />
            Respaldo de Carpetas de Tiendas
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Empaquetado y subida en tiempo real de rutas de red UNC (<code className="bg-slate-900 border border-slate-800 text-blue-400 px-1.5 py-0.5 rounded font-mono text-[11px]">\\IP\Sistema\aBC-Soft</code>) directo a Google Drive (Zero-Disk en RAM).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncBranches}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-900 text-slate-300 hover:text-white rounded-lg border border-slate-800 hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            title="Sincronizar sucursales desde SQL Server Sistemas.dbo.Sucursal"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-blue-400 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar SQL Server'}
          </button>

          <button
            onClick={() => fetchBranches(true)}
            disabled={refreshingPing}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-900 text-slate-300 hover:text-white rounded-lg border border-slate-800 hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            title="Verificar estado de conexión en vivo (Ping SMB)"
          >
            <Wifi className={`h-3.5 w-3.5 text-emerald-400 ${refreshingPing ? 'animate-spin' : ''}`} />
            {refreshingPing ? 'Comprobando...' : 'Comprobar Red'}
          </button>

          <button
            onClick={() => openNewBackupModal()}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 rounded-lg shadow-lg shadow-blue-600/20 transition-all"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Nuevo Respaldo
          </button>
        </div>
      </div>

      {/* KPI Cards (Matches DashboardPage dark theme) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Sucursales */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Sucursales</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Folder className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-white tracking-tight">{branches.length}</div>
            <p className="text-[11px] text-slate-400 mt-1">Registradas en SQL Server</p>
          </div>
        </div>

        {/* Card 2: Sucursales Online */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Sucursales en Línea</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Wifi className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-emerald-400 tracking-tight">
              {onlineBranchesCount} / {branches.length}
            </div>
            <p className="text-[11px] text-emerald-400/80 mt-1 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Conexión SMB (Puerto 445) activa
            </p>
          </div>
        </div>

        {/* Card 3: Historial de Tareas */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Tareas Ejecutadas</span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FolderArchive className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-white tracking-tight">{jobs.length}</div>
            <p className="text-[11px] text-slate-400 mt-1">Historial registrado</p>
          </div>
        </div>

        {/* Card 4: Total Almacenado en Google Drive */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all shadow-lg relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total en Google Drive</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Cloud className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-emerald-400 tracking-tight">
              {formatBytes(totalDriveSizeBytes)}
            </div>
            <div className="mt-1 space-y-0.5">
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                Guardado en Drive por sucursal
              </p>
              <p className="text-[10px] text-amber-400/90 flex items-center gap-1 font-medium">
                <Zap className="w-3 h-3 text-amber-400 inline" />
                Consumo Disco C: 0 Bytes (Zero-Disk)
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Job Live Progress Banner */}
      {activeJob && (
        <div className="bg-gradient-to-r from-blue-900/40 via-slate-900 to-slate-900 border border-blue-500/30 rounded-xl p-5 shadow-2xl space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
              <h3 className="text-sm font-bold text-white">
                Respaldo de Carpetas Activo #{activeJob.id} • {activeJob.job_name}
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-blue-400">
              {activeJob.progress_percent}%
            </span>
          </div>

          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5">
            <div 
              className="bg-blue-500 h-full rounded-full transition-all duration-300" 
              style={{ width: `${Math.max(activeJob.progress_percent, 5)}%` }}
            />
          </div>

          <div className="flex justify-between text-xs text-slate-300">
            <span className="font-medium text-blue-300 truncate max-w-xl">{activeJob.current_step}</span>
            <span className="text-slate-400 font-mono">
              Tiendas: {activeJob.completed_branches || 0} / {activeJob.total_branches || 0}
            </span>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="border-b border-slate-800">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab('branches')}
            className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'branches'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Folder className="h-4 w-4" />
            Sucursales y Rutas UNC ({branches.length})
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="h-4 w-4" />
            Historial de Respaldos ({jobs.length})
            {activeJob && (
              <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping"></span>
            )}
          </button>
        </nav>
      </div>

      {/* Tab 1: Branches Table */}
      {activeTab === 'branches' && (
        <div className="space-y-4">
          {/* Action bar and search */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-900 border border-slate-800 p-3.5 rounded-xl shadow-lg">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por código (AK01), nombre o IP..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500 placeholder:text-slate-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSelectAll}
                className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition-colors"
              >
                {selectedBranchIds.length === filteredBranches.length ? 'Desmarcar Todas' : 'Seleccionar Todas'}
              </button>

              <button
                onClick={handleSelectAkBranches}
                className="px-2.5 py-1 text-xs font-medium text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg border border-blue-500/20 transition-colors"
              >
                Solo Tiendas Alkosto (AK)
              </button>

              {selectedBranchIds.length > 0 && (
                <button
                  onClick={() => openNewBackupModal()}
                  className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-md shadow-blue-600/20 flex items-center gap-1.5 transition-all"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Respaldar {selectedBranchIds.length} Seleccionada(s)
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={filteredBranches.length > 0 && selectedBranchIds.length === filteredBranches.length}
                        onChange={handleSelectAll}
                        className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="py-3 px-4">Código</th>
                    <th className="py-3 px-4">Sucursal / Nombre</th>
                    <th className="py-3 px-4">Ruta de Red UNC</th>
                    <th className="py-3 px-4 text-center">Estado Red</th>
                    <th className="py-3 px-4">Destino Drive / Respaldo</th>
                    <th className="py-3 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-500 mb-2" />
                        Cargando sucursales...
                      </td>
                    </tr>
                  ) : filteredBranches.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500">
                        No se encontraron sucursales. Haz clic en "Sincronizar SQL Server".
                      </td>
                    </tr>
                  ) : (
                    filteredBranches.map(branch => {
                      const isSelected = selectedBranchIds.includes(branch.id);
                      return (
                        <tr 
                          key={branch.id} 
                          className={`hover:bg-slate-800/40 transition-colors ${isSelected ? 'bg-blue-950/25 border-l-2 border-l-blue-500' : ''}`}
                        >
                          <td className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleBranchSelection(branch.id)}
                              className="rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-blue-400">
                            {branch.code}
                          </td>
                          <td className="py-3 px-4 font-medium text-white">
                            {branch.name}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono text-[11px] text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 inline-block">
                              {branch.unc_path}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {branch.is_online ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                ONLINE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                                <WifiOff className="h-3 w-3" />
                                OFFLINE
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <div className="space-y-1">
                              <div className="font-mono text-[10px] text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded border border-blue-900/50 inline-flex items-center gap-1">
                                <Cloud className="w-3 h-3 text-blue-400 flex-shrink-0" />
                                <span>CARPETAS_SUCURSALES/{branch.code} - {branch.name}</span>
                              </div>
                              {branch.last_backup_at ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-400 text-[11px]">{new Date(branch.last_backup_at).toLocaleString('es-ES')}</span>
                                  <span className="font-mono text-[11px] font-bold text-emerald-400">({formatBytes(branch.last_backup_size_bytes || 0)})</span>
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-500">Sin respaldos previos</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => openNewBackupModal(branch.id)}
                              className="px-2.5 py-1 text-[11px] font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded border border-blue-500/20 inline-flex items-center gap-1 transition-colors"
                              title="Respaldar esta carpeta"
                            >
                              <Play className="h-3 w-3 fill-current" />
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800 uppercase tracking-wider text-[11px]">
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
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        Aún no se han ejecutado respaldos de carpetas.
                      </td>
                    </tr>
                  ) : (
                    jobs.map(job => {
                      const isRunning = job.status === 'RUNNING' || job.status === 'PENDING';
                      return (
                        <tr key={job.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 font-mono text-slate-400 font-bold">#{job.id}</td>
                          <td className="py-3 px-4 font-medium text-white">{job.job_name}</td>
                          <td className="py-3 px-4 text-center">
                            {job.status === 'COMPLETED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <CheckCircle className="h-3 w-3" /> Completado
                              </span>
                            )}
                            {isRunning && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">
                                <RefreshCw className="h-3 w-3 animate-spin" /> En Curso
                              </span>
                            )}
                            {job.status === 'FAILED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                                <AlertCircle className="h-3 w-3" /> Fallido
                              </span>
                            )}
                            {job.status === 'INTERRUPTED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                <Clock className="h-3 w-3" /> Interrumpido
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 min-w-[220px]">
                            <div className="w-full bg-slate-800 rounded-full h-2 mb-1.5 overflow-hidden">
                              <div 
                                className={`h-2 rounded-full transition-all duration-300 ${
                                  job.status === 'FAILED' ? 'bg-red-500' : isRunning ? 'bg-blue-500' : 'bg-emerald-500'
                                }`} 
                                style={{ width: `${job.progress_percent || 0}%` }}
                              ></div>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate max-w-xs" title={job.current_step}>
                              {job.current_step}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-center font-mono font-medium text-slate-200">
                            {job.completed_branches || 0} / {job.total_branches || 0}
                          </td>
                          <td className="py-3 px-4 font-mono font-medium text-emerald-400">
                            {formatBytes(job.total_size_bytes || 0)}
                          </td>
                          <td className="py-3 px-4 text-slate-400 text-xs">
                            {new Date(job.created_at).toLocaleString('es-ES')}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5">
                            {(job.status === 'FAILED' || job.status === 'INTERRUPTED') && (
                              <button
                                onClick={() => handleResumeJob(job.id)}
                                className="p-1.5 text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 rounded-md transition-colors"
                                title="Reanudar tarea con Checkpoints"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => setSelectedJobForFiles(job)}
                              className="p-1.5 text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 rounded-md transition-colors"
                              title="Ver archivos respaldados en Google Drive"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={() => handleDeleteJob(job.id)}
                              className="p-1.5 text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-md transition-colors"
                              title="Eliminar tarea"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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

      {/* Modal: New Folder Backup (Styled Dark) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 max-w-lg w-full overflow-hidden text-slate-100">
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/40">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <FolderArchive className="h-5 w-5 text-blue-500" />
                Configurar Respaldo de Carpetas
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Nombre de la Tarea
                </label>
                <input
                  type="text"
                  value={jobName}
                  onChange={e => setJobName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Sucursales Seleccionadas ({selectedBranchIds.length})
                </label>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 max-h-24 overflow-y-auto flex flex-wrap gap-1.5">
                  {selectedBranchIds.length === 0 ? (
                    <span className="text-red-400">Ninguna sucursal seleccionada.</span>
                  ) : (
                    selectedBranchIds.map(id => {
                      const b = branches.find(x => x.id === id);
                      return (
                        <span key={id} className="bg-slate-900 text-blue-300 px-2 py-0.5 rounded border border-slate-800 font-mono text-[11px]">
                          {b ? `${b.code} (${b.name})` : id}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Alcance del Respaldo (Filtro de Subcarpetas)
                </label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                    folderScope === 'critical' ? 'bg-blue-950/20 border-blue-500/40' : 'bg-slate-950/50 border-slate-800 hover:bg-slate-800/40'
                  }`}>
                    <input
                      type="radio"
                      name="folderScope"
                      checked={folderScope === 'critical'}
                      onChange={() => setFolderScope('critical')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="text-xs font-semibold text-white">Subcarpetas Críticas (Recomendado)</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Respalda únicamente <code className="text-blue-400 font-mono">Data, Datos, DataSQL, Formularios</code>. Omite archivos gigantescos como Cierre_POS para máxima rapidez.
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                    folderScope === 'all' ? 'bg-blue-950/20 border-blue-500/40' : 'bg-slate-950/50 border-slate-800 hover:bg-slate-800/40'
                  }`}>
                    <input
                      type="radio"
                      name="folderScope"
                      checked={folderScope === 'all'}
                      onChange={() => setFolderScope('all')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <p className="text-xs font-semibold text-white">Directorio Completo (Todo aBC-Soft)</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Empaqueta absolutamente todos los archivos y subdirectorios de la tienda (puede pesar más de 100 GB).
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                    folderScope === 'custom' ? 'bg-blue-950/20 border-blue-500/40' : 'bg-slate-950/50 border-slate-800 hover:bg-slate-800/40'
                  }`}>
                    <input
                      type="radio"
                      name="folderScope"
                      checked={folderScope === 'custom'}
                      onChange={() => setFolderScope('custom')}
                      className="mt-0.5 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="w-full">
                      <p className="text-xs font-semibold text-white">Personalizado</p>
                      {folderScope === 'custom' && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {commonSubfolders.map(sf => (
                            <label key={sf} className="inline-flex items-center gap-1.5 text-[11px] bg-slate-900 border border-slate-800 px-2 py-1 rounded cursor-pointer text-slate-300">
                              <input
                                type="checkbox"
                                checked={customSubfolders.includes(sf)}
                                onChange={e => {
                                  if (e.target.checked) setCustomSubfolders([...customSubfolders, sf]);
                                  else setCustomSubfolders(customSubfolders.filter(x => x !== sf));
                                }}
                                className="rounded text-blue-600"
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

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <span><strong>Zero-Disk Streaming:</strong> Los datos viajan por RAM directo a Google Drive en <code className="font-mono text-blue-200">.tar.gz</code> sin consumir disco local C:.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800 bg-slate-950/40">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg border border-slate-800 hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStartBackup}
                disabled={startingJob || selectedBranchIds.length === 0}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-lg shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2 transition-all"
              >
                {startingJob ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                {startingJob ? 'Iniciando...' : 'Iniciar Respaldo en Drive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Files in Job (Styled Dark) */}
      {selectedJobForFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden text-slate-100">
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/40">
              <div>
                <h3 className="font-semibold text-white text-sm">
                  Archivos en Google Drive • #{selectedJobForFiles.id} {selectedJobForFiles.job_name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Total Respaldado: <span className="font-mono text-emerald-400 font-semibold">{formatBytes(selectedJobForFiles.total_size_bytes || 0)}</span>
                </p>
              </div>
              <button 
                onClick={() => setSelectedJobForFiles(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
              {(!selectedJobForFiles.backup_files || selectedJobForFiles.backup_files.length === 0) ? (
                <p className="text-center py-8 text-xs text-slate-500">
                  No hay archivos completados aún para esta tarea.
                </p>
              ) : (
                selectedJobForFiles.backup_files.map(file => (
                  <div 
                    key={file.id} 
                    className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:border-slate-700 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-mono">
                          {file.branch_code}
                        </span>
                        <span className="text-xs font-semibold text-white font-mono">
                          {file.file_name}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 font-mono">
                        Drive: {file.google_drive_path}
                      </p>
                      {file.sha256_checksum && (
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                          SHA-256: {file.sha256_checksum.slice(0, 24)}...
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="font-mono font-bold text-xs text-emerald-400">
                        {formatBytes(file.file_size_bytes)}
                      </span>
                      <p className="text-[10px] text-emerald-400/90 font-medium flex items-center gap-1 justify-end mt-0.5">
                        <CheckCircle className="h-3 w-3" /> Subido a Drive
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 bg-slate-950/40 border-t border-slate-800 text-right">
              <button
                onClick={() => setSelectedJobForFiles(null)}
                className="px-4 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
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
