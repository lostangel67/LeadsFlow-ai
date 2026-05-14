/**
 * LeadsFlow — Renderer (app.js)
 * Dashboard, navegação, formulários, piloto automático, IPC, logs.
 */

// ===================== INITIALIZATION =====================

document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  setupWindowControls();
  setupNavigation();
  setupMensagensPanel();
  setupLeadsPanel();
  setupLogPanel();
  setupActions();
  setupEvents();
  setupIAPanel();
  setupAgendamentoPanel();
  setupChatPanel();
  setupAIObserver();
  setupAutoUpdate();
  setupVersionCheck();

  await loadConfig();
  await loadMensagens();
  await refreshLeads();
  await refreshDashboard();

  checkOnboarding();
  updateStatusDot("idle");
});

// ===================== THEME =====================

function setupTheme() {
  const saved = localStorage.getItem("leadsflow-theme") || "light";
  applyTheme(saved);

  document.getElementById("btn-theme-toggle").addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.body.setAttribute("data-theme", "dark");
  } else {
    document.body.removeAttribute("data-theme");
  }
  localStorage.setItem("leadsflow-theme", theme);
  updateThemeIcon(theme);
  // persist to Supabase so reinstalls don't lose preference
  if (window.api && window.api.getConfig) {
    window.api.getConfig().then((current) => {
      if (current && current.theme !== theme) {
        window.api.saveConfig({ ...current, theme });
      }
    }).catch(() => {});
  }
}

function updateThemeIcon(theme) {
  const sun  = document.getElementById("theme-icon-sun");
  const moon = document.getElementById("theme-icon-moon");
  if (!sun || !moon) return;
  // show sun (switch to light) when dark; show moon (switch to dark) when light
  sun.style.display  = theme === "dark" ? "block" : "none";
  moon.style.display = theme === "dark" ? "none"  : "block";
}

// ===================== WINDOW CONTROLS =====================

function setupWindowControls() {
  document.getElementById("btn-minimize").addEventListener("click", () => window.api.minimize());
  document.getElementById("btn-maximize").addEventListener("click", () => window.api.maximize());
  document.getElementById("btn-close").addEventListener("click", () => window.api.close());
}

// ===================== NAVIGATION =====================

let currentPanel = "dashboard";
let currentLeadLists = [];
let activeLeadListId = null;

function setupNavigation() {
  document.querySelectorAll(".sidebar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchPanel(btn.dataset.panel);
    });
  });
}

