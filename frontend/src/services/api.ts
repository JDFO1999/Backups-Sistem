import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor for token attachment
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Interceptor for handling 401 Unauthorized
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Ignorar 401 en login o en el modal de verificación de desbloqueo (para no cerrar la pantalla si se equivoca de clave)
      const url = error.config?.url || '';
      if (url.includes('/auth/login') || url.includes('/auth/verify-unlock')) {
        return Promise.reject(error);
      }

      // Si la pantalla ya está en estado de bloqueo (is_locked === 'true'), NO destruimos las credenciales
      // de la sesión para permitir que el usuario ingrese su contraseña y renueve el acceso limpiamente
      if (localStorage.getItem('is_locked') === 'true') {
        return Promise.reject(error);
      }

      // Si cualquier otra petición protegida da 401 fuera de la pantalla de bloqueo: limpiar y redirigir
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('is_locked');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

import { Branch, BranchSyncResult, FolderBackupJob, FolderBackupCreate, FolderBackupStats, BackupSchedule, NotificationConfig, NotificationConfigUpdate, TestNotificationRequest } from '../types';

export const foldersApi = {
  getStats: () => api.get<FolderBackupStats>('/folders/stats'),
  getBranches: (refresh = false) => api.get<Branch[]>('/folders/branches', { params: { refresh } }),
  syncBranches: () => api.post<BranchSyncResult>('/folders/branches/sync'),
  getBranchSubfolders: (branchId: number) => api.get<string[]>(`/folders/branches/${branchId}/subfolders`),
  createJob: (data: FolderBackupCreate) => api.post<FolderBackupJob>('/folders/jobs', data),
  getJobs: () => api.get<FolderBackupJob[]>('/folders/jobs'),
  getJob: (jobId: number) => api.get<FolderBackupJob>(`/folders/jobs/${jobId}`),
  resumeJob: (jobId: number, restartFresh: boolean = false) => api.post<FolderBackupJob>(`/folders/jobs/${jobId}/resume`, null, { params: { restart_fresh: restartFresh } }),
  deleteJob: (jobId: number) => api.delete(`/folders/jobs/${jobId}`),
  getFileDownloadUrl: (fileId: number) => {
    const token = localStorage.getItem('token');
    return `${API_BASE_URL}/folders/files/${fileId}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
  getFileLinks: (fileId: number) => api.get<{ web_view_link?: string; web_content_link?: string; size?: number }>(`/folders/files/${fileId}/links`),
};

export const schedulesApi = {
  list: () => api.get<BackupSchedule[]>('/schedules'),
  create: (data: Partial<BackupSchedule>) => api.post<BackupSchedule>('/schedules', data),
  update: (id: number, data: Partial<BackupSchedule>) => api.put<BackupSchedule>(`/schedules/${id}`, data),
  toggle: (id: number) => api.patch<BackupSchedule>(`/schedules/${id}/toggle`),
  trigger: (id: number) => api.post<{ message: string; job_id?: number }>(`/schedules/${id}/trigger`),
  delete: (id: number) => api.delete(`/schedules/${id}`),
};

export const notificationsApi = {
  getConfig: () => api.get<NotificationConfig>('/notifications/config'),
  saveConfig: (data: NotificationConfigUpdate) => api.post<NotificationConfig>('/notifications/config', data),
  testNotification: (data: TestNotificationRequest) => api.post<{ ok: boolean; message: string }>('/notifications/test', data),
};



