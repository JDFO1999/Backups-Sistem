import React, { useEffect, useState } from 'react';
import { 
  Server, Database, Archive, CheckCircle, AlertTriangle, 
  HardDrive, Clock, ArrowUpRight, RefreshCw, AlertCircle
} from 'lucide-react';
import { api } from '../services/api';
import { DashboardStats } from '../types';

export const DashboardPage: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await api.get('/dashboard');
      setStats(res.data);
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const statCards = [
    { 
      title: 'Servidores Activos', 
      value: stats?.total_servers || 0, 
      icon: Server, 
      color: 'blue', 
      onClick: () => onNavigate('servers')
    },
    { 
      title: 'Bases de Datos', 
      value: stats?.total_databases || 0, 
      icon: Database, 
      color: 'indigo', 
      onClick: () => onNavigate('databases')
    },
    { 
      title: 'Backups Realizados', 
      value: stats?.total_backups || 0, 
      subtitle: `${stats?.successful_backups || 0} exitosos • ${stats?.failed_backups || 0} fallidos`,
      icon: Archive, 
      color: 'emerald', 
      onClick: () => onNavigate('backups')
    },
    { 
      title: 'Google Drive Usado', 
      value: stats?.drive_used_formatted || '0 B', 
      subtitle: `Disponible: ${stats?.drive_available_formatted || 'Consultando...'}`,
      icon: HardDrive, 
      color: 'amber', 
      onClick: () => onNavigate('google-drive')
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Panel de Control General</h1>
          <p className="text-xs text-slate-400">Estado en tiempo real de la infraestructura de backups</p>
        </div>
        <button
          onClick={() => { setRefreshing(true); fetchStats(); }}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-700 hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar Datos
        </button>
      </div>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              onClick={card.onClick}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all cursor-pointer relative overflow-hidden group shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">{card.title}</span>
                <div className={`p-2 rounded-lg bg-${card.color}-500/10 text-${card.color}-400`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-white tracking-tight">{card.value}</div>
                {card.subtitle && (
                  <p className="text-[11px] text-slate-400 mt-1">{card.subtitle}</p>
                )}
              </div>
              <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowUpRight className="w-4 h-4 text-slate-500" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Execution Status Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Último Backup Ejecutado</div>
            <div className="text-sm font-semibold text-white mt-0.5">
              {stats?.last_backup_time 
                ? new Date(stats.last_backup_time).toLocaleString('es-ES') 
                : 'Ninguno registrado recientemente'}
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400">Próximo Backup Programado</div>
            <div className="text-sm font-semibold text-white mt-0.5">
              {stats?.next_scheduled_backup_time 
                ? new Date(stats.next_scheduled_backup_time).toLocaleString('es-ES') 
                : 'Sin programaciones automáticas activas'}
            </div>
          </div>
        </div>
      </div>

      {/* Storage and Activity Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Backups per day */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Actividad de Backups (Últimos 7 días)</h3>
          <div className="space-y-2">
            {stats?.backups_per_day.map((day, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="w-20 text-slate-400 font-mono">{day.date}</span>
                <div className="flex-1 bg-slate-800 h-4 rounded-full overflow-hidden flex items-center px-1">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(day.count * 20, 100)}%` }}
                  />
                </div>
                <span className="w-8 text-right font-semibold text-white">{day.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Storage evolution */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Crecimiento de Almacenamiento</h3>
          {stats?.storage_history && stats.storage_history.length > 0 ? (
            <div className="space-y-3">
              {stats.storage_history.slice(-5).map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60 last:border-0">
                  <span className="text-slate-400">{item.date}</span>
                  <span className="font-semibold text-blue-400">{item.size_formatted}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 py-6 text-center">
              No hay historial suficiente de backups completados aún.
            </div>
          )}
        </div>
      </div>

      {/* Recent Backups Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-white">Backups Recientes</h3>
          <button
            onClick={() => onNavigate('backups')}
            className="text-xs text-blue-400 hover:text-blue-300 font-medium"
          >
            Ver Historial Completo →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/50 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Servidor</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Progreso</th>
                <th className="py-3 px-4">Detalle / Paso</th>
                <th className="py-3 px-4">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {stats?.recent_backups && stats.recent_backups.length > 0 ? (
                stats.recent_backups.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono text-slate-400">#{job.id}</td>
                    <td className="py-3 px-4 text-white font-medium">{job.server_name}</td>
                    <td className="py-3 px-4">
                      <span className={`
                        inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium
                        ${job.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                          job.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400' :
                          job.status === 'FAILED' ? 'bg-red-500/10 text-red-400' :
                          'bg-slate-700 text-slate-300'}
                      `}>
                        {job.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="w-24 bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-blue-500 h-full rounded-full" 
                          style={{ width: `${job.progress_percent}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300 truncate max-w-xs">{job.current_step}</td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(job.created_at).toLocaleString('es-ES')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No se han registrado backups recientemente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
