/**
 * LeadsFlow — Database Service
 * Camada de abstração sobre Supabase. Substitui persistência local (JSON files).
 * Todas as funções recebem userId como primeiro parâmetro.
 */

const { getSupabase } = require("./supabaseClient");
const { withRetry } = require("../utils/withRetry");

// ===================== CONFIG =====================

async function loadConfig(userId) {
  return withRetry(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("user_config")
      .select("config")
      .eq("user_id", userId)
      .single();

    if (error || !data) return null;
    return data.config;
  }, { label: "loadConfig" });
}

async function saveConfig(userId, config) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_config")
    .upsert({ user_id: userId, config, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) {
    console.error("Erro ao salvar config:", error.message);
    throw new Error(`Falha ao salvar config: ${error.message}`);
  }
  return true;
}

// ===================== MENSAGENS =====================

async function loadMensagens(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_mensagens")
    .select("mensagens")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data.mensagens;
}

async function saveMensagens(userId, mensagens) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("user_mensagens")
    .upsert({ user_id: userId, mensagens, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) console.error("Erro ao salvar mensagens:", error.message);
  return !error;
}

// ===================== LEAD LISTS =====================

async function carregarTodasAsListas(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("lead_lists")
    .select("id, nome, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return (data || []).map((l) => ({ id: l.id, nome: l.nome, createdAt: l.created_at }));
}

async function criarLista(userId, nome) {
  const supabase = getSupabase();
  const id = `lista_${Date.now()}`;
  const { error } = await supabase
    .from("lead_lists")
    .insert({ id, user_id: userId, nome, created_at: new Date().toISOString() });

  if (error) throw new Error("Erro ao criar lista");
  return { id, nome };
}

async function renomearLista(userId, listId, novoNome) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("lead_lists")
    .update({ nome: novoNome })
    .eq("id", listId)
    .eq("user_id", userId);

  if (error) throw new Error("Erro ao renomear lista");
}

async function excluirLista(userId, listId) {
  const supabase = getSupabase();
  await supabase.from("leads").delete().eq("list_id", listId).eq("user_id", userId);
  const { error } = await supabase.from("lead_lists").delete().eq("id", listId).eq("user_id", userId);
  if (error) throw new Error("Erro ao excluir lista");
}

// ===================== LEADS =====================

async function carregarLeads(userId, listId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .eq("list_id", listId)
    .order("data_extracao", { ascending: false });

  if (error) return [];
  return (data || []).map((l) => ({
    id: l.id,
    nome: l.nome,
    telefone: l.telefone,
    cidade: l.cidade || "",
    nicho: l.nicho || "",
    contatado: l.contatado || false,
    score: l.score || 0,
    dataExtracao: l.data_extracao,
    dataContato: l.data_contato,
  }));
}

async function adicionarLeads(userId, listId, novosLeads) {
  const supabase = getSupabase();
  let adicionados = 0;
  let duplicados = 0;
  let jaEnviados = 0;
  let numInvalidos = 0;

  const { data: existingLeads } = await supabase
    .from("leads")
    .select("telefone")
    .eq("user_id", userId);
  const existingPhones = new Set((existingLeads || []).map((l) => l.telefone));

  const { data: enviadosData } = await supabase
    .from("telefones_enviados")
    .select("telefone")
    .eq("user_id", userId);
  const enviadosSet = new Set((enviadosData || []).map((e) => e.telefone));

  const { data: invalidosData } = await supabase
    .from("telefones_invalidos")
    .select("telefone")
    .eq("user_id", userId);
  const invalidosSet = new Set((invalidosData || []).map((i) => i.telefone));

  const rows = [];
  for (const lead of novosLeads) {
    if (!lead.telefone) continue;
    if (invalidosSet.has(lead.telefone)) { numInvalidos++; continue; }
    if (enviadosSet.has(lead.telefone)) { jaEnviados++; continue; }
    if (existingPhones.has(lead.telefone)) { duplicados++; continue; }

    rows.push({
      user_id: userId,
      list_id: listId,
      nome: lead.nome || "Desconhecido",
      telefone: lead.telefone,
      cidade: lead.cidade || "",
      nicho: lead.nicho || "",
      contatado: false,
      score: lead.score || 0,
      data_extracao: new Date().toISOString(),
    });
    existingPhones.add(lead.telefone);
    adicionados++;
  }

  if (rows.length > 0) {
    await withRetry(async () => {
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("leads").insert(rows.slice(i, i + 500));
      }
    }, { label: "adicionarLeads-insert" });
  }

  return { adicionados, duplicados, jaEnviados, invalidos: numInvalidos, total: adicionados };
}

