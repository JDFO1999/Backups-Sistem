export interface Role {
  id: number;
  name: string;
  description?: string;
}

export interface User {
  id: number;
  email: string;
  full_name?: string;
  is_active: boolean;
  role?: Role;
  created_at: string;
  updated_at: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface Server {
  id: number;
  name: string;
  host: string;
  ssh_port: number;
  username: string;
  auth_type: string;
  os_type?: 'LINUX' | 'WINDOWS';
  os_info?: string;
  status: string;
  last_contact_at?: string;
  created_at: string;
  updated_at: string;
  has_key: boolean;
  has_password: boolean;
}

export interface ServerTestResult {
  success: boolean;
  latency_ms?: number;
  os_detected?: string;
  message: string;
}

export interface Database {
  id: number;
  server_id: number;
  connection_id?: number;
  name: string;
  engine: string;
  size_bytes: number;
  size_formatted?: string;
  last_analyzed_at?: string;
  last_backup_at?: string;
  last_backup_size_bytes?: number;
  last_backup_status?: string;
}

export interface DatabaseEstimate {
  selected_count: number;
  total_original_bytes: number;
  total_original_formatted: string;
  estimated_compressed_bytes: number;
  estimated_compressed_formatted: string;
  disclaimer: string;
}

export interface BackupFile {
  id: number;
  database_id: number;
  database_name?: string;
  file_name: string;
  file_size_bytes: number;
  file_size_formatted?: string;
  original_db_size_bytes: number;
  original_size_formatted?: string;
  sha256_checksum?: string;
  compression_algorithm: string;
  google_drive_file_id?: string;
  google_drive_path?: string;
  status: string;
  created_at: string;
}

export interface BackupJob {
  id: number;
  server_id: number;
  server_name?: string;
  trigger_type: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
  progress_percent: number;
  current_step: string;
  error_message?: string;
  total_original_size_bytes: number;
  total_compressed_size_bytes: number;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  files: BackupFile[];
}

export interface RestoreJob {
  id: number;
  backup_file_id: number;
  file_name: string;
  source_database_name?: string;
  target_server_id: number;
  target_server_name?: string;
  target_database_name: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress_percent: number;
  current_step: string;
  error_message?: string;
  overwrite: boolean;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}


export interface GoogleDriveStatus {
  is_connected: boolean;
  email?: string;
  root_folder_id?: string;
  root_folder_name: string;
  last_synced_at?: string;
}

export interface GoogleDriveStorage {
  total_bytes?: number;
  used_bytes?: number;
  available_bytes?: number;
  total_formatted?: string;
  used_formatted?: string;
  available_formatted?: string;
  is_unlimited: boolean;
  message?: string;
}

export interface BackupSchedule {
  id: number;
  name: string;
  server_id: number;
  server_name?: string;
  database_ids: number[];
  cron_expression: string;
  compression_type: string;
  retention_count: number;
  retention_days: number;
  is_active: boolean;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  user_id?: number;
  user_email?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  status: string;
  details_json?: string;
  created_at: string;
}

export interface DashboardStats {
  total_servers: number;
  total_databases: number;
  total_backups: number;
  successful_backups: number;
  failed_backups: number;
  drive_used_bytes: number;
  drive_used_formatted: string;
  drive_available_bytes?: number;
  drive_available_formatted?: string;
  last_backup_time?: string;
  next_scheduled_backup_time?: string;
  recent_backups: BackupJob[];
  recent_errors: AuditLog[];
  storage_history: { date: string; size_bytes: number; size_formatted: string }[];
  backups_per_day: { date: string; count: number }[];
}
