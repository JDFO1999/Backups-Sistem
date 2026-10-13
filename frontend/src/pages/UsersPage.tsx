import React, { useState, useEffect } from 'react';
import { Users as UsersIcon, Plus, Trash2, UserCheck, UserX, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';
import { showToast, showConfirm } from '../utils/toast';

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [roleName, setRoleName] = useState('USER');
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data);
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error cargando usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await api.post('/users', {
        email,
        full_name: fullName,
        password,
        role_name: roleName
      });
      showToast.success(`Usuario ${email} creado exitosamente`);
      setIsModalOpen(false);
      setEmail('');
      setFullName('');
      setPassword('');
      fetchUsers();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error creando usuario.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: number, userEmail: string) => {
    const confirmed = await showConfirm(
      '¿Eliminar Usuario?',
      `Se revocará el acceso al usuario "${userEmail}".`,
      'Sí, eliminar usuario'
    );
    if (!confirmed) return;

    try {
      await api.delete(`/users/${id}`);
      showToast.success(`Usuario ${userEmail} eliminado`);
      fetchUsers();
    } catch (err: any) {
      showToast.error(err.response?.data?.detail || 'Error eliminando usuario.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Administración de Usuarios</h1>
          <p className="text-xs text-slate-400">Controle accesos, roles y permisos de los operadores</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-4 h-4" />
          Nuevo Usuario
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Usuario / Nombre</th>
                <th className="py-3 px-4">Correo Electrónico</th>
                <th className="py-3 px-4">Rol</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Fecha Registro</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto text-blue-500 mb-2" />
                    Cargando usuarios...
                  </td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-semibold text-white">
                      {u.full_name || 'Sin nombre'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">{u.email}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        u.role?.name === 'ADMIN' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {u.role?.name || 'USER'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        u.is_active ? 'text-emerald-400' : 'text-slate-500'
                      }`}>
                        {u.is_active ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                        {u.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(u.created_at).toLocaleDateString('es-ES')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDeleteUser(u.id, u.email)}
                        className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        title="Eliminar usuario"
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

      {/* Modal Nuevo Usuario */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UsersIcon className="w-4 h-4 text-blue-500" />
                Registrar Nuevo Usuario
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 text-sm">✕</button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Nombre Completo</label>
                <input
                  type="text"
                  placeholder="Juan Pérez"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  placeholder="operador@empresa.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Contraseña (Mínimo 8 caracteres)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Rol de Acceso</label>
                <select
                  value={roleName}
                  onChange={e => setRoleName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                >
                  <option value="USER">USER (Operador de Backups)</option>
                  <option value="ADMIN">ADMIN (Control Total del Sistema)</option>
                </select>
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
                  {submitting ? 'Creando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersPage;
