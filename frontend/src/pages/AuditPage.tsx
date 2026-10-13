import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../services/api';
import { AuditLog } from '../types';

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/audit');
      setLogs(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-white">Registro de Auditoría</h1>
          <p className="text-xs text-slate-400">Historial inmutable de eventos críticos de seguridad y operaciones</p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Fecha y Hora</th>
                <th className="py-3 px-4">Acción</th>
                <th className="py-3 px-4">Usuario</th>
                <th className="py-3 px-4">IP Origen</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando auditoría...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No hay registros de auditoría aún.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 text-slate-400 font-mono">
                      {new Date(log.created_at).toLocaleString('es-ES')}
                    </td>
                    <td className="py-3 px-4 font-semibold text-white font-mono">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {log.user_email || 'Sistema / Anónimo'}
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono">
                      {log.ip_address || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                        log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {log.status === 'SUCCESS' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono truncate max-w-xs" title={log.details_json || ''}>
                      {log.details_json || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AuditPage;
