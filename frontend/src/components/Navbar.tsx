import React from 'react';
import { Menu, Bell, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  onMenuClick: () => void;
  title: string;
}

export const Navbar: React.FC<NavbarProps> = ({ onMenuClick, title }) => {
  const { user } = useAuth();

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-3 sm:px-6 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          aria-label="Abrir menú"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 lg:hidden flex-shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-sm sm:text-base md:text-lg font-semibold text-white truncate">{title}</h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Sistema Seguro</span>
        </div>
        <div className="text-xs text-slate-400 font-mono truncate max-w-[140px] sm:max-w-none">
          {user?.email}
        </div>
      </div>
    </header>
  );
};
