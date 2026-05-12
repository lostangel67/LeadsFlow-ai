/**
 * LeadsFlow — Electron Main Process
 * Janela principal, navegadores embutidos (WhatsApp + Maps), piloto automático e IPC.
 * TUDO roda dentro da janela do Electron — nenhum navegador externo é aberto.
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { app, BrowserWindow, ipcMain, session, BrowserView } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

// Auto-update config
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Módulos do bot
const { formatarTelefone, telefoneSemFormatacao } = require("../src/utils/phoneFormatter");
const { escolherMensagem, escolherMensagemIA, mensagensAbertura } = require("../src/utils/mensagens");
const { sugerirNichos, avaliarLead, gerarMensagem, chatComIA, extrairContextoChat, autoConfigurar, gerarMensagensTemplate } = require("../src/services/aiService");
const { avaliarLeads, ordenarPorScore } = require("../src/services/leadScoringService");
const { getSupabase } = require("../src/services/supabaseClient");
const db = require("../src/services/dbService");

let mainWindow = null;
let whatsappView = null;
let mapsView = null;
let mapsWorkerSeq = 0;
let isRunning = false;
let shouldStop = false;
let currentUserId = null;
let autoUpdaterSetup = false;

// Cidades e nichos para o piloto automático (seleção aleatória)
const cidadesBrasil = [
  "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Brasília", "Salvador",
  "Fortaleza", "Curitiba", "Recife", "Porto Alegre", "Goiânia", "Belém",
  "Manaus", "São Luís", "Maceió", "Natal", "João Pessoa", "Teresina",
  "Campo Grande", "Cuiabá", "Florianópolis", "Aracaju", "Palmas",
  "Boa Vista", "Rio Branco", "Macapá", "Porto Velho", "Vitória",
];

const nichosDisponiveis = [
  "dentistas", "advogados", "contadores", "academias", "restaurantes",
  "salão de beleza", "pet shop", "clínicas médicas", "imobiliárias",
  "oficinas mecânicas", "escolas", "padarias", "farmácias", "hotéis",
  "clínicas veterinárias",
];

function parseListInput(value) {
  if (!value) return [];
  return String(value)
    .split(/[\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function obterNichosDaConfig(config) {
  if (Array.isArray(config.nichos) && config.nichos.length > 0) return [...new Set(config.nichos)];
  const multi = parseListInput(config.nichos_texto || "");
  if (multi.length > 0) return [...new Set(multi)];
  return [config.nicho || "dentistas"];
}

function obterCidadesDaConfig(config) {
  if (config.modo === "brasil") return [...cidadesBrasil];
  const cidadesCustom = parseListInput(config.cidades || config.cidade || "");
  return cidadesCustom.length > 0 ? cidadesCustom : (config.cidade ? [config.cidade] : []);
}

function escolherAleatorio(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function embaralharArray(arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function montarCombinacoesBusca({ modoBusca, cidades, nichos, config }) {
  const combinacoes = [];
  const nichosEmbaralhados = embaralharArray(nichos);

  // Estratégia solicitada:
  // em "brasil", alterna nicho por cidade em blocos de max_leads_por_cidade.
  // Ex: 15 leads por cidade => 15 por nicho sorteado para cada cidade.
  if (modoBusca === "brasil") {
    const usarNichoAleatorioPorCidade =
      config.buscar_todos_nichos || nichos.length > 1 || config.nicho_aleatorio_por_cidade !== false;

    for (const cidadeAtual of cidades) {
      const nichoEscolhido = usarNichoAleatorioPorCidade
        ? (escolherAleatorio(nichosEmbaralhados) || config.nicho || "dentistas")
        : (nichosEmbaralhados[0] || config.nicho || "dentistas");
      combinacoes.push({ nicho: nichoEscolhido, cidade: cidadeAtual });
    }

    return combinacoes;
  }

  // Em modo cidade: roda todas as combinações selecionadas (nicho x cidade)
  const cidadesEmbaralhadas = embaralharArray(cidades);
  for (const nichoAtual of nichosEmbaralhados) {
    for (const cidadeAtual of cidadesEmbaralhadas) {
      combinacoes.push({ nicho: nichoAtual, cidade: cidadeAtual });
    }
  }
  return embaralharArray(combinacoes);
}

// ===================== CONFIG PERSISTENCE =====================

async function loadConfig() {
  const defaults = {
    nicho: "dentistas", nichos: ["dentistas"], nichos_texto: "",
    buscar_todos_nichos: false, autopilot_busca_sempre: true,
    ai_enabled: false, ai_produto: "", ai_objetivo: "", ai_tom: "profissional", ai_min_score: 40,
    modo: "brasil", cidade: "", cidades: "",
    delay_min: 35, delay_max: 85, limite_diario: 40, max_leads_por_cidade: 500,
    active_list_id: "padrao",
    schedule_enabled: false, schedule_start: "09:00", schedule_end: "18:00",
    schedule_days: [1, 2, 3, 4, 5], schedule_lunch_start: "12:00", schedule_lunch_end: "13:00",
    max_per_hour: 10,
    first_run: true,
  };
  if (!currentUserId) return defaults;
  try {
    const config = await db.loadConfig(currentUserId);
    return config ? { ...defaults, ...config } : defaults;
  } catch (_) { return defaults; }
}

async function saveConfig(config) {
  if (!currentUserId) return;
  await db.saveConfig(currentUserId, config);
}

async function loadMensagens() {
  if (!currentUserId) return [...mensagensAbertura];
  try {
    const msgs = await db.loadMensagens(currentUserId);
    return Array.isArray(msgs) && msgs.length > 0 ? msgs : [...mensagensAbertura];
  } catch (_) { return [...mensagensAbertura]; }
}

async function saveMensagens(msgs) {
  if (!currentUserId) return;
  await db.saveMensagens(currentUserId, msgs);
}

// ===================== LOGGING =====================

function emitLog(type, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", { type, message, time: new Date().toISOString() });
  }
}

function emitStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status-update", data);
  }
}

function emitAutopilot(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("autopilot-update", data);
  }
}

function emitWorkflow(step, state, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workflow-step", { step, state, detail });
  }
}

// ===================== WHATSAPP VIEW =====================

function createWhatsAppView() {
  if (whatsappView) return;
  whatsappView = new BrowserView({
    webPreferences: {
      partition: "persist:whatsapp",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.addBrowserView(whatsappView);
  positionEmbeddedView(whatsappView);

  whatsappView.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  whatsappView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes("web.whatsapp.com") || url.includes("wa.me")) {
      whatsappView.webContents.loadURL(url);
    }
    return { action: "deny" };
  });

  whatsappView.webContents.on("will-navigate", (event, url) => {
    if (url.includes("web.whatsapp.com") || url.includes("wa.me") || url.includes("whatsapp.com")) return;
    event.preventDefault();
  });

  whatsappView.webContents.loadURL("https://web.whatsapp.com");
}

// ===================== MAPS VIEW =====================

function createMapsView() {
  if (mapsView) return;
  mapsView = new BrowserView({
    webPreferences: {
      partition: "persist:maps",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.addBrowserView(mapsView);
  positionEmbeddedView(mapsView);

  mapsView.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );

  mapsView.webContents.on("did-start-navigation", () => {
    mapsView.webContents.executeJavaScript(
      `Object.defineProperty(navigator, 'webdriver', { get: () => undefined });`
    ).catch(() => {});
  });

  mapsView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function showMapsView() {
  if (!mapsView) createMapsView();
  else {
    mainWindow.addBrowserView(mapsView);
    positionEmbeddedView(mapsView);
  }
}

function hideMapsView() {
  if (mapsView && mainWindow) mainWindow.removeBrowserView(mapsView);
}

function createMapsWorkerView() {
  mapsWorkerSeq += 1;
  const workerWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: `Maps Worker ${mapsWorkerSeq}`,
    autoHideMenuBar: true,
    webPreferences: {
      partition: `persist:maps-worker-${mapsWorkerSeq}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  workerWindow.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  );
  return workerWindow;
}

function destroyMapsWorkerView(workerWindow) {
  if (!workerWindow) return;
  try {
    if (!workerWindow.isDestroyed()) workerWindow.close();
  } catch (_) {}
}

// ===================== POSITIONING =====================

function positionEmbeddedView(view) {
  if (!view || !mainWindow) return;
  const bounds = mainWindow.getContentBounds();
  view.setBounds({
    x: 260,
    y: 0,
    width: bounds.width - 260,
    height: bounds.height - 40,
  });
}

function showWhatsAppView() {
  if (!whatsappView) createWhatsAppView();
  else {
    mainWindow.addBrowserView(whatsappView);
    positionEmbeddedView(whatsappView);
  }
}

function hideWhatsAppView() {
  if (whatsappView && mainWindow) mainWindow.removeBrowserView(whatsappView);
}

// ===================== MAIN WINDOW =====================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.on("resize", () => {
    positionEmbeddedView(whatsappView);
    positionEmbeddedView(mapsView);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    whatsappView = null;
    mapsView = null;
  });

  if (!autoUpdaterSetup) {
    autoUpdaterSetup = true;
    setupAutoUpdater();
  }
}

// ===================== IPC HANDLERS =====================

ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());

ipcMain.handle("get-config", async () => loadConfig());
ipcMain.handle("save-config", async (_, config) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) return { error: "Config inválida" };
  try {
    await saveConfig(config);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("get-mensagens", async () => loadMensagens());
ipcMain.handle("save-mensagens", async (_, msgs) => {
  if (!Array.isArray(msgs)) return { error: "Mensagens inválidas" };
  await saveMensagens(msgs);
  return { success: true };
});

ipcMain.handle("get-leads", async () => {
  if (!currentUserId) return [];
  const config = await loadConfig();
  return db.carregarLeads(currentUserId, config.active_list_id || "padrao");
});
ipcMain.handle("get-stats", async () => {
  if (!currentUserId) return { total: 0, contatados: 0, pendentes: 0, totalEnviados: 0, totalInvalidos: 0 };
  const config = await loadConfig();
  return db.obterEstatisticas(currentUserId, config.active_list_id || "padrao");
});
ipcMain.handle("get-lead-lists", async () => {
  if (!currentUserId) return { lists: [], activeListId: "padrao" };
  const lists = await db.carregarTodasAsListas(currentUserId);
  const activeListId = await db.obterListaAtiva(currentUserId);
  return { lists, activeListId };
});
ipcMain.handle("create-lead-list", async (_, nome) => {
  if (!nome || typeof nome !== "string") return { error: "Nome inválido" };
  return db.criarLista(currentUserId, nome);
});
ipcMain.handle("set-active-lead-list", async (_, listId) => {
  if (!listId || typeof listId !== "string") return { error: "ID da lista inválido" };
  return db.definirListaAtiva(currentUserId, listId);
});
ipcMain.handle("rename-lead-list", async (_, listId, novoNome) => {
  if (!listId || typeof listId !== "string") return { error: "ID da lista inválido" };
  if (!novoNome || typeof novoNome !== "string") return { error: "Novo nome inválido" };
  return db.renomearLista(currentUserId, listId, novoNome);
});
ipcMain.handle("delete-lead-list", async (_, listId) => {
  if (!listId || typeof listId !== "string") return { error: "ID da lista inválido" };
  return db.excluirLista(currentUserId, listId);
});
ipcMain.handle("delete-lead", async (_, telefone) => {
  if (!telefone || typeof telefone !== "string") return { error: "Telefone inválido" };
  if (!currentUserId) return { success: false };
  await db.deletarLead(currentUserId, telefone);
  return { success: true };
});
ipcMain.handle("reset-lead", async (_, telefone) => {
  if (!telefone || typeof telefone !== "string") return { error: "Telefone inválido" };
  if (!currentUserId) return { success: false };
  await db.resetarLead(currentUserId, telefone);
  return { success: true };
});

ipcMain.on("show-whatsapp", () => showWhatsAppView());
ipcMain.on("hide-whatsapp", () => hideWhatsAppView());
ipcMain.on("show-maps", () => showMapsView());
ipcMain.on("hide-maps", () => hideMapsView());

ipcMain.on("stop-bot", () => {
  shouldStop = true;
  emitLog("aviso", "⛔ Parada solicitada...");
});

// ===================== LOGIN WINDOW =====================

let loginWindow = null;

function createLoginWindow() {
  if (loginWindow) return;
  loginWindow = new BrowserWindow({
    width: 420,
    height: 580,
    resizable: false,
    frame: false,
    backgroundColor: "#0a0a1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loginWindow.loadFile(path.join(__dirname, "..", "renderer", "login.html"));
  loginWindow.on("closed", () => { loginWindow = null; });
}

function closeLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
  }
  loginWindow = null;
}

// ===================== SESSION PERSISTENCE =====================

function getSessionFilePath() {
  return path.join(app.getPath("userData"), "session.json");
}

function saveSessionFile(session) {
  try {
    const data = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user_id: session.user.id,
    };
    fs.writeFileSync(getSessionFilePath(), JSON.stringify(data, null, 2));
  } catch (_) {}
}

function loadSessionFile() {
  try {
    const filePath = getSessionFilePath();
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (_) {
    return null;
  }
}

function clearSessionFile() {
  try {
    const filePath = getSessionFilePath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

// ===================== AUTH HANDLERS =====================

ipcMain.handle("auth-login", async (_, email, password, rememberMe) => {
  if (!email || typeof email !== "string") return { error: "Email inválido" };
  if (!password || typeof password !== "string") return { error: "Senha inválida" };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    currentUserId = data.user.id;
    if (rememberMe && data.session) saveSessionFile(data.session);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("auth-register", async (_, email, password, rememberMe) => {
  if (!email || typeof email !== "string") return { error: "Email inválido" };
  if (!password || typeof password !== "string") return { error: "Senha inválida" };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    if (data.user && !data.session) return { needsConfirmation: true };
    currentUserId = data.user.id;
    if (rememberMe && data.session) saveSessionFile(data.session);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("auth-logout", async () => {
  try {
    clearSessionFile();
    const supabase = getSupabase();
    await supabase.auth.signOut();
    currentUserId = null;
    closeLoginWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    createLoginWindow();
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("auth-session", async () => {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      currentUserId = data.session.user.id;
      return { authenticated: true };
    }
    return { authenticated: false };
  } catch (_) {
    return { authenticated: false };
  }
});

ipcMain.handle("auth-load-saved-session", async () => {
  try {
    const saved = loadSessionFile();
    if (!saved || !saved.refresh_token) return { authenticated: false };
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.setSession({
      access_token: saved.access_token,
      refresh_token: saved.refresh_token,
    });
    if (error || !data.session) {
      clearSessionFile();
      return { authenticated: false };
    }
    currentUserId = data.session.user.id;
    saveSessionFile(data.session);
    return { authenticated: true };
  } catch (_) {
    clearSessionFile();
    return { authenticated: false };
  }
});

ipcMain.on("auth-success", () => {
  closeLoginWindow();
  createWindow();
});

ipcMain.handle("auth-google", async () => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };

    const authWindow = new BrowserWindow({
      width: 500, height: 700,
      parent: loginWindow, modal: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    authWindow.setMenuBarVisibility(false);
    authWindow.loadURL(data.url);

    return await new Promise((resolve) => {
      authWindow.webContents.on("will-navigate", (_, url) => {
        if (url.includes("access_token") || url.includes("error")) {
          handleOAuthRedirect(url, supabase, authWindow, resolve);
        }
      });
      authWindow.webContents.on("will-redirect", (_, url) => {
        if (url.includes("access_token") || url.includes("error")) {
          handleOAuthRedirect(url, supabase, authWindow, resolve);
        }
      });
      authWindow.on("closed", () => resolve({ error: "Login cancelado" }));
    });
  } catch (err) {
    return { error: err.message };
  }
});

async function handleOAuthRedirect(url, supabase, authWindow, resolve) {
  try {
    const hash = new URL(url).hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) { resolve({ error: error.message }); }
      else {
        currentUserId = data.user.id;
        resolve({ success: true });
      }
    } else {
      resolve({ error: "Token não encontrado" });
    }
  } catch (err) {
    resolve({ error: err.message });
  }
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
}

// ===================== AI HANDLERS =====================

ipcMain.handle("ai-sugerir-nichos", async (_, params) => {
  if (params !== undefined && params !== null && typeof params !== "object" && typeof params !== "string") return { error: "Parâmetros inválidos" };
  try {
    const { produto, score } = typeof params === "object" ? params : { produto: params, score: 40 };
    const nichos = await sugerirNichos(produto || "");
    return { nichos: nichos || [] };
  } catch (err) {
    console.error("Erro ao sugerir nichos:", err.message);
    return { nichos: [] };
  }
});

ipcMain.handle("ai-auto-config", async (_, { nicho, produto, objetivo }) => {
  try {
    if (!produto) return { error: "Descreva o produto antes de configurar" };
    const resultado = await autoConfigurar(nicho, produto, objetivo || "");
    return { success: true, config: resultado };
  } catch (err) {
    console.error("Erro na auto-configuração:", err.message);
    return { error: err.message };
  }
});

ipcMain.handle("ai-gerar-mensagens", async () => {
  try {
    const config = await loadConfig();
    if (!config.ai_produto) return { error: "Preencha o produto/serviço na aba IA antes de gerar mensagens." };
    const mensagens = await gerarMensagensTemplate(config.ai_produto, config.nichos?.join(", ") || config.nicho, config.ai_tom || "profissional", 5, config.ai_objetivo || "");
    return { success: true, mensagens };
  } catch (err) {
    console.error("Erro ao gerar mensagens:", err.message);
    return { error: err.message };
  }
});

// ===================== AI OBSERVER =====================

const chatObserver = require("../src/services/chatObserverService");
let observerInterval = null;
let observerEnabled = false;

ipcMain.handle("ai-observer-toggle", async (_, enabled) => {
  observerEnabled = enabled;
  if (enabled) startObserver();
  else stopObserver();
  return { success: true, status: enabled ? "active" : "stopped" };
});

ipcMain.handle("ai-observer-status", async () => ({
  enabled: observerEnabled,
  hasAnalysis: !!chatObserver.getLastAnalysis(),
  lastAnalysis: chatObserver.getLastAnalysis(),
  lastMessages: chatObserver.getLastMessages().slice(-5),
}));

ipcMain.handle("ai-observer-refresh", async () => {
  if (!whatsappView) return { error: "WhatsApp não conectado" };
  const messages = await chatObserver.extractCurrentChat(whatsappView.webContents);
  chatObserver.setLastMessages(messages);
  if (messages.length > 0) {
    const config = await loadConfig();
    const analysis = await chatObserver.analyzeAndSuggest(messages, {
      produto: config.ai_produto || "", nicho: config.nicho || "", tom: config.ai_tom || "profissional", objetivo: config.ai_objetivo || "",
    });
    if (analysis && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("ai-observer-update", { messages: messages.slice(-5), analysis });
    }
    return { messages: messages.slice(-5), analysis };
  }
  return { messages: [], analysis: null };
});

ipcMain.handle("get-schedule-status", async () => {
  const config = await loadConfig();
  return { enabled: config.schedule_enabled || false, withinSchedule: isWithinSchedule(config) };
});

function startObserver() {
  if (observerInterval) return;
  observerInterval = setInterval(async () => {
    if (!observerEnabled || !whatsappView) return;
    try {
      const messages = await chatObserver.extractCurrentChat(whatsappView.webContents);
      const prev = chatObserver.getLastMessages();
      const changed = messages.length !== prev.length ||
        (messages.length > 0 && prev.length > 0 && messages[messages.length - 1].text !== prev[prev.length - 1].text);
      if (changed && messages.length > 0) {
        chatObserver.setLastMessages(messages);
        const config = await loadConfig();
        const analysis = await chatObserver.analyzeAndSuggest(messages, {
          produto: config.ai_produto || "", nicho: config.nicho || "", tom: config.ai_tom || "profissional", objetivo: config.ai_objetivo || "",
        });
        if (analysis && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("ai-observer-update", { messages: messages.slice(-5), analysis });
        }
      }
    } catch (_) {}
  }, 5000);
}

function stopObserver() {
  if (observerInterval) { clearInterval(observerInterval); observerInterval = null; }
}

// ===================== CHAT IA SESSIONS (Supabase) =====================

ipcMain.handle("chat-get-sessions", async () => {
  if (!currentUserId) return [];
  try { return await db.carregarSessoes(currentUserId); } catch (_) { return []; }
});

ipcMain.handle("chat-create-session", async () => {
  if (!currentUserId) return { error: "Não autenticado" };
  try { return await db.criarSessao(currentUserId); } catch (err) { return { error: err.message }; }
});

ipcMain.handle("chat-send-message", async (_, { sessaoId, mensagem }) => {
  if (!sessaoId || typeof sessaoId !== "string") return { error: "ID da sessão inválido" };
  if (!mensagem || typeof mensagem !== "string") return { error: "Mensagem inválida" };
  if (!currentUserId) return { error: "Não autenticado" };
  try {
    await db.adicionarMensagem(currentUserId, sessaoId, "user", mensagem);
    const sessao = await db.obterSessao(currentUserId, sessaoId);
    if (!sessao) return { error: "Sessão não encontrada" };

    const historico = sessao.mensagens;
    const config = await loadConfig();
    const stats = await db.obterEstatisticas(currentUserId, config.active_list_id || "padrao");
    const contexto = {
      produto: config.ai_produto || "",
      objetivo: config.ai_objetivo || "",
      nicho: config.nicho || "",
      nichos: obterNichosDaConfig(config),
      tom: config.ai_tom || "profissional",
      stats,
    };
    const resposta = await chatComIA(historico.slice(0, -1), mensagem, contexto);

    if (resposta) {
      await db.adicionarMensagem(currentUserId, sessaoId, "assistant", resposta);
      return { resposta };
    }
    return { error: "Sem resposta da IA" };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("chat-delete-session", async (_, id) => {
  if (!id || typeof id !== "string") return { error: "ID da sessão inválido" };
  if (!currentUserId) return { error: "Não autenticado" };
  try {
    await db.excluirSessao(currentUserId, id);
    return { success: true };
  } catch (_) {
    return { error: "Erro ao excluir" };
  }
});

ipcMain.handle("chat-rename-session", async (_, { id, titulo }) => {
  if (!id || typeof id !== "string") return { error: "ID da sessão inválido" };
  if (!titulo || typeof titulo !== "string") return { error: "Título inválido" };
  if (!currentUserId) return { error: "Não autenticado" };
  try {
    await db.renomearSessao(currentUserId, id, titulo);
    return { success: true };
  } catch (_) {
    return { error: "Erro ao renomear" };
  }
});

// ===================== MAPS SCRAPER (EMBUTIDO) =====================

async function buscarLeadsMapEmbutido(config) {
  const { nicho, modo, cidade, max_leads_por_cidade = 500 } = config;
  const cidades = modo === "brasil" ? cidadesBrasil : [cidade];
  const numerosJaUsados = new Set(await db.obterTodosEnviados(currentUserId));
  const todosLeads = [];

  emitWorkflow("init", "running", `Nicho: ${nicho} | ${cidades.length} cidade(s)`);
  emitLog("info", `🌎 Busca — Nicho: ${nicho} | ${cidades.length} cidade(s) | ${numerosJaUsados.size} no histórico`);

  showMapsView();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("show-maps-panel");
  }

  const wc = mapsView.webContents;
  emitWorkflow("init", "done", `${cidades.length} cidades configuradas`);

  let erros = 0;
  try {
    for (let i = 0; i < cidades.length; i++) {
      if (shouldStop) { emitLog("aviso", "⛔ Busca interrompida."); break; }
      const cidadeAtual = cidades[i];
      const termoBusca = `${nicho} em ${cidadeAtual}`;
      emitLog("info", `🔍 [${i + 1}/${cidades.length}] "${termoBusca}"`);
      emitWorkflow("search", "running", `[${i + 1}/${cidades.length}] ${termoBusca}`);
      emitStatus({ state: "buscando", message: `Buscando: ${termoBusca}...`, autopilotPhase: "BUSCANDO LEADS" });

      try {
        const leads = await extrairLeadsDaCidadeEmbutido(wc, termoBusca, cidadeAtual, nicho, {
          max_leads_por_cidade, numerosJaUsados,
        });
        todosLeads.push(...leads);
        emitLog("sucesso", `✅ ${leads.length} leads de ${cidadeAtual}`);
        emitWorkflow("search", "done", `${leads.length} leads em ${cidadeAtual}`);
      } catch (err) {
        erros++;
        emitLog("erro", `❌ Erro em ${cidadeAtual}: ${err.message}`);
        emitWorkflow("search", "error", err.message);
      }

      if (i < cidades.length - 1 && !shouldStop) await sleep(2000 + Math.random() * 2000);
    }
  } catch (err) {
    erros++;
    emitLog("erro", `❌ Erro geral: ${err.message}`);
  }

  emitWorkflow("save", "running", "Finalizando...");
  emitLog("info", `🔒 Busca finalizada: ${todosLeads.length} leads`);
  emitWorkflow("save", "done", `${todosLeads.length} leads totais`);
  return todosLeads;
}

async function extrairLeadsDaCidadeEmbutido(wc, termoBusca, cidade, nicho, opcoes) {
  const { max_leads_por_cidade, numerosJaUsados } = opcoes;
  const leads = [];
  // 9999 = "pegar tudo possível"
  const limiteReal = (!max_leads_por_cidade || max_leads_por_cidade >= 500) ? 9999 : max_leads_por_cidade;

  const url = `https://www.google.com/maps/search/${encodeURIComponent(termoBusca)}`;
  await wc.loadURL(url);
  await sleep(4000);

  // Cookie consent
  await wc.executeJavaScript(`
    (function() {
      var s = ['button[aria-label*="Aceitar"]','button[aria-label*="Accept"]','form:nth-child(2) button','button[jsname="higCR"]'];
      for (var i=0;i<s.length;i++){var b=document.querySelector(s[i]);if(b){b.click();return true;}}
      return false;
    })()
  `).catch(() => {});
  await sleep(2000);

  // Scroll até o fim da lista (sem limite fixo de vezes)
  emitWorkflow("scroll", "running", "Rolando lista...");
  emitLog("info", "   📜 Rolando lista até o fim...");
  let alturaAnterior = 0;
  let semMudancas = 0;
  for (let i = 0; i < 150; i++) {  // 150 scrolls máximo de segurança
    if (shouldStop) break;
    const result = await wc.executeJavaScript(`
      (function(){
        var s=['div[role="feed"]','div.m6QErb.DxyBCb','div.m6QErb'];
        var c=null;for(var i=0;i<s.length;i++){c=document.querySelector(s[i]);if(c)break;}
        if(!c)return{found:false,altura:0,fim:false};
        c.scrollBy(0,3000);
        var h=c.scrollHeight;
        var t=document.body.textContent;
        var f=t.includes("chegou ao fim")||t.includes("end of results")||t.includes("No more results");
        return{found:true,altura:h,fim:f};
      })()
    `).catch(() => ({ found: false, altura: 0, fim: false }));

    if (!result.found) break;

    await sleep(1500);  // Espera o conteúdo carregar antes de medir

    // Verifica altura DEPOIS de esperar o carregamento
    const alturaAtual = await wc.executeJavaScript(`
      (function(){
        var s=['div[role="feed"]','div.m6QErb.DxyBCb','div.m6QErb'];
        var c=null;for(var i=0;i<s.length;i++){c=document.querySelector(s[i]);if(c)break;}
        if(!c)return 0;
        var t=document.body.textContent;
        var f=t.includes("chegou ao fim")||t.includes("end of results")||t.includes("No more results");
        return f?-1:c.scrollHeight;
      })()
    `).catch(() => 0);

    if (alturaAtual === -1) break;  // "chegou ao fim" detectado

    if (alturaAtual === alturaAnterior) {
      semMudancas++;
      if (semMudancas >= 3) break;  // 3 scrolls sem mudança = fim real da lista
    } else {
      semMudancas = 0;
    }
    alturaAnterior = alturaAtual;
  }

  // Batch extract — seleciona apenas div.Nv2PK (o card completo) para evitar duplicatas
  // O seletor anterior ('div.Nv2PK, a.hfpxzc') retornava cada resultado 2x (o div e o link dentro)
  emitWorkflow("scroll", "done", "Lista carregada");
  emitWorkflow("extract", "running", "Extraindo cards...");
  emitLog("info", "   ⚡ Extraindo dados...");
  const dadosBrutos = await wc.executeJavaScript(`
    (function(){
      var r = [];
      var cards = document.querySelectorAll('div.Nv2PK');
      if (cards.length === 0) {
        // Fallback: sem div.Nv2PK, tenta a.hfpxzc direto
        cards = document.querySelectorAll('a.hfpxzc');
      }
      cards.forEach(function(card) {
        try {
          var nome = null;
          var telefone = null;
          var href = null;

          // Pega o link interno (a.hfpxzc) para nome e href
          var link = card.querySelector('a.hfpxzc') || (card.tagName === 'A' ? card : null);
          if (link) {
            nome = (link.getAttribute('aria-label') || '').trim();
            href = link.getAttribute('href') || null;
          }
          // Fallback para nome via texto
          if (!nome) {
            var nomeEl = card.querySelector('.fontHeadlineSmall, .qBF1Pd');
            if (nomeEl) nome = nomeEl.textContent.trim();
          }

          // Procura telefone nos elementos de informação do card
          var infos = card.querySelectorAll('.W4Efsd, .UsdlK, span');
          for (var i = 0; i < infos.length; i++) {
            var m = infos[i].textContent.match(/\\(?\\d{2}\\)?\\s*\\d{4,5}[\\s\\-]?\\d{4}/);
            if (m) { telefone = m[0]; break; }
          }

          if (nome) r.push({ nome: nome, telefone: telefone, temTelefone: !!telefone, href: href });
        } catch(_) {}
      });
      return r;
    })()
  `).catch(() => []);

  emitLog("info", `   📋 ${dadosBrutos.length} resultados encontrados`);

  const comTel = dadosBrutos.filter(d => d.temTelefone);
  const semTel = dadosBrutos.filter(d => !d.temTelefone);
  emitLog("info", `   📞 ${comTel.length} com tel. visível | 🔍 ${semTel.length} sem tel. (tentará abrir)`);
  emitWorkflow("extract", "done", `${comTel.length} com tel, ${semTel.length} sem tel`);

  // Coleta TODOS com telefone visível (sem parar no limite — aplica só no final)
  let ignorados = 0;
  for (const d of comTel) {
    const tel = formatarTelefone(d.telefone);
    if (tel) {
      if (numerosJaUsados.has(tel)) { ignorados++; continue; }
      leads.push({ nome: d.nome, telefone: tel, cidade, nicho });
      numerosJaUsados.add(tel);
    }
  }
  if (ignorados > 0) emitLog("info", `   🔄 ${ignorados} já enviados/coletados`);

  // Para os sem telefone: navega pelo href do card (muito mais confiável que clicar por nome)
  if (leads.length < limiteReal && semTel.length > 0 && !shouldStop) {
    const faltam = limiteReal - leads.length;
    const alvos = semTel.filter(d => d.href).slice(0, Math.min(faltam, semTel.length));
    const semHref = semTel.filter(d => !d.href).length;
    emitLog("info", `   🔎 Abrindo ${alvos.length} páginas para buscar telefone${semHref > 0 ? ` (${semHref} sem link, pulados)` : ''}...`);
    emitWorkflow("phone", "running", `${alvos.length} páginas...`);

    // Guarda a URL da lista para voltar depois
    const urlLista = `https://www.google.com/maps/search/${encodeURIComponent(termoBusca)}`;

    for (const d of alvos) {
      if (shouldStop || leads.length >= limiteReal) break;
      try {
        // Navega diretamente para a página do estabelecimento via href
        const urlAlvo = d.href.startsWith('http') ? d.href : `https://www.google.com${d.href}`;
        await wc.loadURL(urlAlvo);
        await sleep(2500);

        const tel = await wc.executeJavaScript(`
          (function(){
            // Método 1: link tel:
            var telLink = document.querySelector('a[href^="tel:"]');
            if (telLink) return telLink.getAttribute('href').replace('tel:', '').trim();

            // Método 2: botão de telefone
            var s = [
              'button[data-tooltip="Copiar número de telefone"]',
              'button[data-tooltip="Copy phone number"]',
              'button[aria-label*="Telefone"]',
              'button[aria-label*="Phone"]',
              'button[data-item-id*="phone"]'
            ];
            for (var i = 0; i < s.length; i++) {
              var e = document.querySelector(s[i]);
              if (e) {
                var t = e.getAttribute('aria-label') || e.textContent || '';
                var m = t.match(/[\\d\\s\\-()+ ]{8,}/);
                if (m) return m[0].trim();
              }
            }

            // Método 3: seção de informações
            var infos = document.querySelectorAll('[data-section-id="pn0"] .Io6YTe, .rogA2c .Io6YTe, .Io6YTe');
            for (var j = 0; j < infos.length; j++) {
              var m2 = infos[j].textContent.match(/\\(?\\d{2}\\)?\\s*\\d{4,5}[\\s\\-]?\\d{4}/);
              if (m2) return m2[0];
            }

            return null;
          })()
        `).catch(() => null);

        if (tel) {
          const formatted = formatarTelefone(tel);
          if (formatted && !numerosJaUsados.has(formatted)) {
            leads.push({ nome: d.nome, telefone: formatted, cidade, nicho });
            numerosJaUsados.add(formatted);
            emitLog("sucesso", `   ✅ ${d.nome} → ${formatted}`);
          }
        }

        await sleep(500);
      } catch (_) { await sleep(500); }
    }

    // Volta para a URL da lista
    await wc.loadURL(urlLista).catch(() => {});
    await sleep(2000);
    emitWorkflow("phone", "done", `${leads.length} números encontrados`);
  }

  // Aplica o limite final
  const resultado = leads.slice(0, limiteReal);
  if (leads.length > resultado.length) {
    emitLog("info", `   ✂️ Limite de ${limiteReal} aplicado (${leads.length} coletados no total)`);
  }
  return resultado;
}

// ===================== CAMPAIGN (SEND MESSAGES) =====================

/**
 * Executa o envio de mensagens.
 * - Pré-filtra números já marcados como inválidos
 * - Quando detecta número inválido: registra no banco, PULA O DELAY, vai pro próximo
 * - Quando chat não carrega: registra como inválido, PULA O DELAY
 * - Intervalo só acontece APÓS envio bem-sucedido
 */
