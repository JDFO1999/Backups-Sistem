import React, { useState, useEffect } from 'react';
import { 
  Bell, Send, ShieldCheck, Mail, MessageSquare, CheckCircle2, 
  AlertTriangle, RefreshCw, Key, Info, Eye, EyeOff, Save, Check
} from 'lucide-react';
import { notificationsApi } from '../services/api';
import { NotificationConfig } from '../types';

export const NotificationSettingsPage: React.FC = () => {
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Form states
  const [selectedProvider, setSelectedProvider] = useState<'TELEGRAM' | 'EMAIL' | 'WHATSAPP'>('TELEGRAM');
  const [isEnabled, setIsEnabled] = useState(true);
  const [notifyOnStart, setNotifyOnStart] = useState(false);
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);

  // Telegram fields
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [showTelegramToken, setShowTelegramToken] = useState(false);

  // Email fields
  const [emailSmtpHost, setEmailSmtpHost] = useState('');
  const [emailSmtpPort, setEmailSmtpPort] = useState(587);
  const [emailSender, setEmailSender] = useState('');
  const [emailRecipients, setEmailRecipients] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailUseTls, setEmailUseTls] = useState(true);
  const [showEmailPassword, setShowEmailPassword] = useState(false);

  // WhatsApp fields
  const [whatsappSid, setWhatsappSid] = useState('');
  const [whatsappToken, setWhatsappToken] = useState('');
  const [whatsappFrom, setWhatsappFrom] = useState('');
  const [whatsappTo, setWhatsappTo] = useState('');
  const [showWhatsappToken, setShowWhatsappToken] = useState(false);

  const defaultBotToken = "8621888284:AAGCMCM19k_xMcv5h8xxfg9grFn1EHAsKD4";

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await notificationsApi.getConfig();
      const data = res.data;
      setConfig(data);
      setSelectedProvider(data.provider || 'TELEGRAM');
      setIsEnabled(data.is_enabled);
      setNotifyOnStart(data.notify_on_start);
      setNotifyOnSuccess(data.notify_on_success);
      setNotifyOnError(data.notify_on_error);

      // Telegram
      setTelegramChatId(data.telegram_chat_id || '');
      setTelegramToken(data.telegram_bot_token_masked || '');

      // Email
      setEmailSmtpHost(data.email_smtp_host || '');
      setEmailSmtpPort(data.email_smtp_port || 587);
      setEmailSender(data.email_sender || '');
      setEmailRecipients(data.email_recipients || '');
      setEmailUseTls(data.email_use_tls);

      // WhatsApp
      setWhatsappSid(data.whatsapp_account_sid_masked || '');
      setWhatsappFrom(data.whatsapp_from || '');
      setWhatsappTo(data.whatsapp_to || '');
    } catch (err: any) {
      console.error("Error al cargar configuración de notificaciones:", err);
      setStatusMessage({
        type: 'error',
        text: 'No se pudo cargar la configuración de notificaciones.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    try {
      const payload: any = {
        provider: selectedProvider,
        is_enabled: isEnabled,
        notify_on_start: notifyOnStart,
        notify_on_success: notifyOnSuccess,
        notify_on_error: notifyOnError,
      };

      if (selectedProvider === 'TELEGRAM') {
        payload.telegram_chat_id = telegramChatId.trim();
        if (telegramToken && !telegramToken.includes('...')) {
          payload.telegram_bot_token = telegramToken.trim();
        }
      } else if (selectedProvider === 'EMAIL') {
        payload.email_smtp_host = emailSmtpHost.trim();
        payload.email_smtp_port = emailSmtpPort;
        payload.email_sender = emailSender.trim();
        payload.email_recipients = emailRecipients.trim();
        payload.email_use_tls = emailUseTls;
        if (emailPassword) {
          payload.email_password = emailPassword.trim();
        }
      } else if (selectedProvider === 'WHATSAPP') {
        if (whatsappSid && !whatsappSid.includes('...')) {
          payload.whatsapp_account_sid = whatsappSid.trim();
        }
        if (whatsappToken) {
          payload.whatsapp_auth_token = whatsappToken.trim();
        }
        payload.whatsapp_from = whatsappFrom.trim();
        payload.whatsapp_to = whatsappTo.trim();
      }

      const res = await notificationsApi.saveConfig(payload);
      setConfig(res.data);
      if (res.data.telegram_bot_token_masked) {
        setTelegramToken(res.data.telegram_bot_token_masked);
      }
      setEmailPassword('');
      setWhatsappToken('');
      setStatusMessage({
        type: 'success',
        text: 'Configuración guardada y cifrada exitosamente en base de datos.'
      });
    } catch (err: any) {
      console.error("Error al guardar:", err);
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.detail || 'Error al guardar la configuración.'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestNotification = async () => {
    setTesting(true);
    setStatusMessage(null);
    try {
      const payload: any = {
        provider: selectedProvider
      };

      if (selectedProvider === 'TELEGRAM') {
        payload.telegram_chat_id = telegramChatId.trim();
        if (telegramToken && !telegramToken.includes('...')) {
          payload.telegram_bot_token = telegramToken.trim();
        }
      } else if (selectedProvider === 'EMAIL') {
        payload.email_smtp_host = emailSmtpHost.trim();
        payload.email_smtp_port = emailSmtpPort;
        payload.email_sender = emailSender.trim();
        payload.email_recipients = emailRecipients.trim();
        payload.email_password = emailPassword.trim() || undefined;
      } else if (selectedProvider === 'WHATSAPP') {
        payload.whatsapp_account_sid = whatsappSid.trim();
        payload.whatsapp_auth_token = whatsappToken.trim() || undefined;
        payload.whatsapp_from = whatsappFrom.trim();
        payload.whatsapp_to = whatsappTo.trim();
      }

      const res = await notificationsApi.testNotification(payload);
      if (res.data.ok) {
        setStatusMessage({
          type: 'success',
          text: `✅ ${res.data.message}`
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: `❌ ${res.data.message}`
        });
      }
    } catch (err: any) {
      console.error("Error al probar notificación:", err);
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.detail || 'Error al enviar mensaje de prueba.'
      });
    } finally {
      setTesting(false);
    }
  };

  const fillDefaultTelegramToken = () => {
    setTelegramToken(defaultBotToken);
    setStatusMessage({
      type: 'info',
      text: 'Token del Bot de Telegram cargado en el campo. Recuerda ingresar el @Canal o Chat ID y hacer clic en Guardar.'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
          <p>Cargando configuración de alertas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 backdrop-blur-sm shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Bell className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Alertas & Notificaciones
              </h1>
              <p className="text-sm text-slate-400">
                Notificaciones automáticas en tiempo real para respaldos de bases de datos y carpetas UNC.
              </p>
            </div>
          </div>
        </div>

        {/* Global Enabled Toggle */}
        <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 p-2 px-4 rounded-xl self-start sm:self-center">
          <span className="text-sm font-medium text-slate-300">Servicio de Alertas:</span>
          <button
            type="button"
            onClick={() => setIsEnabled(!isEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              isEnabled ? 'bg-blue-600' : 'bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
          }`}>
            {isEnabled ? 'ACTIVO' : 'PAUSADO'}
          </span>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 transition-all ${
          statusMessage.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' 
            : statusMessage.type === 'error'
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            : 'bg-blue-500/10 border-blue-500/30 text-blue-200'
        }`}>
          {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />}
          {statusMessage.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />}
          {statusMessage.type === 'info' && <Info className="w-5 h-5 shrink-0 text-blue-400 mt-0.5" />}
          <div className="text-sm font-medium">{statusMessage.text}</div>
        </div>
      )}

      {/* Provider Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Telegram Card */}
        <div 
          onClick={() => setSelectedProvider('TELEGRAM')}
          className={`cursor-pointer p-5 rounded-2xl border transition-all relative overflow-hidden flex flex-col justify-between ${
            selectedProvider === 'TELEGRAM'
              ? 'bg-gradient-to-b from-blue-900/40 to-slate-900 border-blue-500/50 shadow-lg shadow-blue-500/10'
              : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#229ED9]/20 border border-[#229ED9]/30 flex items-center justify-center text-[#229ED9]">
                <Send className="w-6 h-6 transform -rotate-12 translate-x-0.5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Telegram</h3>
                <p className="text-xs text-slate-400">Canal o Grupo Privado</p>
              </div>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Recomendado
            </span>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
            <span>Conexión Directa HTTPS</span>
            {config?.telegram_configured && (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <Check className="w-3.5 h-3.5" /> Configurado
              </span>
            )}
          </div>
        </div>

        {/* Email SMTP Card */}
        <div 
          onClick={() => setSelectedProvider('EMAIL')}
          className={`cursor-pointer p-5 rounded-2xl border transition-all relative overflow-hidden flex flex-col justify-between ${
            selectedProvider === 'EMAIL'
              ? 'bg-gradient-to-b from-amber-900/30 to-slate-900 border-amber-500/50 shadow-lg shadow-amber-500/10'
              : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Correo SMTP</h3>
                <p className="text-xs text-slate-400">Alertas por Email</p>
              </div>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              Estándar
            </span>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
            <span>STARTTLS / SSL</span>
            {config?.email_password_configured && (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <Check className="w-3.5 h-3.5" /> Configurado
              </span>
            )}
          </div>
        </div>

        {/* WhatsApp Card */}
        <div 
          onClick={() => setSelectedProvider('WHATSAPP')}
          className={`cursor-pointer p-5 rounded-2xl border transition-all relative overflow-hidden flex flex-col justify-between ${
            selectedProvider === 'WHATSAPP'
              ? 'bg-gradient-to-b from-emerald-900/30 to-slate-900 border-emerald-500/50 shadow-lg shadow-emerald-500/10'
              : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">WhatsApp</h3>
                <p className="text-xs text-slate-400">Vía Twilio Business API</p>
              </div>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              Twilio
            </span>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
            <span>Mensajería Móvil</span>
            {config?.whatsapp_auth_token_configured && (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <Check className="w-3.5 h-3.5" /> Configurado
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Provider Specific Configuration Box */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">
                Parámetros de {selectedProvider === 'TELEGRAM' ? 'Telegram' : selectedProvider === 'EMAIL' ? 'Correo Electrónico (SMTP)' : 'WhatsApp (Twilio)'}
              </h2>
            </div>
            <span className="text-xs text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Cifrado AES-Fernet en Reposo
            </span>
          </div>

          {/* TELEGRAM SETTINGS */}
          {selectedProvider === 'TELEGRAM' && (
            <div className="space-y-5">
              {/* Help & Bot Token autofill */}
              <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-200/90 leading-relaxed">
                    <p className="font-semibold text-blue-300">¿Cómo conectar el Bot a tu Canal de Telegram?</p>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5 text-slate-300">
                      <li>Añade a tu bot como <b>Administrador</b> en tu canal con permiso de <i>"Publicar Mensajes"</i>.</li>
                      <li>Coloca el <b>@nombre_canal</b> (ej: <code>@AlkostoBackups</code>) o su ID numérico (ej: <code>-100234567890</code>).</li>
                      <li><b>Sin Webhooks:</b> La app envía directamente vía HTTPS saliente a <code>api.telegram.org</code>.</li>
                    </ol>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={fillDefaultTelegramToken}
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" /> Pegar Token del Bot
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Bot Token */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-300">
                      Telegram Bot Token <span className="text-rose-400">*</span>
                    </label>
                    {config?.telegram_bot_token_masked && (
                      <span className="text-[11px] text-emerald-400 font-mono">
                        Cifrado actual: {config.telegram_bot_token_masked}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showTelegramToken ? 'text' : 'password'}
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                      placeholder="8621888284:AAGCMCM19k_xMcv5h8xxfg9grFn1EHAsKD4"
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTelegramToken(!showTelegramToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      {showTelegramToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Token generado por @BotFather. Se guarda cifrado con AES-256 en la base de datos.
                  </p>
                </div>

                {/* Chat ID / Channel */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">
                    Canal o Chat ID <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="@CanalDeRespaldosAlkosto o -100xxxxxxxxxx"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-400">
                    Identificador del canal público (ej: <code>@respaldos_alkosto</code>) o privado (ej: <code>-100234567890</code>).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* EMAIL SETTINGS */}
          {selectedProvider === 'EMAIL' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium text-slate-300">Servidor SMTP</label>
                  <input
                    type="text"
                    value={emailSmtpHost}
                    onChange={(e) => setEmailSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com / smtp.office365.com"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Puerto</label>
                  <input
                    type="number"
                    value={emailSmtpPort}
                    onChange={(e) => setEmailSmtpPort(Number(e.target.value))}
                    placeholder="587"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Correo Remitente</label>
                  <input
                    type="email"
                    value={emailSender}
                    onChange={(e) => setEmailSender(e.target.value)}
                    placeholder="alertas@alkosto.com.co"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-300">Contraseña / Contraseña de App</label>
                    {config?.email_password_configured && (
                      <span className="text-[11px] text-emerald-400 font-mono">
                        (Contraseña guardada y cifrada)
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showEmailPassword ? 'text' : 'password'}
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      placeholder={config?.email_password_configured ? '•••••••••••• (dejar vacío para mantener)' : 'App Password'}
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEmailPassword(!showEmailPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      {showEmailPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">
                  Destinatarios de Alertas (separados por coma)
                </label>
                <input
                  type="text"
                  value={emailRecipients}
                  onChange={(e) => setEmailRecipients(e.target.value)}
                  placeholder="admin@alkosto.com.co, soporte.sistemas@alkosto.com.co"
                  className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="emailUseTls"
                  checked={emailUseTls}
                  onChange={(e) => setEmailUseTls(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-700 bg-slate-950 focus:ring-0"
                />
                <label htmlFor="emailUseTls" className="text-sm text-slate-300 cursor-pointer">
                  Habilitar cifrado TLS / STARTTLS (Recomendado para puertos 587)
                </label>
              </div>
            </div>
          )}

          {/* WHATSAPP SETTINGS */}
          {selectedProvider === 'WHATSAPP' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-300">Twilio Account SID</label>
                    {config?.whatsapp_account_sid_masked && (
                      <span className="text-[11px] text-emerald-400 font-mono">
                        {config.whatsapp_account_sid_masked}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={whatsappSid}
                    onChange={(e) => setWhatsappSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-300">Twilio Auth Token</label>
                    {config?.whatsapp_auth_token_configured && (
                      <span className="text-[11px] text-emerald-400 font-mono">
                        (Token guardado y cifrado)
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showWhatsappToken ? 'text' : 'password'}
                      value={whatsappToken}
                      onChange={(e) => setWhatsappToken(e.target.value)}
                      placeholder={config?.whatsapp_auth_token_configured ? '•••••••••••• (dejar vacío para mantener)' : 'Auth Token'}
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWhatsappToken(!showWhatsappToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      {showWhatsappToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Número Emisor Twilio (WhatsApp)</label>
                  <input
                    type="text"
                    value={whatsappFrom}
                    onChange={(e) => setWhatsappFrom(e.target.value)}
                    placeholder="+14155238886"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Número Destinatario</label>
                  <input
                    type="text"
                    value={whatsappTo}
                    onChange={(e) => setWhatsappTo(e.target.value)}
                    placeholder="+573001234567"
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Triggers Configuration */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Bell className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-semibold text-white">Eventos Disparadores de Alerta</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/50 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={notifyOnStart}
                onChange={(e) => setNotifyOnStart(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 rounded border-slate-700 bg-slate-900 focus:ring-0"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-200 block mb-0.5">Inicio de Respaldo</span>
                <span className="text-slate-400">Avisar tan pronto como arranque una tarea manual o programada.</span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/50 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={notifyOnSuccess}
                onChange={(e) => setNotifyOnSuccess(e.target.checked)}
                className="mt-1 w-4 h-4 text-emerald-600 rounded border-slate-700 bg-slate-900 focus:ring-0"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-200 block mb-0.5">Respaldo Exitoso ✅</span>
                <span className="text-slate-400">Enviar reporte detallado (tiendas, tamaño, duración) al finalizar con éxito.</span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950/50 border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={notifyOnError}
                onChange={(e) => setNotifyOnError(e.target.checked)}
                className="mt-1 w-4 h-4 text-rose-600 rounded border-slate-700 bg-slate-900 focus:ring-0"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-200 block mb-0.5">Fallo o Error 🚨</span>
                <span className="text-slate-400">Alerta prioritaria si un servidor falla, Google Drive se desconecta o la red cae.</span>
              </div>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <button
            type="button"
            onClick={handleTestNotification}
            disabled={testing || saving}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {testing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                <span>Enviando mensaje de prueba...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 text-blue-400" />
                <span>Probar Notificación en Vivo</span>
              </>
            )}
          </button>

          <button
            type="submit"
            disabled={saving || testing}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Guardar Configuración</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