function switchPanel(panelName) {
  if (panelName !== "whatsapp") {
    window.api.hideWhatsApp();
  } else {
    window.api.showWhatsApp();
  }

  if (panelName !== "maps") {
    window.api.hideMaps();
  } else {
    window.api.showMaps();
  }

  document.querySelectorAll(".sidebar-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.panel === panelName);
  });

  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${panelName}`);
  });

  currentPanel = panelName;

  if (panelName === "leads") refreshLeads();
  if (panelName === "dashboard") refreshDashboard();
  if (panelName === "chat") {
    setTimeout(() => {
      const inp = document.getElementById("chat-input");
      if (inp) inp.focus();
    }, 50);
  }
}

// ===================== ONBOARDING =====================

let onboardingActive = false;

async function checkOnboarding() {
  const config = await window.api.getConfig();
  if (!config.first_run || config.ai_produto) return;

  onboardingActive = true;
  const overlay = document.getElementById("onboarding-overlay");
  overlay.style.display = "flex";

  // onboarding: auto-save will handle completion when produto is filled

  document.getElementById("btn-onboarding-start").addEventListener("click", () => {
    switchPanel("ia");
    overlay.style.display = "none";
  });
}

// ===================== DASHBOARD =====================

async function refreshDashboard() {
  try {
    const stats = await window.api.getStats();
    document.getElementById("dash-total").textContent = stats.total;
    document.getElementById("dash-contatados").textContent = stats.contatados;
    document.getElementById("dash-pendentes").textContent = stats.pendentes;
    document.getElementById("dash-enviados").textContent = stats.totalEnviados || 0;
  } catch (_) {}
}

// Config panel removed — IA handles all technical config

function setupRange(inputId, valueId, suffix) {
  const input = document.getElementById(inputId);
  const display = document.getElementById(valueId);
  input.addEventListener("input", () => {
    display.textContent = input.value + suffix;
  });
}

async function loadConfig() {
  const config = await window.api.getConfig();

  // IA fields
  document.getElementById("cfg-nichos-multi").value = config.nichos_texto || config.nicho || "";
  document.getElementById("cfg-cidade").value = config.cidade || "";
  document.getElementById("cfg-ai-produto").value = config.ai_produto || "";
  document.getElementById("cfg-ai-objetivo").value = config.ai_objetivo || "";
  document.getElementById("cfg-ai-tom").value = config.ai_tom || "profissional";
  setRange("cfg-ai-min-score", "val-ai-min-score", config.ai_min_score || 40, "");

  // Agendamento fields
  document.getElementById("cfg-schedule-enabled").checked = !!config.schedule_enabled;
  document.getElementById("cfg-schedule-start").value = config.schedule_start || "09:00";
  document.getElementById("cfg-schedule-end").value = config.schedule_end || "18:00";
  document.getElementById("cfg-lunch-start").value = config.schedule_lunch_start || "12:00";
  document.getElementById("cfg-lunch-end").value = config.schedule_lunch_end || "13:00";
  document.getElementById("cfg-delay-min").value = config.delay_min || 35;
  document.getElementById("cfg-delay-max").value = config.delay_max || 85;
  document.getElementById("cfg-limite-diario").value = config.limite_diario || 40;
  document.getElementById("cfg-max-per-hour").value = config.max_per_hour || 10;

  const activeDays = config.schedule_days || [1, 2, 3, 4, 5];
  document.querySelectorAll(".day-btn").forEach((btn) => {
    const d = parseInt(btn.dataset.day);
    btn.classList.toggle("active", activeDays.includes(d));
  });

  // restore theme from server (source of truth over localStorage)
  if (config.theme && config.theme !== localStorage.getItem("leadsflow-theme")) {
    localStorage.setItem("leadsflow-theme", config.theme);
    applyTheme(config.theme);
  }
}

function setRange(inputId, valueId, val, suffix) {
  document.getElementById(inputId).value = val;
  document.getElementById(valueId).textContent = val + suffix;
}

// ===================== AI PANEL =====================

function setupIAPanel() {
  setupRange("cfg-ai-min-score", "val-ai-min-score", "");

  // Sugerir nichos
  document.getElementById("btn-ai-sugerir").addEventListener("click", async () => {
    const produto = document.getElementById("cfg-ai-produto").value.trim();
    if (!produto) {
      showToast("Descreva o produto antes de sugerir nichos!", "error");
      return;
    }

    const btn = document.getElementById("btn-ai-sugerir");
    const resultado = document.getElementById("ai-nichos-resultado");
    btn.disabled = true;
    btn.textContent = "Analisando...";
    resultado.innerHTML = "";

    try {
      const score = parseInt(document.getElementById("cfg-ai-min-score").value);
      const objetivo = document.getElementById("cfg-ai-objetivo")?.value?.trim() || "";
      const cidade = document.getElementById("cfg-cidade")?.value?.trim() || "";
      const data = await window.api.sugerirNichos({ produto, score, objetivo, cidade });

      if (data && data.nichos && data.nichos.length) {
        resultado.innerHTML = data.nichos
          .map((n) => `<span class="badge badge-pending nicho-badge" data-nicho="${escapeHtml(n)}">${escapeHtml(n)}</span>`)
          .join(" ");

        resultado.querySelectorAll(".nicho-badge").forEach((badge) => {
          badge.addEventListener("click", () => {
            const nicho = badge.dataset.nicho;
            const multi = document.getElementById("cfg-nichos-multi");
            const existentes = multi.value.split(/[\n,;]+/g).map((s) => s.trim()).filter(Boolean);
            if (!existentes.includes(nicho)) {
              existentes.push(nicho);
              multi.value = existentes.join("\n");
              showToast(`Nicho "${nicho}" adicionado!`, "success");
            } else {
              showToast(`Nicho "${nicho}" já está na lista.`, "error");
            }
          });
        });
      } else {
        resultado.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Nenhum nicho sugerido. Tente descrever melhor o produto.</span>';
      }
    } catch (err) {
      showToast(friendlyError(err?.message || "Erro ao sugerir nichos."), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sugerir Nichos";
    }
  });

  // Auto-config: IA configura tudo automaticamente
  document.getElementById("btn-auto-config").addEventListener("click", async () => {
    const btn = document.getElementById("btn-auto-config");
    const resultado = document.getElementById("auto-config-resultado");
    const nicho = document.getElementById("cfg-nichos-multi").value.trim();
    const cidade = document.getElementById("cfg-cidade").value.trim();
    const produto = document.getElementById("cfg-ai-produto").value.trim();
    const objetivo = document.getElementById("cfg-ai-objetivo").value.trim();

    if (!produto) {
      showToast("Preencha o produto/serviço antes de configurar!", "error");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Analisando...";
    resultado.innerHTML = "";

    try {
      const res = await window.api.aiAutoConfig({ nicho, produto, objetivo, cidade });
      if (res.error) throw new Error(res.error);

      const c = res.config;

      // Atualiza campos visíveis com sugestões da IA
      if (c.nichos_sugeridos && c.nichos_sugeridos.length) {
        document.getElementById("cfg-nichos-multi").value = c.nichos_sugeridos.join(", ");
      }
      if (c.cidade_recomendada) {
        document.getElementById("cfg-cidade").value = c.cidade_recomendada === "brasil" ? "" : c.cidade_recomendada;
      }
      if (c.tom) document.getElementById("cfg-ai-tom").value = c.tom;
      if (c.min_score) setRange("cfg-ai-min-score", "val-ai-min-score", c.min_score, "");

      // Mostra justificativa
      if (c.justificativa) {
        resultado.innerHTML = `<p style="font-size:12px;color:var(--accent);line-height:1.5;">${escapeHtml(c.justificativa)}</p>`;
      }

      showToast("Configuração gerada pela IA e salva!", "success");
    } catch (err) {
      showToast(friendlyError(err?.message || "Erro na auto-configuração."), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Configurar com IA";
    }
  });

  // Auto-save da aba IA
  async function saveIAConfig() {
    const current = await window.api.getConfig();
    const nichosTexto = document.getElementById("cfg-nichos-multi")?.value?.trim() || "";
    const nichos = nichosTexto
      ? nichosTexto.split(/[\n,;]+/g).map((s) => s.trim()).filter(Boolean)
      : [];

    const config = {
      ...current,
      ai_enabled: true,
      nicho: nichos[0] || "",
      nichos,
      nichos_texto: nichosTexto,
      cidade: document.getElementById("cfg-cidade")?.value?.trim() || "",
      ai_produto: document.getElementById("cfg-ai-produto")?.value?.trim() || "",
      ai_objetivo: document.getElementById("cfg-ai-objetivo")?.value?.trim() || "",
      ai_tom: document.getElementById("cfg-ai-tom")?.value || "profissional",
      ai_min_score: parseInt(document.getElementById("cfg-ai-min-score")?.value || "40"),
      first_run: false,
    };

    const wasOnboarding = onboardingActive;
    onboardingActive = false;

    const result = await window.api.saveConfig(config);
    if (result && result.error) {
      if (wasOnboarding) onboardingActive = true;
      return;
    }

    if (wasOnboarding) {
      document.getElementById("onboarding-overlay").style.display = "none";
      showToast("Configuração salva! LeadsFlow está pronto.", "success");
      switchPanel("dashboard");
    }

    await loadConfig();
  }

  let iaSaveTimer = null;
  function scheduleIASave() {
    clearTimeout(iaSaveTimer);
    iaSaveTimer = setTimeout(saveIAConfig, 1500);
  }

  const iaFields = [
    "cfg-nichos-multi", "cfg-cidade",
    "cfg-ai-produto", "cfg-ai-objetivo", "cfg-ai-min-score",
  ];
  iaFields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", scheduleIASave);
    if (el && (el.tagName === "TEXTAREA" || el.type === "text")) {
      el.addEventListener("input", scheduleIASave);
    }
  });
}

// ===================== AGENDAMENTO PANEL =====================

function setupAgendamentoPanel() {
  let saveTimer = null;

  async function saveAgendamento() {
    const current = await window.api.getConfig();
    const activeDays = [];
    document.querySelectorAll(".day-btn.active").forEach((btn) => {
      activeDays.push(parseInt(btn.dataset.day));
    });
    const updated = {
      ...current,
      schedule_enabled: document.getElementById("cfg-schedule-enabled").checked,
      schedule_start: document.getElementById("cfg-schedule-start").value,
      schedule_end: document.getElementById("cfg-schedule-end").value,
      schedule_lunch_start: document.getElementById("cfg-lunch-start").value,
      schedule_lunch_end: document.getElementById("cfg-lunch-end").value,
      delay_min: parseInt(document.getElementById("cfg-delay-min").value) || 35,
      delay_max: parseInt(document.getElementById("cfg-delay-max").value) || 85,
      limite_diario: parseInt(document.getElementById("cfg-limite-diario").value) || 40,
      max_per_hour: parseInt(document.getElementById("cfg-max-per-hour").value) || 10,
      schedule_days: activeDays,
    };
    await window.api.saveConfig(updated);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAgendamento, 1000);
  }

  const fields = [
    "cfg-schedule-enabled", "cfg-schedule-start", "cfg-schedule-end",
    "cfg-lunch-start", "cfg-lunch-end",
    "cfg-delay-min", "cfg-delay-max", "cfg-limite-diario", "cfg-max-per-hour",
  ];
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", scheduleSave);
    if (el && el.type === "number") el.addEventListener("input", scheduleSave);
  });

  document.querySelectorAll(".day-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      scheduleSave();
    });
  });
}

// ===================== CHAT IA PANEL =====================

let chatSessoes = [];
let chatSessaoAtiva = null;
let chatSending = false;

function setupChatPanel() {
  document.getElementById("btn-chat-new").addEventListener("click", () => {
    chatSessaoAtiva = null;
    chatRenderMessages();
    updateChatTopbarTitle();
    document.getElementById("chat-input").focus();
  });

  document.getElementById("btn-chat-send").addEventListener("click", chatEnviarMensagem);

  document.getElementById("btn-chat-history").addEventListener("click", () => {
    const panel = document.getElementById("chat-history-panel");
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
  });

  document.getElementById("btn-chat-history-close").addEventListener("click", () => {
    document.getElementById("chat-history-panel").style.display = "none";
  });

  const input = document.getElementById("chat-input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatEnviarMensagem();
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  bindChatSuggestions();
  chatCarregarSessoes();
}

async function chatCarregarSessoes() {
  try {
    chatSessoes = await window.api.chatGetSessions();
    chatRenderSessions();
  } catch (_) {}
}

function chatRenderSessions() {
  const container = document.getElementById("chat-session-list");
  if (chatSessoes.length === 0) {
    container.innerHTML = '<div style="padding:20px 12px;text-align:center;color:var(--text-muted);font-size:12px;">Nenhuma conversa ainda.</div>';
    return;
  }

  container.innerHTML = chatSessoes.map((s) => `
    <div class="chat-session-item ${s.id === chatSessaoAtiva ? "active" : ""}" data-id="${escapeHtml(s.id)}">
      <span class="chat-session-title">${escapeHtml(s.titulo)}</span>
      <div class="chat-session-actions">
        <button class="btn-chat-rename" data-id="${escapeHtml(s.id)}" title="Renomear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-chat-delete" data-id="${escapeHtml(s.id)}" title="Excluir">✕</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".chat-session-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".chat-session-actions")) return;
      chatSelecionarSessao(el.dataset.id);
    });
  });

  container.querySelectorAll(".btn-chat-rename").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessao = chatSessoes.find((s) => s.id === btn.dataset.id);
      const novoNome = await askTextInput("Renomear conversa", sessao?.titulo || "");
      if (!novoNome || !novoNome.trim()) return;
      await window.api.chatRenameSession(btn.dataset.id, novoNome.trim());
      await chatCarregarSessoes();
    });
  });

  container.querySelectorAll(".btn-chat-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessao = chatSessoes.find((s) => s.id === btn.dataset.id);
      const ok = window.confirm(`Excluir conversa "${sessao?.titulo}"?`);
      if (!ok) return;
      await window.api.chatDeleteSession(btn.dataset.id);
      if (chatSessaoAtiva === btn.dataset.id) {
        chatSessaoAtiva = null;
        chatRenderMessages();
      }
      await chatCarregarSessoes();
    });
  });
}