function isWithinSchedule(config) {
  if (!config.schedule_enabled) return true;
  const now = new Date();
  const day = now.getDay();
  if (!config.schedule_days.includes(day)) return false;
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  if (hhmm < config.schedule_start || hhmm >= config.schedule_end) return false;
  if (config.schedule_lunch_start && config.schedule_lunch_end) {
    if (hhmm >= config.schedule_lunch_start && hhmm < config.schedule_lunch_end) return false;
  }
  return true;
}

async function executarCampanha(config, mensagens, leads) {
  if (!whatsappView) {
    emitLog("erro", "❌ WhatsApp não conectado! Abra a aba WhatsApp e escaneie o QR Code.");
    return { enviados: 0, erros: 0, invalidos: 0, error: "WhatsApp não conectado" };
  }

  let enviados = 0;
  let erros = 0;
  let numInvalidos = 0;
  const wc = whatsappView.webContents;

  if (!isWithinSchedule(config)) {
    emitLog("aviso", "⏰ Fora do horário de envio. Aguarde o próximo horário.");
    return { enviados: 0, erros: 0, invalidos: 0, waiting: true };
  }

  // PRÉ-FILTRO: Remove leads que já estão no banco de inválidos (batch)
  const invalidosSet = await db.obterTodosInvalidos(currentUserId);
  const leadsFiltrados = [];
  for (const lead of leads) {
    if (invalidosSet.has(lead.telefone)) {
      emitLog("info", `   ⏭️ ${lead.nome} — ${lead.telefone} (já marcado como inválido, pulando)`);
      numInvalidos++;
    } else {
      leadsFiltrados.push(lead);
    }
  }

  if (leadsFiltrados.length < leads.length) {
    emitLog("info", `🔄 ${leads.length - leadsFiltrados.length} leads removidos (números inválidos conhecidos)`);
  }

  if (leadsFiltrados.length === 0) {
    emitLog("aviso", "⚠️ Todos os leads pendentes têm números inválidos.");
    return { enviados: 0, erros: 0, invalidos: numInvalidos };
  }

  emitLog("info", `📤 Enviando ${leadsFiltrados.length} mensagens | Delay: ${config.delay_min}-${config.delay_max}s`);

  for (let i = 0; i < leadsFiltrados.length; i++) {
    if (shouldStop) { emitLog("aviso", "⛔ Envio interrompido."); break; }
    if (enviados >= config.limite_diario) { emitLog("info", `🛑 Limite atingido (${config.limite_diario})`); break; }

    const lead = leadsFiltrados[i];
    let mensagem;
    if (config.ai_enabled && config.ai_produto) {
      const contextoChat = await obterContextoChat();
      mensagem = await escolherMensagemIA(lead, config.ai_produto, config.ai_tom || "profissional", contextoChat);
    } else {
      const msgIndex = Math.floor(Math.random() * mensagens.length);
      mensagem = mensagens[msgIndex].replace(/\{nome\}/g, lead.nome || "");
    }
    const numero = telefoneSemFormatacao(lead.telefone);

    emitLog("info", `📤 [${i + 1}/${leadsFiltrados.length}] ${lead.nome} — ${lead.telefone}`);
    emitStatus({ state: "enviando", message: `Enviando ${i + 1}/${leadsFiltrados.length}...`, enviados, erros, autopilotPhase: "ENVIANDO" });

    // Flag: só aplica delay se o envio foi bem-sucedido
    let envioOK = false;

    try {
      const sendUrl = `https://web.whatsapp.com/send?phone=${numero}`;
      await wc.executeJavaScript(`window.location.href = "${sendUrl}"`);
      await sleep(4000);

      // ====== VERIFICAÇÃO DE NÚMERO INVÁLIDO ======
      const paginaOK = await wc.executeJavaScript(`
        (function(){
          var b = document.body ? document.body.innerText.toLowerCase() : '';
          if (b.includes('inválido') || b.includes('invalid') || b.includes('phone number shared via url is not valid'))
            return 'invalido';
          return 'ok';
        })()
      `);

      if (paginaOK === "invalido") {
        // NÚMERO INVÁLIDO → registra no banco, remove da lista, PULA DELAY
        emitLog("aviso", `   ❌ Número inválido/inexistente: ${lead.telefone} → salvo no banco de inválidos`);
        await db.registrarInvalido(currentUserId, lead.telefone);
        numInvalidos++;
        await wc.executeJavaScript(`window.location.href = "https://web.whatsapp.com"`);
        await sleep(1500); // Pequena pausa só pra voltar ao WhatsApp
        continue; // PULA O DELAY — vai direto pro próximo
      }

      // ====== ESPERA CAIXA DE TEXTO ======
      let caixaPronta = false;
      for (let t = 0; t < 12; t++) {
        if (shouldStop) break;
        caixaPronta = await wc.executeJavaScript(`
          !!(document.querySelector('div[contenteditable="true"][data-tab="10"],div[contenteditable="true"][title="Digite uma mensagem"],div[contenteditable="true"][title="Type a message"],footer div[contenteditable="true"],div[contenteditable="true"][role="textbox"]'))
        `);
        if (caixaPronta) break;
        await sleep(1500);
      }

      if (!caixaPronta) {
        // Chat não abriu → provavelmente número não existe no WhatsApp
        emitLog("aviso", `   ❌ Chat não abriu: ${lead.telefone} → marcando como inválido`);
        await db.registrarInvalido(currentUserId, lead.telefone);
        numInvalidos++;
        await wc.loadURL("https://web.whatsapp.com");
        await sleep(2000);
        continue; // PULA O DELAY
      }

      // ====== DIGITA MENSAGEM ======
      const msgEsc = JSON.stringify(mensagem);
      await wc.executeJavaScript(`
        (function(){var b=document.querySelector('div[contenteditable="true"][data-tab="10"],div[contenteditable="true"][title="Digite uma mensagem"],div[contenteditable="true"][title="Type a message"],footer div[contenteditable="true"],div[contenteditable="true"][role="textbox"]');
        if(b){b.focus();b.innerHTML='';document.execCommand('insertText',false,${msgEsc});}})()
      `);
      await sleep(1500);

      // ====== CLICA ENVIAR ======
      const sent = await wc.executeJavaScript(`
        (function(){var s=document.querySelector('span[data-icon="send"]');
        if(s){s.closest('button')?s.closest('button').click():s.click();return true;}
        var b=document.querySelector('button[aria-label="Enviar"],button[aria-label="Send"]');
        if(b){b.click();return true;}return false;})()
      `);

      if (sent) {
        await sleep(3000);
        enviados++;
        envioOK = true;
        await db.marcarComoContatado(currentUserId, lead.telefone);
        emitLog("sucesso", `   ✅ Enviada! (${enviados}/${config.limite_diario})`);
      } else {
        // Botão não encontrado — pode ser problema temporário, não marca como inválido
        erros++;
        emitLog("erro", `   ⚠️ Botão enviar não encontrado, pulando...`);
        // PULA DELAY em erros
        continue;
      }
    } catch (err) {
      erros++;
      emitLog("erro", `   ❌ Erro: ${err.message}`);
      // PULA DELAY em erros
      continue;
    }

    // ====== DELAY — SÓ APÓS ENVIO BEM-SUCEDIDO ======
    if (envioOK && i < leadsFiltrados.length - 1 && !shouldStop && enviados < config.limite_diario) {
      const dMin = Math.max(10, config.delay_min);
      const dMax = Math.max(dMin + 1, config.delay_max);
      const d = Math.floor(Math.random() * (dMax - dMin + 1) + dMin);
      emitLog("info", `   ⏱️ Pausa ${d}s...`);
      emitStatus({ state: "enviando", message: `Pausa: ${d}s...`, enviados, erros, autopilotPhase: "PAUSA" });
      for (let s = 0; s < d; s++) {
        if (shouldStop) break;
        await sleep(1000);
      }
    }
  }

  return { enviados, erros, invalidos: numInvalidos };
}

