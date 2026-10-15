import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLocked: boolean;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  unlockSession: (password: string) => Promise<boolean>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    const savedLock = localStorage.getItem('is_locked');

    if (savedToken && savedUser) {
      setToken(savedToken);
      try {
        setUser(JSON.parse(savedUser));
        if (savedLock === 'true') {
          setIsLocked(true);
        }
      } catch {
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  // Monitor de inactividad: si transcurren 15 minutos sin interacción, bloquear pantalla
  useEffect(() => {
    if (!token || isLocked) return;

    let timeoutId: any;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsLocked(true);
        localStorage.setItem('is_locked', 'true');
      }, INACTIVITY_TIMEOUT_MS);
    };

    // Eventos de interacción del usuario
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => window.addEventListener(event, resetTimer, { passive: true }));

    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [token, isLocked]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    localStorage.removeItem('is_locked');
    setToken(newToken);
    setUser(newUser);
    setIsLocked(false);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('is_locked');
      setToken(null);
      setUser(null);
      setIsLocked(false);
      window.location.href = '/login';
    }
  };

  const unlockSession = async (password: string): Promise<boolean> => {
    try {
      const res = await api.post('/auth/verify-unlock', { 
        password,
        email: user?.email 
      });
      if (res.data?.access_token) {
        localStorage.setItem('token', res.data.access_token);
        setToken(res.data.access_token);
      }
      if (res.data?.user) {
        localStorage.setItem('user', JSON.stringify(res.data.user));
        setUser(res.data.user);
      }
      setIsLocked(false);
      localStorage.removeItem('is_locked');
      return true;
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Contraseña incorrecta.';
      throw new Error(msg);
    }
  };


  const isAdmin = user?.role?.name === 'ADMIN' || (user as any)?.role === 'ADMIN';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token,
        isAdmin,
        isLocked,
        login,
        logout,
        unlockSession,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
