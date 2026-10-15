import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Sidebar } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { DashboardPage } from './pages/DashboardPage';
import { ServersPage } from './pages/ServersPage';
import { DatabasesPage } from './pages/DatabasesPage';
import { BackupsPage } from './pages/BackupsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { GoogleDrivePage } from './pages/GoogleDrivePage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { FolderBackupsPage } from './pages/FolderBackupsPage';
import { NotificationSettingsPage } from './pages/NotificationSettingsPage';
import { LockScreenModal } from './components/LockScreenModal';

const MainLayout: React.FC = () => {
  const { isAuthenticated, loading, isLocked } = useAuth();
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  const getTabTitle = (tab: string) => {
    switch (tab) {
      case 'dashboard': return 'Dashboard Principal';
      case 'servers': return 'Gestión de Servidores';
      case 'databases': return 'Selección y Estimación de Bases de Datos';
      case 'backups': return 'Ejecución e Historial de Backups BD';
      case 'folders': return 'Respaldo de Carpetas de Tiendas (Rutas UNC)';
      case 'schedules': return 'Programación Automática y Retención';
      case 'google-drive': return 'Configuración de Google Drive';
      case 'notifications': return 'Configuración de Alertas & Notificaciones';
      case 'users': return 'Administración de Usuarios y Permisos';
      case 'audit': return 'Bitácora de Auditoría';
      default: return 'Alkosto - Gestión de Respaldos';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <Sidebar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <Navbar 
          onMenuClick={() => setIsSidebarOpen(true)} 
          title={getTabTitle(currentTab)} 
        />
        
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {currentTab === 'dashboard' && <DashboardPage onNavigate={setCurrentTab} />}
          {currentTab === 'servers' && <ServersPage />}
          {currentTab === 'databases' && <DatabasesPage onNavigateToBackups={() => setCurrentTab('backups')} />}
          {currentTab === 'backups' && <BackupsPage />}
          {currentTab === 'folders' && <FolderBackupsPage />}
          {currentTab === 'schedules' && <SchedulesPage />}
          {currentTab === 'google-drive' && <GoogleDrivePage />}
          {currentTab === 'notifications' && <NotificationSettingsPage />}
          {currentTab === 'users' && <UsersPage />}
          {currentTab === 'audit' && <AuditPage />}
        </main>
      </div>


      {/* Modal de bloqueo por inactividad (15 min) */}
      {isLocked && <LockScreenModal />}
    </div>
  );
};

export function App() {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
}

export default App;