// ===================== AUTOPILOT =====================

async function buscarLeadsMultiplosNichos(config, opts = {}) {
  const nichos = config.buscar_todos_nichos ? [...nichosDisponiveis] : obterNichosDaConfig(config);
  const modoBusca = opts.forcarBrasil ? "brasil" : config.modo;
  const cidades = modoBusca === "brasil" ? [...cidadesBrasil] : obterCidadesDaConfig(config);
  if (modoBusca !== "brasil" && cidades.length === 0) {
    throw new Error("Informe pelo menos uma cidade para o modo cidade.");
  }

  const enviados = await db.obterTodosEnviados(currentUserId);
  const coletados = await db.obterTodosTelefonesColetados(currentUserId);
  const numerosJaUsados = new Set([...enviados, ...Array.from(coletados)]);

  const combinacoes = montarCombinacoesBusca({ modoBusca, cidades, nichos, config });

  emitWorkflow("init", "running", `${combinacoes.length} buscas em paralelo`);
  emitLog("info", `🗂️ Abrindo ${combinacoes.length} guia(s) internas de Maps em paralelo...`);
  emitWorkflow("init", "done", `${combinacoes.length} guias configuradas`);
  showMapsView();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("show-maps-panel");
  }

  const tarefas = combinacoes.map(async (combo, idx) => {
    if (shouldStop) return [];
    const termoBusca = `${combo.nicho} em ${combo.cidade}`;
    const usarGuiaPrincipal = idx === 0;
    const workerRef = usarGuiaPrincipal ? mapsView : createMapsWorkerView();
    const wc = workerRef.webContents;

    try {
      emitLog("info", `🔍 [${idx + 1}/${combinacoes.length}] ${termoBusca}`);
      emitWorkflow("search", "running", `[${idx + 1}/${combinacoes.length}] ${termoBusca}`);
      const result = await extrairLeadsDaCidadeEmbutido(wc, termoBusca, combo.cidade, combo.nicho, {
        max_leads_por_cidade: config.max_leads_por_cidade,
        numerosJaUsados,
      });
      emitWorkflow("search", "done", `${result.length} leads`);
      return result;
    } catch (err) {
      emitLog("erro", `❌ Falha em ${termoBusca}: ${err.message}`);
      emitWorkflow("search", "error", err.message);
      return [];
    } finally {
      if (!usarGuiaPrincipal) {
        destroyMapsWorkerView(workerRef);
      }
    }
  });

  const resultados = await Promise.all(tarefas);
  const unicos = [];
  const vistos = new Set();
  for (const lead of resultados.flat()) {
    if (!lead?.telefone || vistos.has(lead.telefone)) continue;
    vistos.add(lead.telefone);
    unicos.push(lead);
  }
  return { leads: unicos, nichos };
}