function chatSelecionarSessao(id) {
  chatSessaoAtiva = id;
  chatRenderSessions();
  chatRenderMessages();
  updateChatTopbarTitle();
  document.getElementById("chat-history-panel").style.display = "none";
  document.getElementById("chat-input").focus();
}

function updateChatTopbarTitle() {
  const titleEl = document.getElementById("chat-topbar-title");
  if (!chatSessaoAtiva) {
    titleEl.textContent = "Nova conversa";
    return;
  }
  const sessao = chatSessoes.find((s) => s.id === chatSessaoAtiva);
  titleEl.textContent = sessao?.titulo || "Conversa";
}

function chatRenderMessages() {
  const container = document.getElementById("chat-messages");

  if (!chatSessaoAtiva) {
    container.innerHTML = `
      <div class="chat-empty" id="chat-empty-state">
        <div class="chat-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            <path d="M8 9h8"/><path d="M8 13h4"/>
          </svg>
        </div>
        <h3>Como posso ajudar?</h3>
        <p>Converse com a IA sobre marketing, prospecção e vendas</p>
        <div class="chat-suggestions">
          <button class="chat-suggestion" data-msg="Melhore minhas mensagens de prospecção no WhatsApp">Melhorar mensagens</button>
          <button class="chat-suggestion" data-msg="Quais são os melhores nichos para prospectar hoje?">Melhores nichos</button>
          <button class="chat-suggestion" data-msg="Me ajude a criar uma mensagem de abertura que converta mais.">Criar mensagem</button>
          <button class="chat-suggestion" data-msg="Como aumentar a taxa de resposta dos meus leads?">Aumentar respostas</button>
        </div>
      </div>
    `;
    bindChatSuggestions();
    return;
  }

  const sessao = chatSessoes.find((s) => s.id === chatSessaoAtiva);
  if (!sessao || sessao.mensagens.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = sessao.mensagens.map((m) => {
    const time = m.time ? formatTime(new Date(m.time)) : "";
    return `
      <div class="chat-msg ${m.role}">
        ${escapeHtml(m.content)}
        ${time ? `<div class="chat-msg-time">${time}</div>` : ""}
      </div>
    `;
  }).join("");

  container.scrollTop = container.scrollHeight;
}

async function chatEnviarMensagem() {
  if (chatSending) return;

  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("btn-chat-send");
  const mensagem = input.value.trim();
  if (!mensagem) return;

  chatSending = true;
  input.disabled = true;
  sendBtn.disabled = true;

  // Auto-create session if none active
  if (!chatSessaoAtiva) {
    const sessao = await window.api.chatCreateSession();
    if (!sessao || sessao.error) {
      const container = document.getElementById("chat-messages");
      const errorDiv = document.createElement("div");
      errorDiv.className = "chat-msg assistant";
      errorDiv.innerHTML = `<span style="color:var(--red);">Erro ao criar conversa: ${escapeHtml(sessao?.error || "Falha desconhecida")}</span>`;
      container.appendChild(errorDiv);
      chatSending = false;
      input.disabled = false;
      sendBtn.disabled = false;
      return;
    }
    chatSessaoAtiva = sessao.id;
    await chatCarregarSessoes();
    updateChatTopbarTitle();
  }

  input.value = "";
  input.style.height = "auto";

  // Add user message to UI immediately
  const container = document.getElementById("chat-messages");
  const emptyEl = container.querySelector(".chat-empty");
  if (emptyEl) emptyEl.remove();

  const userDiv = document.createElement("div");
  userDiv.className = "chat-msg user";
  userDiv.innerHTML = `${escapeHtml(mensagem)}<div class="chat-msg-time">${formatTime(new Date())}</div>`;
  container.appendChild(userDiv);
  container.scrollTop = container.scrollHeight;

  // Show typing indicator
  const typingDiv = document.createElement("div");
  typingDiv.className = "chat-msg-typing";
  typingDiv.innerHTML = "<span></span><span></span><span></span>";
  container.appendChild(typingDiv);
  container.scrollTop = container.scrollHeight;

  try {
    const result = await window.api.chatSendMessage(chatSessaoAtiva, mensagem);

    // Remove typing indicator
    typingDiv.remove();

    if (result && result.resposta) {
      const assistantDiv = document.createElement("div");
      assistantDiv.className = "chat-msg assistant";
      assistantDiv.innerHTML = `${escapeHtml(result.resposta)}<div class="chat-msg-time">${formatTime(new Date())}</div>`;
      container.appendChild(assistantDiv);
      container.scrollTop = container.scrollHeight;

      // Refresh sessions list (title may have changed)
      await chatCarregarSessoes();
    } else if (result && result.error) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "chat-msg assistant";
      errorDiv.innerHTML = `<span style="color:var(--red);">Erro: ${escapeHtml(result.error)}</span>`;
      container.appendChild(errorDiv);
    }
  } catch (err) {
    typingDiv.remove();
    const errorDiv = document.createElement("div");
    errorDiv.className = "chat-msg assistant";
    errorDiv.innerHTML = `<span style="color:var(--red);">Erro: ${escapeHtml(err.message)}</span>`;
    container.appendChild(errorDiv);
  } finally {
    chatSending = false;
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function bindChatSuggestions() {
  document.querySelectorAll(".chat-suggestion").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const msg = btn.dataset.msg;
      if (!msg) return;
      document.getElementById("chat-input").value = msg;
      await chatEnviarMensagem();
    });
  });
}

