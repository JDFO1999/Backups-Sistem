import React from 'react';
import { 
  LayoutDashboard, Server, Database, Archive, 
  Calendar, HardDrive, Users, ShieldAlert, LogOut, Activity
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  setCurrentTab,
  isOpen,
  setIsOpen
}) => {
  const { user, isAdmin, logout } = useAuth();

  const navigation = [
    { name: 'Dashboard', id: 'dashboard', icon: LayoutDashboard },
    { name: 'Servidores', id: 'servers', icon: Server },
    { name: 'Bases de Datos', id: 'databases', icon: Database },
    { name: 'Backups', id: 'backups', icon: Archive },
    { name: 'Programaciones', id: 'schedules', icon: Calendar },
    { name: 'Google Drive', id: 'google-drive', icon: HardDrive },
    ...(isAdmin ? [
      { name: 'Usuarios', id: 'users', icon: Users },
      { name: 'Auditoría', id: 'audit', icon: ShieldAlert },
    ] : [])
  ];

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-slate-900/80 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside className={`
        fixed top-0 bottom-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800 flex flex-col
        transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* App Logo & Mobile Close */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-white text-base leading-tight">BackupMaster</h1>
              <span className="text-xs text-blue-400 font-mono">v1.0 • Enterprise</span>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 lg:hidden"
            aria-label="Cerrar menú"
          >
            ✕
          </button>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentTab(item.id);
                  setIsOpen(false);
                }}
                className={`
                  w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${active 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }
                `}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-slate-400'}`} />
                {item.name}
              </button>
            );
          })}
        </nav>

        {/* User Card */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 px-2 py-2 mb-2 rounded-lg bg-slate-800/40">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-semibold text-white">
              {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user?.full_name || user?.email}</p>
              <span className={`
                inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded
                ${isAdmin ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-700 text-slate-300'}
              `}>
                {isAdmin ? 'ADMINISTRADOR' : 'OPERADOR'}
              </span>
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </button>
        </div>
      </aside>
    </>
  );
};