ipcMain.handle("start-autopilot", async () => {
  if (isRunning) return { error: "Bot já em execução!" };
  if (!currentUserId) return { error: "Não autenticado" };
  isRunning = true;
  shouldStop = false;

  const config = await loadConfig();
  const mensagens = await loadMensagens();

  if (mensagens.length === 0) {
    isRunning = false;
    emitLog("erro", "❌ Configure pelo menos uma mensagem antes de usar o piloto automático!");
    return { error: "Sem mensagens configuradas" };
  }

  emitLog("info", "🚀 PILOTO AUTOMÁTICO INICIADO");
  emitAutopilot({ active: true, phase: "VERIFICANDO", desc: "Verificando leads pendentes..." });

  try {
    // PASSO 1: Verificar leads pendentes
    const listId = config.active_list_id || "padrao";
    let pendentes = await db.obterLeadsNaoContatados(currentUserId, listId, config.limite_diario);
    emitLog("info", `📋 ${pendentes.length} leads pendentes encontrados`);

    // PASSO 2: Buscar leads antes de enviar (ou quando não há pendentes)
    if (config.autopilot_busca_sempre || pendentes.length === 0) {
      emitAutopilot({ active: true, phase: "BUSCANDO LEADS", desc: "Buscando leads no Google Maps..." });
      const modoBuscaAutopilot = config.modo === "cidade" ? "cidade" : "brasil";
      const { leads: leadsEncontrados, nichos } = await buscarLeadsMultiplosNichos({
        ...config,
        modo: modoBuscaAutopilot,
      });
      emitLog("info", `🎯 Nichos da busca automática: ${nichos.join(", ")}`);

      if (leadsEncontrados.length > 0) {
        emitLog("info", `📥 ${leadsEncontrados.length} leads com telefone encontrados, salvando...`);
        const resultado = await db.adicionarLeads(currentUserId, listId, leadsEncontrados);
        emitLog("sucesso", `✅ ${resultado.adicionados} novos | ${resultado.duplicados} duplicados | ${resultado.jaEnviados} já enviados | ${resultado.invalidos || 0} inválidos`);
      } else {
        emitLog("aviso", "⚠️ Nenhum lead com telefone válido encontrado na busca.");
      }

      if (shouldStop) {
        emitLog("aviso", "⛔ Piloto interrompido.");
        return { success: true, interrupted: true };
      }

      // Recarregar pendentes após busca
      pendentes = await db.obterLeadsNaoContatados(currentUserId, listId, 999999);
      pendentes.sort((a, b) => {
        const da = new Date(a.dataExtracao || 0).getTime();
        const db = new Date(b.dataExtracao || 0).getTime();
        return db - da;
      });
      pendentes = pendentes.slice(0, config.limite_diario);
      emitLog("info", `📋 ${pendentes.length} leads prontos para envio`);

      // PASSO 2.5: Se IA ativa, filtrar e priorizar leads por score
      if (config.ai_enabled && config.ai_produto && pendentes.length > 0) {
        emitAutopilot({ active: true, phase: "ANALISANDO IA", desc: `IA avaliando ${pendentes.length} leads...` });
        emitLog("info", `🤖 IA avaliando ${pendentes.length} leads (score mínimo: ${config.ai_min_score || 40})...`);

        try {
          const contextoChat = await obterContextoChat();
          const resultadoIA = await avaliarLeads(pendentes, {
            minScore: config.ai_min_score || 40,
            produto: config.ai_produto,
            contextoChat,
            onProgress: ({ processados, total, aprovados, currentLead }) => {
              emitLog("info", `   🤖 [${processados}/${total}] Avaliando: ${currentLead}...`);
              emitStatus({ state: "analisando", message: `IA: ${processados}/${total} — ${currentLead}`, autopilotPhase: "ANALISANDO IA" });
            },
          });

          pendentes = ordenarPorScore(resultadoIA.aprovados);
          emitLog("sucesso", `✅ IA: ${resultadoIA.stats.aprovados} aprovados / ${resultadoIA.stats.rejeitados} rejeitados de ${resultadoIA.stats.total} leads`);
        } catch (err) {
          emitLog("aviso", `⚠️ Erro na avaliação IA, enviando sem filtro: ${err.message}`);
        }
      }
    }

    // PASSO 3: Enviar mensagens para todos os pendentes
    if (pendentes.length > 0 && !shouldStop) {
      emitAutopilot({ active: true, phase: "ENVIANDO", desc: `Enviando mensagens para ${pendentes.length} leads...` });

      const resultado = await executarCampanha(config, mensagens, pendentes);

      emitLog("info", `🏁 Envio finalizado — ✅ ${resultado.enviados} enviados | ❌ ${resultado.erros} erros | 🚫 ${resultado.invalidos || 0} inválidos`);
      emitStatus({ state: "idle", message: `Piloto: ${resultado.enviados} enviados, ${resultado.erros} erros, ${resultado.invalidos || 0} inválidos`, enviados: resultado.enviados, erros: resultado.erros });
    } else if (pendentes.length === 0) {
      emitLog("aviso", "⚠️ Nenhum lead pendente para envio.");
    }

  } catch (err) {
    emitLog("erro", `❌ Erro no piloto: ${err.message}`);
    emitStatus({ state: "erro", message: `Erro: ${err.message}` });
  } finally {
    isRunning = false;
    hideMapsView();
    emitAutopilot({ active: false, phase: "", desc: "Piloto automático finalizado." });
    emitStatus({ state: "idle", message: "Piloto automático finalizado." });
  }

  return { success: true };
});

