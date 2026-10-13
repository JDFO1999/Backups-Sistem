import React, { useState, useEffect } from 'react';
import { 
  Archive, RefreshCw, Trash2, Filter, RotateCcw, AlertTriangle, 
  CheckCircle, Database, Server as ServerIcon, ShieldAlert, Clock, Play
} from 'lucide-react';

import { api } from '../services/api';
import { BackupJob, BackupFile, RestoreJob, Server } from '../types';
import { showToast, showConfirm } from '../utils/toast';

export const BackupsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'backups' | 'restores'>('backups');
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [restoreJobs, setRestoreJobs] = useState<RestoreJob[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<BackupJob | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Restore Modal State
  const [restoreModalFile, setRestoreModalFile] = useState<BackupFile | null>(null);
  const [restoreTargetServerId, setRestoreTargetServerId] = useState<number>(0);
  const [restoreTargetDbName, setRestoreTargetDbName] = useState<string>('');
  const [restoreOverwrite, setRestoreOverwrite] = useState<boolean>(false);
  const [submittingRestore, setSubmittingRestore] = useState<boolean>(false);

  const fetchJobs = async () => {
    try {
      const params: any = {};
      if (statusFilter !== 'ALL') params.status_filter = statusFilter;
      const res = await api.get('/backups', { params });
      setJobs(res.data);
    } catch (err: any) {
      console.error('Error fetching backup jobs:', err);
    }
  };

  const fetchRestores = async () => {
    try {
      const res = await api.get('/backups/restores');
      setRestoreJobs(res.data);
    } catch (err: any) {
      console.error('Error fetching restores:', err);
    }
  };

  const fetchServers = async () => {
    try {
      const res = await api.get('/servers');
      setServers(res.data);
    } catch (err: any) {
      console.error('Error fetching servers:', err);
    }
  };

  const loadData = async () => {
    await Promise.all([fetchJobs(), fetchRestores(), fetchServers()]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      fetchJobs();
      fetchRestores();
    }, 4000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  const handleDeleteJob = async (id: number) => {
    const confirmed = await showConfirm(
      '¿Eliminar Backup?',
      `Se eliminará el registro #${id} y los archivos respaldados correspondientes en Google Drive.`,
      'Sí, eliminar'
    );
    if (!confirmed) return;

    try {
      await api.delete(`/backups/${id}`);
      showToast.success(`Backup #${id} y archivos en Google Drive eliminados`);
      fetchJobs();
      if (selectedJob?.id === id) setSelectedJob(null);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error eliminando backup.');
    }
  };

  const handleResumeJob = async (id: number) => {
    try {
      await api.post(`/backups/${id}/resume`);
      showToast.success(`Reanudando backup #${id} desde el último punto de control...`);
      fetchJobs();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al reanudar backup.');
    }
  };


  const handleOpenRestoreModal = (file: BackupFile, defaultServerId?: number) => {
    setRestoreModalFile(file);
    const initialServerId = defaultServerId || (servers.length > 0 ? servers[0].id : 0);
    setRestoreTargetServerId(initialServerId);
    
    // Suggest default restored database name
    const rawDb = file.database_name || 'db';
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    setRestoreTargetDbName(`${rawDb}_restored_${timestamp}`);
    setRestoreOverwrite(false);
  };

  const handleExecuteRestore = async () => {
    if (!restoreModalFile) return;

    if (!restoreTargetDbName.trim()) {
      showToast.error('Por favor especifique el nombre de la base de datos destino.');
      return;
    }

    if (restoreOverwrite) {
      const confirmed = await showConfirm(
        '⚠️ Confirmar Sobrescritura de Base de Datos',
        `Ha seleccionado sobrescribir. Si la base de datos '${restoreTargetDbName}' existe en el servidor destino, sus tablas y datos actuales serán REEMPLAZADOS por el backup. ¿Desea continuar?`,
        'Sí, proceder con la restauración'
      );
      if (!confirmed) return;
    }

    setSubmittingRestore(true);
    try {
      const res = await api.post(`/backups/files/${restoreModalFile.id}/restore`, {
        target_server_id: restoreTargetServerId,
        target_database_name: restoreTargetDbName.trim(),
        overwrite: restoreOverwrite
      });

      showToast.success(`Tarea de restauración #${res.data.id} iniciada en segundo plano.`);
      setRestoreModalFile(null);
      setActiveTab('restores');
      fetchRestores();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error iniciando restauración.');
    } finally {
      setSubmittingRestore(false);
    }
  };

  const activeBackup = jobs.find(j => j.status === 'RUNNING' || j.status === 'PENDING');
  const activeRestore = restoreJobs.find(r => r.status === 'RUNNING' || r.status === 'PENDING');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Gestión de Backups y Restauración</h1>
          <p className="text-xs text-slate-400">Supervise tareas de respaldo y restaure bases de datos asistidamente</p>
        </div>

        {/* Tab switchers and filter */}
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-xl">
            <button
              onClick={() => setActiveTab('backups')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'backups'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Backups ({jobs.length})
            </button>
            <button
              onClick={() => setActiveTab('restores')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'restores'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restauraciones ({restoreJobs.length})
              {activeRestore && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              )}
            </button>
          </div>

          {activeTab === 'backups' && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-xs text-white rounded-lg px-3 py-1.5 focus:outline-none"
              >
                <option value="ALL">Todos los Estados</option>
                <option value="COMPLETED">Completados</option>
                <option value="RUNNING">En Ejecución</option>
                <option value="INTERRUPTED">Interrumpidos</option>
                <option value="FAILED">Fallidos</option>
              </select>

            </div>
          )}
        </div>
      </div>

      {/* Active Backup Progress Card */}
      {activeBackup && (
        <div className="bg-gradient-to-r from-blue-900/40 via-slate-900 to-slate-900 border border-blue-500/30 rounded-xl p-5 shadow-2xl space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
              <h3 className="text-sm font-bold text-white">
                Backup Activo #{activeBackup.id} • Servidor: {activeBackup.server_name}
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-blue-400">
              {activeBackup.progress_percent}%
            </span>
          </div>

          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5">
            <div 
              className="bg-blue-500 h-full rounded-full transition-all duration-300" 
              style={{ width: `${Math.max(activeBackup.progress_percent, 5)}%` }}
            />
          </div>

          <div className="flex justify-between text-xs text-slate-300">
            <span className="font-medium text-blue-300">{activeBackup.current_step}</span>
            <span className="text-slate-400">
              Iniciado: {activeBackup.started_at ? new Date(activeBackup.started_at).toLocaleTimeString('es-ES') : 'En cola'}
            </span>
          </div>
        </div>
      )}

      {/* Active Restore Progress Card */}
      {activeRestore && (
        <div className="bg-gradient-to-r from-emerald-950/50 via-slate-900 to-slate-900 border border-emerald-500/40 rounded-xl p-5 shadow-2xl space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-emerald-400 animate-spin" />
              <h3 className="text-sm font-bold text-white">
                Restauración Activa #{activeRestore.id} • BD Destino: <span className="text-emerald-400 font-mono">{activeRestore.target_database_name}</span> ({activeRestore.target_server_name})
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-emerald-400">
              {activeRestore.progress_percent}%
            </span>
          </div>

          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden p-0.5">
            <div 
              className="bg-emerald-500 h-full rounded-full transition-all duration-300" 
              style={{ width: `${Math.max(activeRestore.progress_percent, 5)}%` }}
            />
          </div>

          <div className="flex justify-between text-xs text-slate-300">
            <span className="font-medium text-emerald-300">{activeRestore.current_step}</span>
            <span className="text-slate-400">
              Iniciado: {activeRestore.started_at ? new Date(activeRestore.started_at).toLocaleTimeString('es-ES') : 'En proceso'}
            </span>
          </div>
        </div>
      )}

      {/* TAB 1: BACKUPS HISTORY TABLE */}
      {activeTab === 'backups' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">Fecha</th>
                  <th className="py-3 px-4">Servidor</th>
                  <th className="py-3 px-4">Tipo</th>
                  <th className="py-3 px-4">Archivos</th>
                  <th className="py-3 px-4">Tamaño Comprimido</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-500 mb-2" />
                      Cargando historial...
                    </td>
                  </tr>
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No se han registrado backups con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  jobs.map(job => (
                    <tr key={job.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-400">#{job.id}</td>
                      <td className="py-3 px-4 text-slate-300">
                        {new Date(job.created_at).toLocaleString('es-ES')}
                      </td>
                      <td className="py-3 px-4 text-white font-semibold">{job.server_name}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800">
                          {job.trigger_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {job.files ? job.files.length : 0} BDs
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-emerald-400">
                        {job.total_compressed_size_bytes > 0 
                          ? `${(job.total_compressed_size_bytes / (1024*1024)).toFixed(1)} MB` 
                          : '-'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`
                          inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold
                          ${job.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            job.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            job.status === 'INTERRUPTED' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            job.status === 'FAILED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            'bg-slate-800 text-slate-400'}
                        `}>
                          {job.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {(job.status === 'INTERRUPTED' || job.status === 'FAILED') && (
                          <button
                            onClick={() => handleResumeJob(job.id)}
                            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-[11px] font-semibold border border-amber-500/30 inline-flex items-center gap-1 shadow-sm transition-colors"
                            title="Reanudar backup desde el último punto de control"
                          >
                            <Play className="w-3 h-3 fill-current" /> Reanudar
                          </button>
                        )}
                        {job.files && job.files.length === 1 && (
                          <button
                            onClick={() => handleOpenRestoreModal(job.files[0], job.server_id)}
                            className="px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-[11px] font-semibold border border-blue-500/30 inline-flex items-center gap-1"
                            title="Restaurar base de datos"
                          >
                            <RotateCcw className="w-3 h-3" /> Restaurar
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedJob(job)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium"
                        >
                          Detalles
                        </button>
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          title="Eliminar Backup"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: RESTORES HISTORY TABLE */}
      {activeTab === 'restores' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">Fecha</th>
                  <th className="py-3 px-4">Archivo Origen</th>
                  <th className="py-3 px-4">Servidor Destino</th>
                  <th className="py-3 px-4">Base de Datos Destino</th>
                  <th className="py-3 px-4">Sobrescritura</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4">Paso / Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {restoreJobs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No se han ejecutado restauraciones todavía.
                    </td>
                  </tr>
                ) : (
                  restoreJobs.map(res => (
                    <tr key={res.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-400">#{res.id}</td>
                      <td className="py-3 px-4 text-slate-300">
                        {new Date(res.created_at).toLocaleString('es-ES')}
                      </td>
                      <td className="py-3 px-4 font-mono text-blue-400 truncate max-w-xs" title={res.file_name}>
                        {res.file_name}
                      </td>
                      <td className="py-3 px-4 text-white font-semibold">
                        {res.target_server_name}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                        {res.target_database_name}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          res.overwrite ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {res.overwrite ? 'Sobrescritura' : 'Creación'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`
                          inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold
                          ${res.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            res.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            res.status === 'FAILED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            'bg-slate-800 text-slate-400'}
                        `}>
                          {res.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300 max-w-md">
                        {res.error_message ? (
                          <span className="text-red-400 text-[11px]" title={res.error_message}>
                            {res.error_message.slice(0, 70)}...
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">{res.current_step}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: DETALLES DE BACKUP JOB */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Archive className="w-5 h-5 text-blue-500" />
                Detalles del Backup #{selectedJob.id}
              </h3>
              <button onClick={() => setSelectedJob(null)} className="text-slate-400 text-sm hover:text-white">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-400">Servidor:</span>
                <p className="font-semibold text-white mt-0.5">{selectedJob.server_name}</p>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <span className="text-slate-400">Estado Final:</span>
                <p className="font-semibold text-white mt-0.5">{selectedJob.status}</p>
              </div>
            </div>

            {selectedJob.error_message && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 text-xs rounded-lg">
                <strong>Error registrado:</strong> {selectedJob.error_message}
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-2">Archivos Respaldados en Google Drive</h4>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {selectedJob.files && selectedJob.files.length > 0 ? (
                  selectedJob.files.map((file, i) => (
                    <div key={i} className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-semibold text-blue-400">{file.file_name}</span>
                        <span className="text-emerald-400 font-mono font-bold">{file.file_size_formatted}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        Google Drive Path: <span className="text-slate-300 font-mono">{file.google_drive_path}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate font-mono">
                        SHA-256: {file.sha256_checksum || 'N/A'}
                      </div>
                      <div className="pt-2 border-t border-slate-900 flex justify-end">
                        <button
                          onClick={() => {
                            setSelectedJob(null);
                            handleOpenRestoreModal(file, selectedJob.server_id);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restaurar Base de Datos
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No se completaron archivos en este job.</p>
                )}
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
              {(selectedJob.status === 'INTERRUPTED' || selectedJob.status === 'FAILED') && (
                <button
                  onClick={() => {
                    handleResumeJob(selectedJob.id);
                    setSelectedJob(null);
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center gap-1.5 shadow-md transition-colors"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Reanudar Backup
                </button>
              )}
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:text-white"
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL: RESTAURACIÓN ASISTIDA */}
      {restoreModalFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-blue-400" />
                Restauración Asistida de Base de Datos
              </h3>
              <button 
                onClick={() => setRestoreModalFile(null)} 
                className="text-slate-400 text-sm hover:text-white"
                disabled={submittingRestore}
              >
                ✕
              </button>
            </div>

            {/* Source Backup Overview Card */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
              <div className="text-slate-400 font-medium">Archivo de Respaldo Origen:</div>
              <div className="font-mono text-sm font-bold text-blue-400 truncate">
                {restoreModalFile.file_name}
              </div>
              <div className="flex justify-between text-slate-300 pt-1">
                <span>Base Original: <strong>{restoreModalFile.database_name}</strong></span>
                <span className="text-emerald-400 font-mono font-semibold">{restoreModalFile.file_size_formatted}</span>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Servidor Destino
                </label>
                <select
                  value={restoreTargetServerId}
                  onChange={e => setRestoreTargetServerId(Number(e.target.value))}
                  disabled={submittingRestore}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
                >
                  {servers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.host} - {s.os_type || 'LINUX'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Servidor donde se descargará y aplicará el respaldo.
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Nombre de la Base de Datos Destino
                </label>
                <input
                  type="text"
                  value={restoreTargetDbName}
                  onChange={e => setRestoreTargetDbName(e.target.value)}
                  disabled={submittingRestore}
                  placeholder="ej. BD_Tiendas_restored"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Puede restaurar sobre el mismo nombre o especificar un nuevo nombre para crear una copia aislada.
                </p>
              </div>

              <div className="pt-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreOverwrite}
                    onChange={e => setRestoreOverwrite(e.target.checked)}
                    disabled={submittingRestore}
                    className="mt-0.5 rounded bg-slate-950 border-slate-800 text-blue-600 focus:ring-0"
                  />
                  <div>
                    <span className="font-semibold text-white">Sobrescribir base de datos si ya existe</span>
                    <p className="text-[11px] text-slate-400">
                      Permite reemplazar completamente una base de datos existente en el servidor.
                    </p>
                  </div>
                </label>
              </div>

              {restoreOverwrite && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-relaxed">
                    <strong>Precaución de Sobrescritura:</strong> Si '{restoreTargetDbName}' ya existe, todos los datos actuales serán eliminados y sustituidos por este respaldo.
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="pt-3 flex justify-end gap-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setRestoreModalFile(null)}
                disabled={submittingRestore}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={submittingRestore}
                className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 shadow-lg shadow-blue-600/30 disabled:opacity-50"
              >
                {submittingRestore ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Iniciando...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Iniciar Restauración Asistida
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupsPage;