// ===================== MENSAGENS PANEL =====================

let currentMensagens = [];

function setupMensagensPanel() {
  // Auto-save tom when changed
  const tomEl = document.getElementById("cfg-ai-tom");
  if (tomEl) {
    tomEl.addEventListener("change", async () => {
      const current = await window.api.getConfig();
      await window.api.saveConfig({ ...current, ai_tom: tomEl.value });
    });
  }

  document.getElementById("btn-add-msg").addEventListener("click", () => {
    currentMensagens.push("");
    renderMensagens();
  });
  document.getElementById("btn-save-msgs").addEventListener("click", saveMensagensFromUI);

  document.getElementById("btn-gerar-mensagens").addEventListener("click", async () => {
    const btn = document.getElementById("btn-gerar-mensagens");
    btn.disabled = true;
    btn.textContent = "Gerando...";
    try {
      const res = await window.api.aiGerarMensagens();
      if (res.error) throw new Error(res.error);
      currentMensagens = res.mensagens;
      renderMensagens();
      showToast(`${res.mensagens.length} mensagens geradas pela IA!`, "success");
    } catch (err) {
      showToast(friendlyError(err?.message || "Erro ao gerar mensagens."), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Gerar mensagens com IA";
    }
  });
}

async function loadMensagens() {
  currentMensagens = await window.api.getMensagens();
  renderMensagens();
}

function renderMensagens() {
  const container = document.getElementById("mensagens-list");
  container.innerHTML = "";
  currentMensagens.forEach((msg, i) => {
    const div = document.createElement("div");
    div.className = "msg-item";
    div.innerHTML = `
      <span class="msg-number">${i + 1}</span>
      <textarea rows="2" data-index="${i}" placeholder="Digite a mensagem...">${msg}</textarea>
      <button class="msg-remove" data-index="${i}" title="Remover">✕</button>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll("textarea").forEach((ta) => {
    ta.addEventListener("input", (e) => {
      currentMensagens[parseInt(e.target.dataset.index)] = e.target.value;
    });
  });

  container.querySelectorAll(".msg-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      currentMensagens.splice(parseInt(e.target.dataset.index), 1);
      renderMensagens();
    });
  });
}

async function saveMensagensFromUI() {
  const filtered = currentMensagens.filter((m) => m.trim().length > 0);
  if (filtered.length === 0) {
    showToast("Adicione pelo menos uma mensagem!", "error");
    return;
  }
  currentMensagens = filtered;
  await window.api.saveMensagens(filtered);
  renderMensagens();
  showToast("Mensagens salvas!", "success");
}

// ===================== LEADS PANEL =====================

function setupLeadsPanel() {
  const btnNew = document.getElementById("btn-new-lead-list");
  const btnRename = document.getElementById("btn-rename-lead-list");
  const btnDelete = document.getElementById("btn-delete-lead-list");

  btnNew.addEventListener("click", onCreateLeadList);
  btnRename.addEventListener("click", onRenameLeadList);
  btnDelete.addEventListener("click", onDeleteLeadList);
}

async function refreshLeadLists() {
  const payload = await window.api.getLeadLists();
  currentLeadLists = payload.lists || [];
  activeLeadListId = payload.activeListId || currentLeadLists[0]?.id || null;
  renderLeadTabs();
}

function renderLeadTabs() {
  const tabs = document.getElementById("lead-tabs");
  if (!tabs) return;

  tabs.innerHTML = currentLeadLists
    .map((list) => `
      <button class="lead-tab ${list.id === activeLeadListId ? "active" : ""}" data-list-id="${escapeHtml(list.id)}">
        ${escapeHtml(list.nome)}
      </button>
    `)
    .join("");

  tabs.querySelectorAll(".lead-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = btn.dataset.listId;
      if (!target || target === activeLeadListId) return;
      try {
        await window.api.setActiveLeadList(target);
        activeLeadListId = target;
        await refreshLeads();
      } catch (err) {
        showToast(friendlyError(err?.message || "Erro ao trocar aba."), "error");
      }
    });
  });
}

async function onCreateLeadList() {
  if (!window.api || typeof window.api.createLeadList !== "function") {
    showToast("Função de criar aba indisponível. Reinicie o app.", "error");
    return;
  }

  const nome = await askTextInput("Nova aba de leads", "");
  if (!nome || !nome.trim()) return;

  try {
    await window.api.createLeadList(nome.trim());
    await refreshLeads();
    showToast(`Aba "${nome.trim()}" criada!`, "success");
  } catch (err) {
    const msg = err?.message || String(err) || "Erro ao criar aba.";
    showToast(friendlyError(msg), "error");
  }
}

async function onRenameLeadList() {
  if (!activeLeadListId) return;
  const atual = currentLeadLists.find((l) => l.id === activeLeadListId);
  const nomeAtual = atual?.nome || "";
  const novoNome = await askTextInput("Renomear aba", nomeAtual);
  if (!novoNome || !novoNome.trim()) return;

  try {
    await window.api.renameLeadList(activeLeadListId, novoNome.trim());
    await refreshLeads();
    showToast("Aba renomeada!", "success");
  } catch (err) {
    showToast(friendlyError(err?.message || "Erro ao renomear aba."), "error");
  }
}

async function onDeleteLeadList() {
  if (!activeLeadListId) return;
  const atual = currentLeadLists.find((l) => l.id === activeLeadListId);
  const nome = atual?.nome || "essa aba";
  const ok = window.confirm(`Excluir a aba "${nome}"? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  try {
    await window.api.deleteLeadList(activeLeadListId);
    await refreshLeads();
    showToast("Aba excluída.", "success");
  } catch (err) {
    showToast(friendlyError(err?.message || "Erro ao excluir aba."), "error");
  }
}

async function refreshLeads() {
  await refreshLeadLists();
  const leads = await window.api.getLeads();
  const stats = await window.api.getStats();

  document.getElementById("stat-total").textContent = stats.total;
  document.getElementById("stat-contatados").textContent = stats.contatados;
  document.getElementById("stat-pendentes").textContent = stats.pendentes;
  document.getElementById("stat-enviados-total").textContent = stats.totalEnviados || 0;
  document.getElementById("status-leads").textContent = `Leads: ${stats.total}`;

  const tbody = document.getElementById("leads-tbody");
  if (leads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum lead encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = leads.map((lead) => `
    <tr>
      <td style="color:var(--text-primary);font-weight:500;">${escapeHtml(lead.nome)}</td>
      <td>${escapeHtml(lead.telefone)}</td>
      <td>${escapeHtml(lead.cidade || "—")}</td>
      <td>${escapeHtml(lead.nicho || "—")}</td>
      <td>
        <span class="badge ${lead.contatado ? "badge-success" : "badge-pending"}">
          ${lead.contatado ? "Contatado" : "Pendente"}
        </span>
      </td>
      <td>
        <div class="table-actions">
          ${lead.contatado ? `<button class="btn-reset" data-tel="${escapeHtml(lead.telefone)}" title="Reenviar">↻</button>` : ""}
          <button class="btn-delete" data-tel="${escapeHtml(lead.telefone)}" title="Remover">✕</button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await window.api.deleteLead(btn.dataset.tel);
      await refreshLeads();
      showToast("Lead removido.", "success");
    });
  });

  tbody.querySelectorAll(".btn-reset").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await window.api.resetLead(btn.dataset.tel);
      await refreshLeads();
      showToast("Lead resetado.", "success");
    });
  });
}

// ===================== LOGS =====================

function setupLogPanel() {
  document.getElementById("btn-clear-logs").addEventListener("click", () => {
    document.getElementById("logs-container").innerHTML = `
      <div class="log-entry log-info">
        <span class="log-time">${formatTime(new Date())}</span>
        <span class="log-msg">Logs limpos.</span>
      </div>
    `;
  });
}

function addLogEntry(data) {
  // Only to Logs tab — dashboard uses addActivity() for friendly messages
  const container = document.getElementById("logs-container");
  appendLog(container, data);
}

function addActivity(icon, message, type = "info") {
  const feed = document.getElementById("dash-activity");
  if (!feed) return;
  const item = document.createElement("div");
  item.className = "activity-item";
  item.dataset.type = type;
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  item.innerHTML = `<span class="activity-icon">${icon}</span><span class="activity-text">${escapeHtml(message)}</span><span class="activity-time">${time}</span>`;
  feed.prepend(item);
  // Keep max 50
  while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

function appendLog(container, data) {
  const entry = document.createElement("div");
  entry.className = `log-entry log-${data.type}`;
  entry.innerHTML = `
    <span class="log-time">${formatTime(new Date(data.time))}</span>
    <span class="log-msg">${escapeHtml(data.message)}</span>
  `;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Keep max 200 entries
  while (container.children.length > 200) {
    container.removeChild(container.firstChild);
  }
}

// ===================== MAPS STATUS =====================

function updateMapsStatus(state, text) {
  const indicator = document.getElementById("maps-status-indicator");
  const statusText = indicator?.querySelector(".browser-status-text");
  if (indicator) indicator.className = `browser-status ${state}`;
  if (statusText) statusText.textContent = text;
}

// ===================== WORKFLOW DASHBOARD =====================

const WF_STEPS = ["init", "search", "scroll", "extract", "phone", "save"];

function updateWorkflowStep(step, state, detail) {
  const stepper = document.getElementById("wf-stepper");
  if (!stepper) return;

  const steps = stepper.querySelectorAll(".wf-step");
  const lines = stepper.querySelectorAll(".wf-step-line");
  const stepIdx = WF_STEPS.indexOf(step);

  steps.forEach((el, i) => {
    el.classList.remove("active", "done", "error");
    if (i < stepIdx) {
      el.classList.add("done");
    } else if (i === stepIdx) {
      if (state === "running") el.classList.add("active");
      else if (state === "done") el.classList.add("done");
      else if (state === "error") el.classList.add("error");
    }
  });

  lines.forEach((el, i) => {
    el.classList.toggle("done", i < stepIdx);
  });

  // Progress bar
  const progress = document.getElementById("wf-progress-bar");
  if (progress) {
    const pct = state === "done" && step === "save" ? 100 :
      Math.round(((stepIdx + (state === "done" ? 1 : 0.5)) / WF_STEPS.length) * 100);
    progress.style.width = pct + "%";
  }

  // Detail text
  const detailEl = document.getElementById("wf-detail");
  if (detailEl && detail) detailEl.textContent = detail;
}

function showWorkflow(show) {
  const empty = document.getElementById("wf-empty");
  const workflow = document.getElementById("wf-workflow");
  if (empty) empty.style.display = show ? "none" : "block";
  if (workflow) workflow.style.display = show ? "block" : "none";
}

function resetWorkflow() {
  const stepper = document.getElementById("wf-stepper");
  if (stepper) {
    stepper.querySelectorAll(".wf-step").forEach(el => el.classList.remove("active", "done", "error"));
    stepper.querySelectorAll(".wf-step-line").forEach(el => el.classList.remove("done"));
  }
  const progress = document.getElementById("wf-progress-bar");
  if (progress) progress.style.width = "0%";
  const detail = document.getElementById("wf-detail");
  if (detail) detail.textContent = "";
  const logBody = document.getElementById("wf-log-body");
  if (logBody) logBody.innerHTML = "";
  updateWorkflowStats(0, 0, 0);
}

function addWorkflowLog(type, message) {
  const body = document.getElementById("wf-log-body");
  if (!body) return;
  const entry = document.createElement("div");
  entry.className = "wf-log-entry";
  entry.setAttribute("data-type", type);
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entry.innerHTML = `<span class="wf-log-time">${time}</span><span class="wf-log-msg">${escapeHtml(message)}</span>`;
  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;
  // Limit entries
  while (body.children.length > 200) {
    body.removeChild(body.firstChild);
  }
}

function updateWorkflowStats(cidades, leads, erros) {
  const elC = document.getElementById("wf-stat-cidades");
  const elL = document.getElementById("wf-stat-leads");
  const elE = document.getElementById("wf-stat-erros");
  if (elC) elC.textContent = cidades;
  if (elL) elL.textContent = leads;
  if (elE) elE.textContent = erros;
}

function getWorkflowStepFromPhase(phase) {
  const map = {
    "BUSCANDO LEADS": "search",
    "ROLEANDO LISTA": "scroll",
    "EXTRAINDO DADOS": "extract",
    "BUSCANDO TELEFONES": "phone",
    "SALVANDO": "save",
    "VERIFICANDO": "init",
  };
  return map[phase] || null;
}

function setupWorkflowLogToggle() {
  const header = document.getElementById("wf-log-header");
  const body = document.getElementById("wf-log-body");
  const toggle = document.getElementById("wf-log-toggle");
  if (header && body && toggle) {
    header.addEventListener("click", () => {
      body.classList.toggle("collapsed");
      toggle.classList.toggle("collapsed");
    });
  }
}

// ===================== AUTOPILOT UI =====================

let autopilotActive = false;

function updateAutopilotUI(active, phase, desc) {
  const panel = document.getElementById("autopilot-status-panel");
  const icon = document.getElementById("autopilot-icon");
  const title = document.getElementById("autopilot-title");
  const descEl = document.getElementById("autopilot-desc");
  const phaseTag = document.getElementById("autopilot-phase");
  const btn = document.getElementById("btn-autopilot");

  autopilotActive = active;

  if (active) {
    panel.classList.add("active");
    icon.textContent = "⚡";
    btn.classList.add("running");
    btn.innerHTML = '<span class="autopilot-dot"></span> Piloto Ativo';
    phaseTag.style.display = "inline-block";
    phaseTag.textContent = phase || "PROCESSANDO";
  } else {
    panel.classList.remove("active");
    icon.textContent = "⚡";
    btn.classList.remove("running");
    btn.innerHTML = '<span class="autopilot-dot"></span> Piloto Automático';
    phaseTag.style.display = "none";
  }

  if (title && desc !== undefined) {
    title.textContent = active ? "Piloto Automático Ativo" : "Piloto Automático Desligado";
    descEl.textContent = desc || (active ? "Automação em andamento..." : 'Clique no botão "Piloto Automático" para iniciar.');
  }
}

// ===================== ACTIONS =====================

function setupActions() {
  // Autopilot
  document.getElementById("btn-autopilot").addEventListener("click", async () => {
    if (autopilotActive) {
      window.api.stopBot();
      addLogEntry({ type: "aviso", message: "⛔ Parando piloto automático...", time: new Date().toISOString() });
      addActivity("⏹", "Piloto automático parado");
      return;
    }

    setRunning(true);
    switchPanel("dashboard");
    addLogEntry({ type: "info", message: "🚀 Piloto automático iniciado!", time: new Date().toISOString() });
    addActivity("🚀", "Piloto automático iniciado");
    updateAutopilotUI(true, "INICIANDO", "Verificando leads pendentes...");

    try {
      const result = await window.api.startAutopilot();
      if (result && result.error) {
        addLogEntry({ type: "erro", message: `❌ ${result.error}`, time: new Date().toISOString() });
        addActivity("❌", result.error, "erro");
      }
    } catch (err) {
      addLogEntry({ type: "erro", message: `❌ ${err.message}`, time: new Date().toISOString() });
      addActivity("❌", "Erro no piloto automático", "erro");
    } finally {
      setRunning(false);
      updateAutopilotUI(false, "", "Piloto automático finalizado.");
      addActivity("✅", "Piloto automático finalizado", "sucesso");
      await refreshDashboard();
      await refreshLeads();
    }
  });

  // Manual search
  document.getElementById("btn-start-search").addEventListener("click", async () => {
    setRunning(true);
    switchPanel("maps");
    updateMapsStatus("running", "Buscando leads...");
    addLogEntry({ type: "info", message: "🔍 Busca manual iniciada...", time: new Date().toISOString() });
    addActivity("🔍", "Busca de leads iniciada");

    try {
      const result = await window.api.startSearch();
      if (result && result.error) {
        addLogEntry({ type: "erro", message: `❌ ${result.error}`, time: new Date().toISOString() });
        addActivity("❌", result.error, "erro");
      }
    } catch (err) {
      addLogEntry({ type: "erro", message: `❌ ${err.message}`, time: new Date().toISOString() });
      addActivity("❌", "Erro na busca de leads", "erro");
    } finally {
      setRunning(false);
      updateMapsStatus("idle", "Busca finalizada.");
      addActivity("✅", "Busca de leads finalizada", "sucesso");
      await refreshLeads();
      await refreshDashboard();
    }
  });

  // Manual campaign
  document.getElementById("btn-start-campaign").addEventListener("click", async () => {
    setRunning(true);
    switchPanel("logs");
    addLogEntry({ type: "info", message: "📤 Campanha de envio iniciada...", time: new Date().toISOString() });
    addActivity("📤", "Envio de mensagens iniciado");

    try {
      const result = await window.api.startCampaign();
      if (result && result.error) {
        addLogEntry({ type: "erro", message: `❌ ${result.error}`, time: new Date().toISOString() });
        addActivity("❌", result.error, "erro");
      }
    } catch (err) {
      addLogEntry({ type: "erro", message: `❌ ${err.message}`, time: new Date().toISOString() });
      addActivity("❌", "Erro no envio de mensagens", "erro");
    } finally {
      setRunning(false);
      addActivity("✅", "Envio de mensagens finalizado", "sucesso");
      await refreshLeads();
      await refreshDashboard();
    }
  });

  // Stop
  document.getElementById("btn-stop").addEventListener("click", () => {
    window.api.stopBot();
    addLogEntry({ type: "aviso", message: "⛔ Parando...", time: new Date().toISOString() });
    addActivity("⏹", "Automação parada");
  });

  // Logout
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await window.api.authLogout();
  });
}

function setRunning(running) {
  const btnSearch = document.getElementById("btn-start-search");
  const btnSend = document.getElementById("btn-start-campaign");
  const btnStop = document.getElementById("btn-stop");
  const btnAutopilot = document.getElementById("btn-autopilot");

  btnSearch.disabled = running;
  btnSend.disabled = running;
  btnStop.style.display = running ? "flex" : "none";

  // Autopilot button: always enabled (click to stop when running)
  if (!autopilotActive) {
    btnAutopilot.disabled = running;
  }

  updateStatusDot(running ? "running" : "idle");
}

// ===================== EVENTS FROM MAIN =====================

function setupEvents() {
  setupWorkflowLogToggle();

  window.api.onLog((data) => {
    addLogEntry(data);
    // Forward to workflow log
    addWorkflowLog(data.type, data.message);
    // Update workflow stats from log messages
    if (data.message) {
      const leadsMatch = data.message.match(/(\d+) leads de/);
      if (leadsMatch) {
        const el = document.getElementById("wf-stat-leads");
        if (el) el.textContent = parseInt(el.textContent || "0") + parseInt(leadsMatch[1]);
      }
      const cidadesMatch = data.message.match(/(\d+) cidade\(s\)/);
      if (cidadesMatch) {
        const el = document.getElementById("wf-stat-cidades");
        if (el) el.textContent = cidadesMatch[1];
      }
      if (data.type === "erro") {
        const el = document.getElementById("wf-stat-erros");
        if (el) el.textContent = parseInt(el.textContent || "0") + 1;
      }

      // Friendly activity messages for dashboard
      const msg = data.message;
      if (/leads? (encontrado|extraíd|salvo|batch)/i.test(msg)) {
        const n = msg.match(/(\d+)/);
        addActivity("📋", `${n ? n[1] : ""} leads encontrados`.trim(), "sucesso");
      } else if (/enviad[oa].*sucesso|mensagem enviada/i.test(msg)) {
        addActivity("✉️", "Mensagem enviada");
      } else if (/inválido|não é um número/i.test(msg)) {
        addActivity("⚠️", "Número inválido encontrado");
      } else if (/cidade|buscando.*em/i.test(msg) && data.type === "info") {
        addActivity("🔍", msg.replace(/^\[.*?\]\s*/, "").substring(0, 80));
      } else if (data.type === "erro") {
        addActivity("❌", "Ocorreu um erro — verifique os logs", "erro");
      }
    }
  });

  window.api.onStatusUpdate((data) => {
    document.getElementById("status-text").textContent = data.message || "Aguardando...";

    if (data.enviados !== undefined) {
      document.getElementById("status-enviados").textContent = `Enviados: ${data.enviados}`;
    }

    // Update Maps indicator
    if (data.state === "buscando") {
      updateMapsStatus("running", data.message || "Buscando...");
    }

    // Update workflow stepper from autopilotPhase
    if (data.autopilotPhase) {
      updateAutopilotUI(true, data.autopilotPhase, data.message);
      const step = getWorkflowStepFromPhase(data.autopilotPhase);
      if (step) {
        showWorkflow(true);
        updateWorkflowStep(step, "running", data.message);
      }
    }

    if (data.state === "idle") {
      updateStatusDot("idle");
      setRunning(false);
      refreshLeads();
      refreshDashboard();
      updateWorkflowStep("save", "done", "Busca finalizada");
      addActivity("✅", "Tarefa finalizada", "sucesso");
    } else if (data.state === "erro") {
      updateStatusDot("error");
      addActivity("❌", "Ocorreu um erro na automação", "erro");
    } else {
      updateStatusDot("running");
    }

    // Friendly message for enviados count updates
    if (data.enviados !== undefined && data.enviados > 0) {
      addActivity("✉️", `${data.enviados} mensagens enviadas até agora`);
    }
  });

  window.api.onShowMapsPanel(() => {
    switchPanel("maps");
    updateMapsStatus("running", "Buscando leads no Google Maps...");
    showWorkflow(true);
    resetWorkflow();
    updateWorkflowStep("init", "running", "Iniciando busca...");
  });

  window.api.onAutopilotUpdate((data) => {
    if (data.active !== undefined) {
      updateAutopilotUI(data.active, data.phase, data.desc);
    }
    if (data.active === false) {
      setRunning(false);
      refreshDashboard();
      refreshLeads();
      updateWorkflowStep("save", "done", "Piloto finalizado");
    }
  });

  // Workflow step events
  if (window.api.onWorkflowStep) {
    window.api.onWorkflowStep((data) => {
      showWorkflow(true);
      updateWorkflowStep(data.step, data.state, data.detail);
    });
  }
}

// ===================== AI OBSERVER =====================

function setupAIObserver() {
  const toggle = document.getElementById("ai-observer-toggle");
  const overlay = document.getElementById("ai-observer-overlay");

  if (toggle) {
    toggle.addEventListener("change", async () => {
      const enabled = toggle.checked;
      try {
        const result = await window.api.aiObserverToggle(enabled);
        if (overlay) overlay.style.display = enabled ? "flex" : "none";
        updateAIObserverStatus(enabled ? "Observando conversa..." : "Desativado");
      } catch (err) {
        showToast(friendlyError(err.message), "error");
        toggle.checked = false;
      }
    });
  }

  document.getElementById("ai-observer-dismiss")?.addEventListener("click", () => {
    document.getElementById("ai-observer-suggestion").style.display = "none";
    document.getElementById("ai-observer-empty").style.display = "block";
  });

  document.getElementById("ai-observer-close")?.addEventListener("click", async () => {
    if (overlay) overlay.style.display = "none";
    if (toggle) {
      toggle.checked = false;
      await window.api.aiObserverToggle(false);
    }
  });

  document.getElementById("ai-observer-copy")?.addEventListener("click", () => {
    const text = document.getElementById("ai-observer-suggestion-text")?.textContent;
    if (text) {
      navigator.clipboard.writeText(text);
      showToast("Sugestão copiada!", "success");
    }
  });

  // Listen for real-time updates from main process
  window.api.onAiObserverUpdate((data) => {
    if (data.analysis) {
      showAISuggestion(data.analysis.suggestion || data.analysis.analysis);
      updateAIObserverStatus(`Intenção: ${data.analysis.intent || "analisando"}`);
    }
  });
}

function showAISuggestion(text) {
  const overlay = document.getElementById("ai-observer-overlay");
  const suggestion = document.getElementById("ai-observer-suggestion");
  const suggestionText = document.getElementById("ai-observer-suggestion-text");
  const empty = document.getElementById("ai-observer-empty");

  if (overlay) overlay.style.display = "flex";
  if (suggestionText) suggestionText.textContent = text;
  if (suggestion) suggestion.style.display = "block";
  if (empty) empty.style.display = "none";
}

function hideAISuggestion() {
  const suggestion = document.getElementById("ai-observer-suggestion");
  const empty = document.getElementById("ai-observer-empty");
  if (suggestion) suggestion.style.display = "none";
  if (empty) empty.style.display = "block";
}

function updateAIObserverStatus(text) {
  const statusText = document.getElementById("ai-observer-status-text");
  if (statusText) statusText.textContent = text;
}

// ===================== HELPERS =====================

function updateStatusDot(state) {
  const dot = document.getElementById("status-dot");
  dot.className = "status-dot " + state;
  if (state === "idle") {
    document.getElementById("status-text").textContent = "Pronto";
  }
}

function formatTime(date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function friendlyError(err) {
  const msg = typeof err === "string" ? err : err?.message || err?.error || "";
  if (msg.includes("não contém JSON válido") || msg.includes("not valid JSON"))
    return "A IA não conseguiu gerar uma resposta válida. Tente novamente.";
  if (msg.includes("Formato inválido") || msg.includes("invalid format"))
    return "A IA retornou dados em formato inesperado. Tente novamente.";
  if (msg.includes("Sem resposta da IA") || msg.includes("no response"))
    return "A IA não respondeu. Verifique sua conexão e tente novamente.";
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED"))
    return "Não foi possível conectar ao serviço de IA. Verifique sua internet.";
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota"))
    return "Muitas requisições. Aguarde alguns segundos e tente novamente.";
  if (msg.includes("401") || msg.includes("API key") || msg.includes("NVIDIA_API_KEY"))
    return "Erro de autenticação com o serviço de IA. Contate o suporte.";
  if (msg.includes("Falha ao salvar config") || msg.includes("Falha ao criar sessão"))
    return "Erro ao salvar dados. Verifique sua conexão e tente novamente.";
  if (msg.includes("Não autenticado") || msg.includes("not authenticated"))
    return "Sua sessão expirou. Faça login novamente.";
  if (msg.includes("Sessão não encontrada"))
    return "Conversa não encontrada. Crie uma nova conversa.";
  if (msg.includes("WhatsApp não conectado"))
    return "WhatsApp não conectado. Abra a aba WhatsApp e escaneie o QR Code.";
  if (msg.includes("Descreva o produto") || msg.includes("Preencha o produto"))
    return "Preencha o campo Produto/Serviço na aba IA antes de continuar.";
  if (msg.includes("Config inválida"))
    return "Configuração inválida. Verifique os campos e tente novamente.";
  if (msg.includes("Nome inválido"))
    return "Digite um nome válido.";
  if (msg.includes("ID da lista inválido"))
    return "Lista não encontrada. Selecione uma lista válida.";
  if (msg.includes("Telefone inválido"))
    return "Número de telefone inválido. Verifique o formato.";
  if (msg.includes("Email not confirmed") || msg.includes("email_not_confirmed"))
    return "Confirme seu email antes de fazer login. Verifique sua caixa de entrada.";
  if (msg.includes("Invalid login credentials") || msg.includes("credenciais"))
    return "Email ou senha incorretos.";
  if (msg.includes("User already registered"))
    return "Este email já está cadastrado. Tente fazer login.";
  if (msg.includes("Password should be at least"))
    return "A senha deve ter pelo menos 6 caracteres.";
  if (msg.includes("Unable to validate email"))
    return "Email inválido. Verifique o formato.";
  if (msg.includes("Adicione pelo menos uma mensagem"))
    return "Adicione pelo menos uma mensagem de abertura na aba Mensagens.";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch failed"))
    return "Erro de conexão. Verifique sua internet.";
  if (msg.length > 100 || msg.includes("Error:") || msg.includes("throw"))
    return "Ocorreu um erro inesperado. Tente novamente.";
  return msg || "Ocorreu um erro inesperado.";
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function askTextInput(title, initialValue = "") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card">
        <h3>${escapeHtml(title)}</h3>
        <input id="modal-text-input" type="text" value="${escapeHtml(initialValue)}" />
        <div class="modal-actions">
          <button id="modal-cancel" class="btn btn-secondary">Cancelar</button>
          <button id="modal-save" class="btn btn-primary">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#modal-text-input");
    const btnCancel = overlay.querySelector("#modal-cancel");
    const btnSave = overlay.querySelector("#modal-save");
    if (input) {
      input.focus();
      input.select();
    }

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };

    btnCancel?.addEventListener("click", () => cleanup(null));
    btnSave?.addEventListener("click", () => cleanup(input?.value?.trim() || ""));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(null);
    });

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cleanup(null);
      if (e.key === "Enter") cleanup(input?.value?.trim() || "");
    });
  });
}

// ===================== AUTO-UPDATE =====================

function setupAutoUpdate() {
  if (!window.api?.onUpdateStatus) return;

  window.api.onUpdateStatus((data) => {
    switch (data.status) {
      case "checking":
        showToast("Verificando atualizações...", "info");
        break;
      case "available":
        showToast(`Atualização v${data.version} disponível. Baixando...`, "success");
        break;
      case "downloading":
        // Could show progress bar in future
        break;
      case "downloaded":
        const toast = document.createElement("div");
        toast.className = "toast toast-success";
        toast.innerHTML = `Atualização v${data.version} pronta. <a href="#" id="update-install-link" style="color:var(--accent);text-decoration:underline;margin-left:6px;">Reiniciar agora</a>`;
        document.body.appendChild(toast);
        toast.querySelector("#update-install-link").addEventListener("click", (e) => {
          e.preventDefault();
          window.api.updateInstall();
        });
        setTimeout(() => toast.remove(), 15000);
        break;
      case "error":
        showToast(`Erro ao verificar atualização: ${data.message}`, "error");
        break;
    }
  });
}

function setupVersionCheck() {
  // Display current version
  const versionEl = document.getElementById("app-version");
  if (versionEl && window.api?.getAppVersion) {
    window.api.getAppVersion().then((version) => {
      versionEl.textContent = `v${version}`;
    });
  }

  // Manual update check button
  const checkBtn = document.getElementById("btn-check-update");
  if (checkBtn && window.api?.updateCheck) {
    checkBtn.addEventListener("click", () => {
      window.api.updateCheck();
    });
  }
}
