import React, { useState, useEffect } from 'react';
import { 
  Calendar, Plus, Trash2, RefreshCw
} from 'lucide-react';
import { api } from '../services/api';
import { BackupSchedule, Server as IServer, Database as IDatabase } from '../types';
import { showToast, showConfirm } from '../utils/toast';

export const SchedulesPage: React.FC = () => {
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [servers, setServers] = useState<IServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [serverId, setServerId] = useState<number | null>(null);
  const [databases, setDatabases] = useState<IDatabase[]>([]);
  const [selectedDbIds, setSelectedDbIds] = useState<number[]>([]);
  const [cronExpression, setCronExpression] = useState('0 2 * * *');
  const [retentionCount, setRetentionCount] = useState(7);
  const [retentionDays, setRetentionDays] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  const fetchSchedules = async () => {
    try {
      const res = await api.get('/schedules');
      setSchedules(res.data);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error al cargar programaciones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
    api.get('/servers').then(res => {
      setServers(res.data);
      if (res.data.length > 0) setServerId(res.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (serverId) {
      api.get(`/databases/server/${serverId}`).then(res => {
        setDatabases(res.data);
        setSelectedDbIds(res.data.map((d: IDatabase) => d.id));
      });
    }
  }, [serverId]);

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverId) return;
    setSubmitting(true);

    try {
      await api.post('/schedules', {
        name,
        server_id: serverId,
        database_ids: selectedDbIds,
        cron_expression: cronExpression,
        retention_count: retentionCount,
        retention_days: retentionDays,
        compression_type: 'GZIP',
        is_active: true
      });

      showToast.success(`Programación "${name}" guardada con éxito`);
      setIsModalOpen(false);
      setName('');
      fetchSchedules();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error creando programación.');
    } finally {
      setSubmitting(false);
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
      await api.delete(`/schedules/${id}`);
      showToast.success(`Programación "${scheduleName}" eliminada`);
      fetchSchedules();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error eliminando programación.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Programaciones y Retención</h1>
          <p className="text-xs text-slate-400">Automatice backups recurrentes y configure la eliminación programada</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" />
          Nueva Programación
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white">No hay backups automáticos configurados</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Programe backups recurrentes a Google Drive con reglas automáticas de retención.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {schedules.map(sched => (
            <div key={sched.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-white text-sm">{sched.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{sched.server_name}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    sched.is_active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {sched.is_active ? 'ACTIVO' : 'PAUSADO'}
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Expresión Cron:</span>
                    <span className="font-mono text-blue-400 bg-slate-950 px-2 py-0.5 rounded">
                      {sched.cron_expression}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Política Retención:</span>
                    <span className="text-slate-200">
                      Últimos {sched.retention_count} backups ({sched.retention_days} días)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Próxima Ejecución:</span>
                    <span className="text-slate-300">
                      {sched.next_run_at ? new Date(sched.next_run_at).toLocaleString('es-ES') : 'Inmediata'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => handleDeleteSchedule(sched.id, sched.name)}
                  className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Eliminar Programación"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Nueva Programación */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                Nueva Programación de Backup
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateSchedule} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nombre de la Programación</label>
                <input
                  type="text"
                  required
                  placeholder="ej. Backup Diario de Producción"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Servidor</label>
                <select
                  value={serverId || ''}
                  onChange={e => setServerId(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                >
                  {servers.map(s => (
                    <option key={s.id} value={s.id}>
                      [{s.os_type || 'LINUX'}] {s.name} ({s.host})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Frecuencia / Preset Cron</label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setCronExpression('0 2 * * *')}
                    className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-blue-500 text-slate-300"
                  >
                    Diario a las 2:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => setCronExpression('0 */6 * * *')}
                    className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-blue-500 text-slate-300"
                  >
                    Cada 6 horas
                  </button>
                  <button
                    type="button"
                    onClick={() => setCronExpression('0 2 * * 0')}
                    className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-blue-500 text-slate-300"
                  >
                    Semanal (Domingos 2 AM)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCronExpression('0 2 1 * *')}
                    className="p-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded hover:border-blue-500 text-slate-300"
                  >
                    Mensual (Día 1 a las 2 AM)
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={cronExpression}
                  onChange={e => setCronExpression(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Retener últimos N</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={retentionCount}
                    onChange={e => setRetentionCount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Días de retención</label>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={retentionDays}
                    onChange={e => setRetentionDays(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
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
