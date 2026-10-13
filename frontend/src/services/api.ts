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
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

import { Branch, BranchSyncResult, FolderBackupJob, FolderBackupCreate, FolderBackupStats } from '../types';

export const foldersApi = {
  getStats: () => api.get<FolderBackupStats>('/folders/stats'),
  getBranches: (refresh = false) => api.get<Branch[]>('/folders/branches', { params: { refresh } }),
  syncBranches: () => api.post<BranchSyncResult>('/folders/branches/sync'),
  getBranchSubfolders: (branchId: number) => api.get<string[]>(`/folders/branches/${branchId}/subfolders`),
  createJob: (data: FolderBackupCreate) => api.post<FolderBackupJob>('/folders/jobs', data),
  getJobs: () => api.get<FolderBackupJob[]>('/folders/jobs'),
  getJob: (jobId: number) => api.get<FolderBackupJob>(`/folders/jobs/${jobId}`),
  resumeJob: (jobId: number) => api.post<FolderBackupJob>(`/folders/jobs/${jobId}/resume`),
  deleteJob: (jobId: number) => api.delete(`/folders/jobs/${jobId}`),
};