// ===================== MANUAL SEARCH =====================

ipcMain.handle("start-search", async () => {
  if (isRunning) return { error: "Bot já em execução!" };
  if (!currentUserId) return { error: "Não autenticado" };
  isRunning = true;
  shouldStop = false;

  const config = await loadConfig();
  const nichosResumo = config.buscar_todos_nichos ? [...nichosDisponiveis] : obterNichosDaConfig(config);
  const cidadesResumo = config.modo === "brasil" ? ["capitais"] : obterCidadesDaConfig(config);
  emitLog("info", `🔍 Busca manual — Nichos: ${nichosResumo.join(", ")} | Cidades: ${cidadesResumo.join(", ") || "não definida"}`);
  emitStatus({ state: "buscando", message: "Buscando leads..." });

  try {
    const { leads: leadsEncontrados } = await buscarLeadsMultiplosNichos(config);
    if (leadsEncontrados.length > 0) {
      emitWorkflow("save", "running", `Salvando ${leadsEncontrados.length} leads...`);
      emitLog("info", `📥 ${leadsEncontrados.length} leads com telefone encontrados, salvando...`);
      const listId = config.active_list_id || "padrao";
      const resultado = await db.adicionarLeads(currentUserId, listId, leadsEncontrados);
      emitLog("sucesso", `✅ ${resultado.adicionados} novos | ${resultado.duplicados} duplicados | ${resultado.jaEnviados} já enviados | ${resultado.invalidos || 0} inválidos`);
      emitWorkflow("save", "done", `${resultado.adicionados} novos leads salvos`);
      emitStatus({ state: "idle", message: `${resultado.adicionados} novos leads` });
      return { success: true, ...resultado };
    } else {
      emitLog("aviso", "⚠️ Nenhum lead encontrado.");
      emitWorkflow("save", "done", "Nenhum lead encontrado");
      emitStatus({ state: "idle", message: "Nenhum lead" });
      return { success: true, adicionados: 0 };
    }
  } catch (err) {
    emitLog("erro", `❌ ${err.message}`);
    emitStatus({ state: "erro", message: err.message });
    return { error: err.message };
  } finally {
    isRunning = false;
    hideMapsView();
  }
});