async function marcarComoContatado(userId, telefone) {
  return withRetry(async () => {
    const supabase = getSupabase();
    await supabase
      .from("leads")
      .update({ contatado: true, data_contato: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("telefone", telefone);

    await supabase
      .from("telefones_enviados")
      .upsert({ user_id: userId, telefone }, { onConflict: "user_id,telefone" });
  }, { label: "marcarComoContatado" });
}

async function deletarLead(userId, telefone) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("user_id", userId)
    .eq("telefone", telefone);
  return !error;
}

async function resetarLead(userId, telefone) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("leads")
    .update({ contatado: false, data_contato: null })
    .eq("user_id", userId)
    .eq("telefone", telefone);
  return !error;
}

async function obterLeadsNaoContatados(userId, listId, limite = 999999) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .eq("list_id", listId)
    .eq("contatado", false)
    .order("data_extracao", { ascending: false })
    .limit(limite);

  if (error) return [];
  return (data || []).map((l) => ({
    id: l.id,
    nome: l.nome,
    telefone: l.telefone,
    cidade: l.cidade || "",
    nicho: l.nicho || "",
    contatado: false,
    score: l.score || 0,
    dataExtracao: l.data_extracao,
  }));
}

async function salvarLeads(userId, listId, leads) {
  const supabase = getSupabase();
  await supabase.from("leads").delete().eq("user_id", userId).eq("list_id", listId);

  if (leads.length > 0) {
    const rows = leads.map((l) => ({
      user_id: userId,
      list_id: listId,
      nome: l.nome || "Desconhecido",
      telefone: l.telefone,
      cidade: l.cidade || "",
      nicho: l.nicho || "",
      contatado: l.contatado || false,
      score: l.score || 0,
      data_extracao: l.dataExtracao || new Date().toISOString(),
      data_contato: l.dataContato || null,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("leads").insert(rows.slice(i, i + 500));
    }
  }
}

async function obterEstatisticas(userId, listId) {
  const supabase = getSupabase();

  const [totalRes, contatadosRes, enviadosRes, invalidosRes] = await Promise.all([
    supabase.from("leads").select("*", { count: "exact", head: true })
      .eq("user_id", userId).eq("list_id", listId),
    supabase.from("leads").select("*", { count: "exact", head: true })
      .eq("user_id", userId).eq("list_id", listId).eq("contatado", true),
    supabase.from("telefones_enviados").select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.from("telefones_invalidos").select("*", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const total = totalRes.count || 0;
  const contatados = contatadosRes.count || 0;
  return {
    total,
    contatados,
    pendentes: total - contatados,
    totalEnviados: enviadosRes.count || 0,
    totalInvalidos: invalidosRes.count || 0,
  };
}

// ===================== ENVIADOS =====================

async function registrarEnviado(userId, telefone) {
  const supabase = getSupabase();
  await supabase
    .from("telefones_enviados")
    .upsert({ user_id: userId, telefone }, { onConflict: "user_id,telefone" });
}

async function jaFoiEnviado(userId, telefone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("telefones_enviados")
    .select("telefone")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .single();
  return !!data;
}

async function obterTodosEnviados(userId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("telefones_enviados")
    .select("telefone")
    .eq("user_id", userId);
  return (data || []).map((e) => e.telefone);
}

// ===================== INVÁLIDOS =====================

async function registrarInvalido(userId, telefone) {
  return withRetry(async () => {
    const supabase = getSupabase();
    await supabase
      .from("telefones_invalidos")
      .upsert({ user_id: userId, telefone }, { onConflict: "user_id,telefone" });
    await supabase.from("leads").delete().eq("user_id", userId).eq("telefone", telefone);
  }, { label: "registrarInvalido" });
}

async function ehInvalido(userId, telefone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("telefones_invalidos")
    .select("telefone")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .single();
  return !!data;
}

async function obterTodosInvalidos(userId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("telefones_invalidos")
    .select("telefone")
    .eq("user_id", userId);
  return new Set((data || []).map((i) => i.telefone));
}

async function obterTodosTelefonesColetados(userId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("leads")
    .select("telefone")
    .eq("user_id", userId);
  return new Set((data || []).map((l) => l.telefone));
}

// ===================== ACTIVE LIST =====================

async function obterListaAtiva(userId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("user_config")
    .select("config")
    .eq("user_id", userId)
    .single();
  return data?.config?.active_list_id || "padrao";
}

async function definirListaAtiva(userId, listId) {
  const config = (await loadConfig(userId)) || {};
  config.active_list_id = listId;
  await saveConfig(userId, config);
}

// ===================== CHAT SESSIONS =====================

async function carregarSessoes(userId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("chat_sessions")
    .select("id, titulo, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const sessions = data || [];
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const { data: allMsgs } = await supabase
    .from("chat_messages")
    .select("session_id, id, role, content, time")
    .in("session_id", sessionIds)
    .eq("user_id", userId)
    .order("time", { ascending: true });

  const msgsBySession = {};
  for (const m of allMsgs || []) {
    if (!msgsBySession[m.session_id]) msgsBySession[m.session_id] = [];
    msgsBySession[m.session_id].push({ role: m.role, content: m.content, time: m.time });
  }

  return sessions.map((s) => ({
    id: s.id,
    titulo: s.titulo,
    criadoEm: s.created_at,
    mensagens: msgsBySession[s.id] || [],
  }));
}

async function criarSessao(userId) {
  const supabase = getSupabase();
  const id = `chat_${Date.now()}`;
  const { error } = await supabase.from("chat_sessions").insert({ id, user_id: userId, titulo: "Nova conversa", created_at: new Date().toISOString() });
  if (error) {
    console.error("Erro ao criar sessão de chat:", error.message);
    throw new Error(`Falha ao criar sessão: ${error.message}`);
  }
  return { id, titulo: "Nova conversa", criadoEm: new Date().toISOString(), mensagens: [] };
}

async function obterSessao(userId, sessionId) {
  const supabase = getSupabase();
  const { data: s } = await supabase
    .from("chat_sessions").select("id, titulo, created_at")
    .eq("id", sessionId).eq("user_id", userId).single();

  if (!s) return null;

  const { data: msgs } = await supabase
    .from("chat_messages").select("id, role, content, time")
    .eq("session_id", sessionId).eq("user_id", userId)
    .order("time", { ascending: true });

  return {
    id: s.id, titulo: s.titulo, criadoEm: s.created_at,
    mensagens: (msgs || []).map((m) => ({ role: m.role, content: m.content, time: m.time })),
  };
}

async function adicionarMensagem(userId, sessionId, role, content) {
  const supabase = getSupabase();
  await supabase.from("chat_messages").insert({
    session_id: sessionId, user_id: userId, role, content, time: new Date().toISOString(),
  });

  if (role === "user") {
    const { data: msgs } = await supabase
      .from("chat_messages").select("id")
      .eq("session_id", sessionId).eq("user_id", userId).eq("role", "user");

    if (msgs && msgs.length === 1) {
      const titulo = content.slice(0, 50) + (content.length > 50 ? "..." : "");
      await supabase.from("chat_sessions").update({ titulo }).eq("id", sessionId).eq("user_id", userId);
    }
  }
}

async function excluirSessao(userId, sessionId) {
  const supabase = getSupabase();
  await supabase.from("chat_messages").delete().eq("session_id", sessionId).eq("user_id", userId);
  await supabase.from("chat_sessions").delete().eq("id", sessionId).eq("user_id", userId);
}

async function renomearSessao(userId, sessionId, titulo) {
  const supabase = getSupabase();
  await supabase.from("chat_sessions").update({ titulo }).eq("id", sessionId).eq("user_id", userId);
}

module.exports = {
  loadConfig, saveConfig,
  loadMensagens, saveMensagens,
  carregarTodasAsListas, criarLista, renomearLista, excluirLista, obterListaAtiva, definirListaAtiva,
  carregarLeads, adicionarLeads, salvarLeads, marcarComoContatado, deletarLead, resetarLead, obterLeadsNaoContatados, obterEstatisticas, obterTodosTelefonesColetados,
  registrarEnviado, jaFoiEnviado, obterTodosEnviados,
  registrarInvalido, ehInvalido, obterTodosInvalidos,
  carregarSessoes, criarSessao, obterSessao, adicionarMensagem, excluirSessao, renomearSessao,
};
