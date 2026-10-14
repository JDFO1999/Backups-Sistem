import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, Plus, Trash2, RefreshCw, Play, Pause, Clock, 
  Database, FolderArchive, Layers, ShieldCheck, Zap, AlertCircle, 
  Search, Check, Filter
} from 'lucide-react';
import { schedulesApi, foldersApi, api } from '../services/api';
import { BackupSchedule, Server as IServer, Database as IDatabase, Branch } from '../types';
import { showToast, showConfirm } from '../utils/toast';

type ScheduleType = 'DATABASE' | 'FOLDER';
type FrequencyMode = 'daily_time' | 'interval_hours' | 'days_of_week' | 'custom_cron';

export const SchedulesPage: React.FC = () => {
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [servers, setServers] = useState<IServer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DATABASE' | 'FOLDER'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('DATABASE');
  
  // Database Schedule State
  const [serverId, setServerId] = useState<number | null>(null);
  const [databases, setDatabases] = useState<IDatabase[]>([]);
  const [selectedDbIds, setSelectedDbIds] = useState<number[]>([]);
  
  // Folder Schedule State
  const [folderScope, setFolderScope] = useState<'critical' | 'all'>('critical');
  const [branchSelectionMode, setBranchSelectionMode] = useState<'all' | 'ak_only' | 'custom'>('all');
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);
  const [branchSearch, setBranchSearch] = useState('');

  // Frequency State
  const [frequencyMode, setFrequencyMode] = useState<FrequencyMode>('daily_time');
  const [dailyTime, setDailyTime] = useState('23:00');
  const [intervalHours, setIntervalHours] = useState(4);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [customCron, setCustomCron] = useState('0 23 * * *');

  // Retention State
  const [retentionCount, setRetentionCount] = useState(7);
  const [retentionDays, setRetentionDays] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  // Compute Cron based on frequency mode
  const computedCron = useMemo(() => {
    if (frequencyMode === 'daily_time') {
      const [hh, mm] = dailyTime.split(':');
      return `${parseInt(mm || '0', 10)} ${parseInt(hh || '0', 10)} * * *`;
    }
    if (frequencyMode === 'interval_hours') {
      return `0 */${intervalHours} * * *`;
    }
    if (frequencyMode === 'days_of_week') {
      const [hh, mm] = dailyTime.split(':');
      const daysStr = selectedDays.length > 0 ? selectedDays.sort((a,b) => a - b).join(',') : '*';
      return `${parseInt(mm || '0', 10)} ${parseInt(hh || '0', 10)} * * ${daysStr}`;
    }
    return customCron;
  }, [frequencyMode, dailyTime, intervalHours, selectedDays, customCron]);

  const fetchSchedules = async () => {
    try {
      const res = await schedulesApi.list();
      setSchedules(res.data);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al cargar programaciones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();

    // Load servers
    api.get('/servers').then(res => {
      setServers(res.data);
      if (res.data.length > 0) setServerId(res.data[0].id);
    }).catch(() => {});

    // Load branches
    foldersApi.getBranches().then(res => {
      setBranches(res.data);
    }).catch(() => {});
  }, []);

  // When server changes, load databases
  useEffect(() => {
    if (serverId && scheduleType === 'DATABASE') {
      api.get(`/databases/server/${serverId}`).then(res => {
        setDatabases(res.data);
        setSelectedDbIds(res.data.map((d: IDatabase) => d.id));
      }).catch(() => {});
    }
  }, [serverId, scheduleType]);

  const formatCronText = (cron: string): string => {
    if (!cron) return 'No especificado';
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return cron;
    const [min, hour, dom, mon, dow] = parts;

    // Check interval: 0 */N * * *
    if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
      const interval = hour.replace('*/', '');
      return `Cada ${interval} horas (diariamente)`;
    }
    // Check daily at time: MM HH * * *
    if (dom === '*' && mon === '*' && dow === '*' && !hour.includes('*') && !min.includes('*')) {
      const hh = hour.padStart(2, '0');
      const mm = min.padStart(2, '0');
      return `Diariamente a las ${hh}:${mm}`;
    }
    // Check weekdays: MM HH * * 1-5 or 1,2,3,4,5
    if (dom === '*' && mon === '*' && (dow === '1-5' || dow === '1,2,3,4,5')) {
      const hh = hour.padStart(2, '0');
      const mm = min.padStart(2, '0');
      return `Lunes a Viernes a las ${hh}:${mm}`;
    }
    // Check sunday
    if (dom === '*' && mon === '*' && (dow === '0' || dow === '7')) {
      const hh = hour.padStart(2, '0');
      const mm = min.padStart(2, '0');
      return `Domingos a las ${hh}:${mm}`;
    }

    return `Expresión: ${cron}`;
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast.warning('Ingrese un nombre para la programación');
      return;
    }

    if (scheduleType === 'DATABASE' && !serverId) {
      showToast.warning('Seleccione un servidor para respaldar');
      return;
    }

    setSubmitting(true);

    let targetBranchIds: number[] | null = null;
    if (scheduleType === 'FOLDER') {
      if (branchSelectionMode === 'ak_only') {
        targetBranchIds = branches.filter(b => b.branch_code.toUpperCase().startsWith('AK')).map(b => b.id);
      } else if (branchSelectionMode === 'custom') {
        if (selectedBranchIds.length === 0) {
          showToast.warning('Seleccione al menos una tienda para respaldar');
          setSubmitting(false);
          return;
        }
        targetBranchIds = selectedBranchIds;
      } else {
        // all active branches: send empty array or all
        targetBranchIds = branches.map(b => b.id);
      }
    }

    try {
      await schedulesApi.create({
        name,
        schedule_type: scheduleType,
        server_id: scheduleType === 'DATABASE' ? serverId : null,
        database_ids: scheduleType === 'DATABASE' ? selectedDbIds : [],
        target_branch_ids: targetBranchIds || undefined,
        folder_scope: folderScope,
        cron_expression: computedCron,
        compression_type: 'GZIP',
        retention_count: retentionCount,
        retention_days: retentionDays,
        is_active: true
      });

      showToast.success(`Programación "${name}" guardada con éxito`);
      setIsModalOpen(false);
      resetForm();
      fetchSchedules();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error creando programación');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setName('');
    setScheduleType('DATABASE');
    setFrequencyMode('daily_time');
    setDailyTime('23:00');
    setIntervalHours(4);
    setSelectedDays([1, 2, 3, 4, 5]);
    setCustomCron('0 23 * * *');
    setFolderScope('critical');
    setBranchSelectionMode('all');
    setSelectedBranchIds([]);
    setRetentionCount(7);
    setRetentionDays(30);
  };

  const handleToggleSchedule = async (id: number, currentActive: boolean) => {
    try {
      await schedulesApi.toggle(id);
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, is_active: !currentActive } : s));
      showToast.success(`Programación ${!currentActive ? 'activada' : 'pausada'}`);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error actualizando estado');
    }
  };

  const handleTriggerSchedule = async (id: number, scheduleName: string) => {
    const confirmed = await showConfirm(
      '¿Ejecutar Respaldo Ahora?',
      `Se iniciará de inmediato el respaldo programado "${scheduleName}".`,
      'Sí, ejecutar ahora'
    );
    if (!confirmed) return;

    setTriggeringId(id);
    try {
      const res = await schedulesApi.trigger(id);
      showToast.success(res.data.message || 'Respaldo iniciado correctamente');
      fetchSchedules();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error ejecutando respaldo');
    } finally {
      setTriggeringId(null);
    }
  };

  const handleDeleteSchedule = async (id: number, scheduleName: string) => {
    const confirmed = await showConfirm(
      '¿Eliminar Programación?',
      `Se cancelará la programación automática "${scheduleName}".`,
      'Sí, eliminar'
    );
    if (!confirmed) return;

    try {
      await schedulesApi.delete(id);
      showToast.success(`Programación "${scheduleName}" eliminada`);
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error eliminando programación');
    }
  };

  // Filtered schedules list
  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const matchesType = typeFilter === 'ALL' || (s.schedule_type || 'DATABASE') === typeFilter;
      const matchesSearch = !searchQuery.trim() || 
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.server_name && s.server_name.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesType && matchesSearch;
    });
  }, [schedules, typeFilter, searchQuery]);

  const filteredBranches = useMemo(() => {
    if (!branchSearch.trim()) return branches;
    const q = branchSearch.toLowerCase();
    return branches.filter(b => b.branch_code.toLowerCase().includes(q) || b.branch_name.toLowerCase().includes(q));
  }, [branches, branchSearch]);

  const toggleDay = (day: number) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const toggleBranch = (branchId: number) => {
    setSelectedBranchIds(prev => 
      prev.includes(branchId) ? prev.filter(id => id !== branchId) : [...prev, branchId]
    );
  };

  const selectAllBranches = () => {
    setSelectedBranchIds(branches.map(b => b.id));
  };

  const deselectAllBranches = () => {
    setSelectedBranchIds([]);
  };

  const toggleDb = (dbId: number) => {
    setSelectedDbIds(prev => 
      prev.includes(dbId) ? prev.filter(id => id !== dbId) : [...prev, dbId]
    );
  };

  const selectAllDbs = () => {
    setSelectedDbIds(databases.map(d => d.id));
  };

  const deselectAllDbs = () => {
    setSelectedDbIds([]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            Programaciones y Retención
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatice backups por hora o día para bases de datos BC y carpetas de tiendas con depuración periódica en Drive
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg shadow-blue-600/20 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nueva Programación
        </button>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row gap-3 justify-between items-center">
        <div className="flex items-center gap-1.5 w-full md:w-auto">
          <button
            onClick={() => setTypeFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              typeFilter === 'ALL'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            Todas ({schedules.length})
          </button>
          <button
            onClick={() => setTypeFilter('DATABASE')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              typeFilter === 'DATABASE'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-blue-400" />
            Bases de Datos BC ({schedules.filter(s => (s.schedule_type || 'DATABASE') === 'DATABASE').length})
          </button>
          <button
            onClick={() => setTypeFilter('FOLDER')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              typeFilter === 'FOLDER'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                : 'bg-slate-800/80 text-slate-400 hover:text-white'
            }`}
          >
            <FolderArchive className="w-3.5 h-3.5 text-purple-400" />
            Carpetas Tiendas ({schedules.filter(s => s.schedule_type === 'FOLDER').length})
          </button>
        </div>

        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por nombre..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Grid of Schedules */}
      {loading ? (
        <div className="flex justify-center p-12">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : filteredSchedules.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
          <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white">No hay programaciones encontradas</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery 
              ? 'No coincide ninguna programación con la búsqueda actual.' 
              : 'Configure respaldos recurrentes diarios o por horas para BC o Carpetas de tiendas.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSchedules.map(sched => {
            const isFolder = sched.schedule_type === 'FOLDER';
            return (
              <div 
                key={sched.id} 
                className="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-xl p-5 shadow-lg flex flex-col justify-between transition-all"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                          isFolder 
                            ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' 
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          {isFolder ? <FolderArchive className="w-3 h-3" /> : <Database className="w-3 h-3" />}
                          {isFolder ? 'Carpetas Tiendas' : 'Base de Datos BC'}
                        </span>
                      </div>
                      <h3 className="font-semibold text-white text-sm line-clamp-1">{sched.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {isFolder 
                          ? `${sched.folder_scope === 'critical' ? 'Carpetas Críticas' : 'Respaldo Completo'} (${sched.target_branch_ids && sched.target_branch_ids.length > 0 ? `${sched.target_branch_ids.length} Tiendas` : 'Todas las tiendas'})`
                          : `${sched.server_name || 'Servidor SQL'} (${sched.database_ids && sched.database_ids.length > 0 ? `${sched.database_ids.length} BDs` : 'Todas las BDs'})`
                        }
                      </p>
                    </div>

                    <button
                      onClick={() => handleToggleSchedule(sched.id, sched.is_active)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        sched.is_active 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20' 
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                      title={sched.is_active ? 'Clic para pausar' : 'Clic para activar'}
                    >
                      {sched.is_active ? 'ACTIVO' : 'PAUSADO'}
                    </button>
                  </div>

                  {/* Card Details */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        Frecuencia:
                      </span>
                      <span className="font-medium text-slate-200 text-right">
                        {formatCronText(sched.cron_expression)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Expresión Cron:</span>
                      <span className="font-mono text-[11px] text-blue-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {sched.cron_expression}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                        Retención:
                      </span>
                      <span className="text-slate-300">
                        Últimos {sched.retention_count} ({sched.retention_days} días)
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Próxima Ejecución:</span>
                      <span className="text-slate-300 font-mono text-[11px]">
                        {sched.next_run_at ? new Date(sched.next_run_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'Pendiente'}
                      </span>
                    </div>

                    {sched.last_run_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Última Ejecución:</span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {new Date(sched.last_run_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between">
                  <button
                    onClick={() => handleTriggerSchedule(sched.id, sched.name)}
                    disabled={triggeringId === sched.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                    title="Ejecutar este respaldo inmediatamente"
                  >
                    {triggeringId === sched.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>Ejecutar Ahora</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleSchedule(sched.id, sched.is_active)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      title={sched.is_active ? 'Pausar programación' : 'Activar programación'}
                    >
                      {sched.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 text-emerald-400" />}
                    </button>
                    <button
                      onClick={() => handleDeleteSchedule(sched.id, sched.name)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                      title="Eliminar Programación"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Nueva Programación */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-500" />
                <h3 className="text-base font-bold text-white">Nueva Programación de Backup</h3>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="text-slate-400 hover:text-white text-lg p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} className="flex flex-col flex-1 overflow-hidden">
            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              {/* Paso 1: Tipo de Respaldo */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  1. Seleccione Tipo de Respaldo
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    onClick={() => setScheduleType('DATABASE')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      scheduleType === 'DATABASE'
                        ? 'bg-blue-600/10 border-blue-500 text-white shadow-lg shadow-blue-500/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className={`p-2 rounded-lg ${scheduleType === 'DATABASE' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Base de Datos BC</h4>
                        <p className="text-[11px] text-slate-400">Instancias SQL Server</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Genera archivos .bak comprimidos directo a Google Drive.
                    </p>
                  </div>

                  <div
                    onClick={() => setScheduleType('FOLDER')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      scheduleType === 'FOLDER'
                        ? 'bg-purple-600/10 border-purple-500 text-white shadow-lg shadow-purple-500/10'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div className={`p-2 rounded-lg ${scheduleType === 'FOLDER' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                        <FolderArchive className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Carpetas de Tiendas</h4>
                        <p className="text-[11px] text-slate-400">Sucursales UNC compartidas</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Empaqueta .tar.gz en streaming (Zero-Disk) a Google Drive.
                    </p>
                  </div>
                </div>
              </div>

              {/* Nombre */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nombre de la Programación
                </label>
                <input
                  type="text"
                  required
                  placeholder={scheduleType === 'DATABASE' ? 'ej. Backup Diario BC Nocturno' : 'ej. Respaldo Diario Carpetas Tiendas AK'}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Paso 2: Configuración Específica según Tipo */}
              {scheduleType === 'DATABASE' ? (
                <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-400" />
                    2. Servidor y Bases de Datos
                  </h4>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Servidor SQL Server</label>
                    <select
                      value={serverId || ''}
                      onChange={e => setServerId(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-blue-500"
                    >
                      {servers.map(s => (
                        <option key={s.id} value={s.id}>
                          [{s.os_type || 'SQL'}] {s.name} ({s.host})
                        </option>
                      ))}
                    </select>
                  </div>

                  {databases.length > 0 && (
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-xs text-slate-400">
                          Bases de Datos a Respaldar ({selectedDbIds.length} de {databases.length})
                        </label>
                        <div className="flex gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={selectAllDbs}
                            className="text-blue-400 hover:underline cursor-pointer"
                          >
                            Seleccionar todas
                          </button>
                          <span className="text-slate-600">|</span>
                          <button
                            type="button"
                            onClick={deselectAllDbs}
                            className="text-slate-400 hover:underline cursor-pointer"
                          >
                            Deseleccionar
                          </button>
                        </div>
                      </div>

                      <div className="max-h-36 overflow-y-auto bg-slate-900 border border-slate-800 rounded-lg p-2 space-y-1">
                        {databases.map(db => (
                          <label 
                            key={db.id} 
                            className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800/60 rounded cursor-pointer text-xs text-slate-300"
                          >
                            <input
                              type="checkbox"
                              checked={selectedDbIds.includes(db.id)}
                              onChange={() => toggleDb(db.id)}
                              className="rounded border-slate-700 text-blue-600 focus:ring-0"
                            />
                            <span>{db.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <FolderArchive className="w-4 h-4 text-purple-400" />
                    2. Alcance y Tiendas a Respaldar
                  </h4>

                  {/* Alcance de subcarpetas */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Alcance de Subcarpetas</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        onClick={() => setFolderScope('critical')}
                        className={`p-2 rounded-lg border text-xs cursor-pointer ${
                          folderScope === 'critical'
                            ? 'bg-purple-600/10 border-purple-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <span className="font-semibold block text-slate-200">Carpetas Críticas</span>
                        <span className="text-[10px] text-slate-400">Cajas, DB, Scripts, Logs (Rápido)</span>
                      </div>
                      <div
                        onClick={() => setFolderScope('all')}
                        className={`p-2 rounded-lg border text-xs cursor-pointer ${
                          folderScope === 'all'
                            ? 'bg-purple-600/10 border-purple-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <span className="font-semibold block text-slate-200">Respaldo Completo</span>
                        <span className="text-[10px] text-slate-400">Todas las subcarpetas compartidas</span>
                      </div>
                    </div>
                  </div>

                  {/* Selección de tiendas */}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Selección de Sucursales / Tiendas</label>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => setBranchSelectionMode('all')}
                        className={`py-1.5 px-2 rounded-lg text-xs font-medium border cursor-pointer ${
                          branchSelectionMode === 'all'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Todas las Tiendas
                      </button>
                      <button
                        type="button"
                        onClick={() => setBranchSelectionMode('ak_only')}
                        className={`py-1.5 px-2 rounded-lg text-xs font-medium border cursor-pointer ${
                          branchSelectionMode === 'ak_only'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Solo Alkosto (AK)
                      </button>
                      <button
                        type="button"
                        onClick={() => setBranchSelectionMode('custom')}
                        className={`py-1.5 px-2 rounded-lg text-xs font-medium border cursor-pointer ${
                          branchSelectionMode === 'custom'
                            ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Personalizada
                      </button>
                    </div>

                    {branchSelectionMode === 'custom' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Filtrar tiendas..."
                            value={branchSearch}
                            onChange={e => setBranchSearch(e.target.value)}
                            className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-xs text-white"
                          />
                          <button
                            type="button"
                            onClick={selectAllBranches}
                            className="px-2 py-1 bg-slate-800 text-[11px] text-slate-300 rounded hover:text-white cursor-pointer"
                          >
                            Todas
                          </button>
                          <button
                            type="button"
                            onClick={deselectAllBranches}
                            className="px-2 py-1 bg-slate-800 text-[11px] text-slate-300 rounded hover:text-white cursor-pointer"
                          >
                            Limpiar
                          </button>
                        </div>
                        <div className="max-h-32 overflow-y-auto bg-slate-900 border border-slate-800 rounded-lg p-2 space-y-1">
                          {filteredBranches.map(branch => (
                            <label 
                              key={branch.id} 
                              className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800 rounded cursor-pointer text-xs text-slate-300"
                            >
                              <input
                                type="checkbox"
                                checked={selectedBranchIds.includes(branch.id)}
                                onChange={() => toggleBranch(branch.id)}
                                className="rounded border-slate-700 text-purple-600 focus:ring-0"
                              />
                              <span className="font-mono text-purple-400">[{branch.branch_code}]</span>
                              <span>{branch.branch_name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Paso 3: Frecuencia (Día u Hora Diariamente) */}
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    3. Frecuencia de Ejecución
                  </h4>
                  <span className="font-mono text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    Cron: {computedCron}
                  </span>
                </div>

                {/* Modos de Frecuencia */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFrequencyMode('daily_time')}
                    className={`py-1.5 px-2 text-xs font-medium rounded-lg border text-center transition-all cursor-pointer ${
                      frequencyMode === 'daily_time'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Diario Fijo
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrequencyMode('interval_hours')}
                    className={`py-1.5 px-2 text-xs font-medium rounded-lg border text-center transition-all cursor-pointer ${
                      frequencyMode === 'interval_hours'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Cada N Horas
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrequencyMode('days_of_week')}
                    className={`py-1.5 px-2 text-xs font-medium rounded-lg border text-center transition-all cursor-pointer ${
                      frequencyMode === 'days_of_week'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Días Específicos
                  </button>
                  <button
                    type="button"
                    onClick={() => setFrequencyMode('custom_cron')}
                    className={`py-1.5 px-2 text-xs font-medium rounded-lg border text-center transition-all cursor-pointer ${
                      frequencyMode === 'custom_cron'
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    Avanzado (Cron)
                  </button>
                </div>

                {/* Contenido según Modo */}
                {frequencyMode === 'daily_time' && (
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-2">
                    <label className="block text-xs text-slate-400">
                      Hora de ejecución diaria:
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="time"
                        value={dailyTime}
                        onChange={e => setDailyTime(e.target.value)}
                        className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                      />
                      <div className="text-xs text-slate-400">
                        Se ejecutará todos los días automáticamente a las <span className="text-white font-bold">{dailyTime}</span>
                      </div>
                    </div>
                  </div>
                )}

                {frequencyMode === 'interval_hours' && (
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-2">
                    <label className="block text-xs text-slate-400">
                      Ejecutar diariamente cada:
                    </label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[1, 2, 4, 6, 8, 12].map(hrs => (
                        <button
                          key={hrs}
                          type="button"
                          onClick={() => setIntervalHours(hrs)}
                          className={`py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                            intervalHours === hrs
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          {hrs} {hrs === 1 ? 'hora' : 'horas'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Se ejecutará continuamente cada <span className="text-white font-bold">{intervalHours} horas</span> todos los días en el minuto 00.
                    </p>
                  </div>
                )}

                {frequencyMode === 'days_of_week' && (
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-2">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                      <label className="text-xs text-slate-400">Días de la semana:</label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Hora:</span>
                        <input
                          type="time"
                          value={dailyTime}
                          onChange={e => setDailyTime(e.target.value)}
                          className="px-2 py-1 bg-slate-950 border border-slate-800 rounded text-white font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1 pt-1">
                      {[
                        { id: 1, label: 'Lun' },
                        { id: 2, label: 'Mar' },
                        { id: 3, label: 'Mié' },
                        { id: 4, label: 'Jue' },
                        { id: 5, label: 'Vie' },
                        { id: 6, label: 'Sáb' },
                        { id: 0, label: 'Dom' },
                      ].map(d => {
                        const active = selectedDays.includes(d.id);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => toggleDay(d.id)}
                            className={`py-1.5 rounded text-xs font-medium border cursor-pointer ${
                              active
                                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold'
                                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-white'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {frequencyMode === 'custom_cron' && (
                  <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-2">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => setCustomCron('0 2 * * *')}
                        className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-emerald-500 text-slate-300 text-left cursor-pointer"
                      >
                        Diario a las 2:00 AM
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomCron('0 */4 * * *')}
                        className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-emerald-500 text-slate-300 text-left cursor-pointer"
                      >
                        Cada 4 horas
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomCron('0 2 * * 0')}
                        className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-emerald-500 text-slate-300 text-left cursor-pointer"
                      >
                        Semanal (Domingos 2 AM)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomCron('0 2 1 * *')}
                        className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-emerald-500 text-slate-300 text-left cursor-pointer"
                      >
                        Mensual (Día 1 a las 2 AM)
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={customCron}
                      onChange={e => setCustomCron(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* Paso 4: Política de Retención Automática */}
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2.5">
                <h4 className="text-xs font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  4. Política de Retención en Google Drive
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Retener últimos N respaldos
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={retentionCount}
                      onChange={e => setRetentionCount(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs font-mono"
                    />
                    <span className="text-[10px] text-slate-400 mt-0.5 block">Ej. Guardar 7 copias</span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Antigüedad máxima (días)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={retentionDays}
                      onChange={e => setRetentionDays(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-xs font-mono"
                    />
                    <span className="text-[10px] text-slate-400 mt-0.5 block">Ej. Máximo 30 días</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 pt-1">
                  💡 Los respaldos anteriores que superen el límite de copias o de días se eliminarán automáticamente de Google Drive al finalizar cada backup.
                </p>
              </div>

              {/* Botones de Acción */}
              </div>
            <div className="px-6 py-3.5 flex justify-end gap-2 border-t border-slate-800 bg-slate-950/80 backdrop-blur sticky bottom-0 z-10">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-slate-800 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
                >
                  {submitting ? 'Guardando...' : 'Guardar Programación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulesPage;