// ===================== MANUAL CAMPAIGN =====================

ipcMain.handle("start-campaign", async () => {
  if (isRunning) return { error: "Bot já em execução!" };
  if (!currentUserId) return { error: "Não autenticado" };
  if (!whatsappView) return { error: "WhatsApp não conectado!" };
  isRunning = true;
  shouldStop = false;

  const config = await loadConfig();
  const mensagens = await loadMensagens();
  const listId = config.active_list_id || "padrao";
  const leads = await db.obterLeadsNaoContatados(currentUserId, listId, config.limite_diario);

  if (mensagens.length === 0) { isRunning = false; return { error: "Sem mensagens" }; }
  if (leads.length === 0) { isRunning = false; return { error: "Nenhum lead pendente" }; }

  emitStatus({ state: "enviando", message: `Enviando 0/${leads.length}...` });

  const resultado = await executarCampanha(config, mensagens, leads);

  isRunning = false;
  emitLog("info", `🏁 Campanha: ✅ ${resultado.enviados} enviados | ❌ ${resultado.erros} erros | 🚫 ${resultado.invalidos || 0} inválidos`);
  emitStatus({ state: "idle", message: `${resultado.enviados} enviados, ${resultado.erros} erros, ${resultado.invalidos || 0} inválidos` });

  return resultado;
});

