/**
 * LeadsFlow — Preload Script
 * Expõe API segura para o renderer via contextBridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Window controls
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),

  // Mensagens
  getMensagens: () => ipcRenderer.invoke("get-mensagens"),
  saveMensagens: (msgs) => ipcRenderer.invoke("save-mensagens", msgs),

  // Leads
  getLeads: () => ipcRenderer.invoke("get-leads"),
  getStats: () => ipcRenderer.invoke("get-stats"),
  getLeadLists: () => ipcRenderer.invoke("get-lead-lists"),
  createLeadList: (nome) => ipcRenderer.invoke("create-lead-list", nome),
  setActiveLeadList: (listId) => ipcRenderer.invoke("set-active-lead-list", listId),
  renameLeadList: (listId, novoNome) => ipcRenderer.invoke("rename-lead-list", listId, novoNome),
  deleteLeadList: (listId) => ipcRenderer.invoke("delete-lead-list", listId),
  deleteLead: (telefone) => ipcRenderer.invoke("delete-lead", telefone),
  resetLead: (telefone) => ipcRenderer.invoke("reset-lead", telefone),

  // WhatsApp view
  showWhatsApp: () => ipcRenderer.send("show-whatsapp"),
  hideWhatsApp: () => ipcRenderer.send("hide-whatsapp"),

  // Maps view
  showMaps: () => ipcRenderer.send("show-maps"),
  hideMaps: () => ipcRenderer.send("hide-maps"),

  // Bot
  startSearch: () => ipcRenderer.invoke("start-search"),
  startCampaign: () => ipcRenderer.invoke("start-campaign"),
  startAutopilot: () => ipcRenderer.invoke("start-autopilot"),
  stopBot: () => ipcRenderer.send("stop-bot"),

  // AI
  sugerirNichos: (params) => ipcRenderer.invoke("ai-sugerir-nichos", params),
  aiAutoConfig: (params) => ipcRenderer.invoke("ai-auto-config", params),
  aiGerarMensagens: () => ipcRenderer.invoke("ai-gerar-mensagens"),

  // Chat IA
  chatGetSessions: () => ipcRenderer.invoke("chat-get-sessions"),
  chatCreateSession: () => ipcRenderer.invoke("chat-create-session"),
  chatSendMessage: (sessaoId, mensagem) => ipcRenderer.invoke("chat-send-message", { sessaoId, mensagem }),
  chatDeleteSession: (id) => ipcRenderer.invoke("chat-delete-session", id),
  chatRenameSession: (id, titulo) => ipcRenderer.invoke("chat-rename-session", { id, titulo }),

  // Auth
  authLogin: (email, password, rememberMe) => ipcRenderer.invoke("auth-login", email, password, rememberMe),
  authRegister: (email, password, rememberMe) => ipcRenderer.invoke("auth-register", email, password, rememberMe),
  authLogout: () => ipcRenderer.invoke("auth-logout"),
  authSession: () => ipcRenderer.invoke("auth-session"),
  authSuccess: () => ipcRenderer.send("auth-success"),
  authGoogle: () => ipcRenderer.invoke("auth-google"),
  authLoadSavedSession: () => ipcRenderer.invoke("auth-load-saved-session"),

  // AI Observer
  aiObserverToggle: (enabled) => ipcRenderer.invoke("ai-observer-toggle", enabled),
  aiObserverStatus: () => ipcRenderer.invoke("ai-observer-status"),
  aiObserverRefresh: () => ipcRenderer.invoke("ai-observer-refresh"),

  // Schedule
  getScheduleStatus: () => ipcRenderer.invoke("get-schedule-status"),

  // Auto-update
  updateInstall: () => ipcRenderer.send("update-install"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_, data) => callback(data));
  },

  // Events from main
  onLog: (callback) => {
    ipcRenderer.on("log", (_, data) => callback(data));
  },
  onStatusUpdate: (callback) => {
    ipcRenderer.on("status-update", (_, data) => callback(data));
  },
  onShowMapsPanel: (callback) => {
    ipcRenderer.on("show-maps-panel", () => callback());
  },
  onAutopilotUpdate: (callback) => {
    ipcRenderer.on("autopilot-update", (_, data) => callback(data));
  },
  onAiObserverUpdate: (callback) => {
    ipcRenderer.on("ai-observer-update", (_, data) => callback(data));
  },

  // Workflow events
  onWorkflowStep: (callback) => {
    ipcRenderer.on("workflow-step", (_, data) => callback(data));
  },
});