// ===================== HELPERS =====================

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Obtém contexto das conversas recentes do chat com IA.
 * Usado para dar contexto às funções de scoring e geração de mensagens.
 * @returns {Promise<string>} Resumo das últimas mensagens do chat
 */
async function obterContextoChat() {
  if (!currentUserId) return "";
  try {
    const sessoes = await db.carregarSessoes(currentUserId);
    if (!sessoes || sessoes.length === 0) return "";
    // Usa a sessão mais recente
    const sessaoRecente = sessoes[0];
    if (!sessaoRecente.mensagens || sessaoRecente.mensagens.length === 0) return "";
    return extrairContextoChat(sessaoRecente.mensagens, 10);
  } catch (_) {
    return "";
  }
}

// ===================== AUTO-UPDATE =====================

function setupAutoUpdater() {
  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-status", { status: "available", version: info.version });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("Update downloaded:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-status", { status: "downloaded", version: info.version });
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("Auto-update error:", err.message);
  });

  // Check for updates after a short delay (don't block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

ipcMain.on("update-install", () => {
  autoUpdater.quitAndInstall();
});

// ===================== APP LIFECYCLE =====================

app.whenReady().then(async () => {
  // Try restoring saved session first
  try {
    const saved = loadSessionFile();
    if (saved && saved.refresh_token) {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      });
      if (!error && data.session) {
        currentUserId = data.session.user.id;
        saveSessionFile(data.session);
        createWindow();
        return;
      }
      clearSessionFile();
    }
  } catch (_) {
    clearSessionFile();
  }

  // Fallback: check existing supabase session
  const supabase = getSupabase();
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      currentUserId = data.session.user.id;
      createWindow();
    } else {
      createLoginWindow();
    }
  } catch (_) {
    createLoginWindow();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      const saved = loadSessionFile();
      if (saved && saved.refresh_token) {
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });
        if (!error && data.session) {
          currentUserId = data.session.user.id;
          saveSessionFile(data.session);
          createWindow();
          return;
        }
        clearSessionFile();
      }
    } catch (_) {
      clearSessionFile();
    }

    const supabase = getSupabase();
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        currentUserId = data.session.user.id;
        createWindow();
      } else {
        createLoginWindow();
      }
    } catch (_) {
      createLoginWindow();
    }
  }
});
