/**
 * LeadsFlow — Serviço Supabase
 * Persistência cloud: mensagens, listas, leads, enviados, inválidos.
 * Espelha a API do leadService.js para drop-in replacement.
 */

const { getSupabase } = require("../config/supabase");

// ===================== MENSAGENS (CHAT) =====================

async function carregarMensagens(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("chat_messages")
    .select("mensagens")
    .eq("user_id", userId)
    .single();

  if (error || !data) return [];
  return data.mensagens || [];
}

async function salvarMensagens(userId, mensagens) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("chat_messages")
    .upsert(
      { user_id: userId, mensagens, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

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
  return { id: listId, nome: novoNome };
}

async function excluirLista(userId, listId) {
  const supabase = getSupabase();

  // Remove leads da lista primeiro
  await supabase.from("leads").delete().eq("user_id", userId).eq("list_id", listId);

  const { error } = await supabase
    .from("lead_lists")
    .delete()
    .eq("id", listId)
    .eq("user_id", userId);

  if (error) throw new Error("Erro ao excluir lista");
  return { success: true };
}

// ===================== LEADS =====================

async function carregarLeads(userId, listId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .eq("list_id", listId)
    .order("data_extracao", { ascending: true });

  if (error) return [];
  return (data || []).map((l) => ({
    nome: l.nome,
    telefone: l.telefone,
    contatado: l.contatado,
    cidade: l.cidade,
    nicho: l.nicho,
    dataExtracao: l.data_extracao,
    dataContato: l.data_contato,
    score: l.score,
    motivoScore: l.motivo_score,
  }));
}

async function adicionarLeads(userId, listId, novosLeads) {
  const supabase = getSupabase();
  const enviadosSet = await obterTodosEnviados(userId);
  const invalidosSet = await obterTodosInvalidos(userId);
  const existentes = await obterTodosTelefones(userId);

  let adicionados = 0;
  let duplicados = 0;
  let jaEnviados = 0;
  let numInvalidos = 0;
  const rows = [];

  for (const lead of novosLeads) {
    if (!lead.telefone) continue;
    if (invalidosSet.has(lead.telefone)) { numInvalidos++; continue; }
    if (enviadosSet.has(lead.telefone)) { jaEnviados++; continue; }
    if (existentes.has(lead.telefone)) { duplicados++; continue; }

    rows.push({
      user_id: userId,
      list_id: listId,
      nome: lead.nome || "Desconhecido",
      telefone: lead.telefone,
      contatado: false,
      cidade: lead.cidade || "",
      nicho: lead.nicho || "",
      data_extracao: new Date().toISOString(),
    });
    existentes.add(lead.telefone);
    adicionados++;
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("leads").insert(rows);
    if (error) console.error("Erro ao inserir leads:", error.message);
  }

  const { count } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("list_id", listId);

  return { adicionados, duplicados, jaEnviados, invalidos: numInvalidos, total: count || 0 };
}

async function obterLeadsNaoContatados(userId, listId, limite = 1000) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("user_id", userId)
    .eq("list_id", listId)
    .eq("contatado", false)
    .limit(limite);

  if (error) return [];
  return data || [];
}

async function marcarComoContatado(userId, telefone) {
  const supabase = getSupabase();

  // Marca no leads
  await supabase
    .from("leads")
    .update({ contatado: true, data_contato: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("telefone", telefone);

  // Registra em enviados
  await supabase
    .from("enviados")
    .upsert({ user_id: userId, telefone }, { onConflict: "user_id,telefone" });
}

// ===================== ENVIADOS =====================

async function obterTodosEnviados(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("enviados")
    .select("telefone")
    .eq("user_id", userId);

  if (error) return new Set();
  return new Set((data || []).map((r) => r.telefone));
}

async function registrarEnviado(userId, telefone) {
  const supabase = getSupabase();
  await supabase
    .from("enviados")
    .upsert({ user_id: userId, telefone }, { onConflict: "user_id,telefone" });
}

async function jaFoiEnviado(userId, telefone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("enviados")
    .select("telefone")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .maybeSingle();

  return !!data;
}

// ===================== INVÁLIDOS =====================

async function obterTodosInvalidos(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("invalidos")
    .select("telefone")
    .eq("user_id", userId);

  if (error) return new Set();
  return new Set((data || []).map((r) => r.telefone));
}

async function registrarInvalido(userId, telefone) {
  const supabase = getSupabase();

  // Adiciona aos inválidos
  await supabase
    .from("invalidos")
    .upsert({ user_id: userId, telefone }, { onConflict: "user_id,telefone" });

  // Remove de todas as listas
  await supabase
    .from("leads")
    .delete()
    .eq("user_id", userId)
    .eq("telefone", telefone);
}

async function ehInvalido(userId, telefone) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("invalidos")
    .select("telefone")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .maybeSingle();

  return !!data;
}

// ===================== UTILITÁRIOS =====================

async function obterTodosTelefones(userId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("leads")
    .select("telefone")
    .eq("user_id", userId);

  return new Set((data || []).map((r) => r.telefone));
}

async function telefoneJaExiste(userId, telefone) {
  if (await jaFoiEnviado(userId, telefone)) return true;
  if (await ehInvalido(userId, telefone)) return true;

  const supabase = getSupabase();
  const { data } = await supabase
    .from("leads")
    .select("telefone")
    .eq("user_id", userId)
    .eq("telefone", telefone)
    .maybeSingle();

  return !!data;
}

async function obterEstatisticas(userId, listId) {
  const supabase = getSupabase();

  const { count: total } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("list_id", listId);

  const { count: contatados } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("list_id", listId)
    .eq("contatado", true);

  const { count: totalEnviados } = await supabase
    .from("enviados")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const { count: totalInvalidos } = await supabase
    .from("invalidos")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const listas = await carregarTodasAsListas(userId);

  return {
    total: total || 0,
    contatados: contatados || 0,
    pendentes: (total || 0) - (contatados || 0),
    totalEnviados: totalEnviados || 0,
    totalInvalidos: totalInvalidos || 0,
    listaAtiva: listId,
    totalListas: listas.length,
  };
}

module.exports = {
  // Mensagens
  carregarMensagens,
  salvarMensagens,
  // Listas
  carregarTodasAsListas,
  criarLista,
  renomearLista,
  excluirLista,
  // Leads
  carregarLeads,
  adicionarLeads,
  obterLeadsNaoContatados,
  marcarComoContatado,
  telefoneJaExiste,
  obterEstatisticas,
  // Enviados
  obterTodosEnviados,
  registrarEnviado,
  jaFoiEnviado,
  // Inválidos
  obterTodosInvalidos,
  registrarInvalido,
  ehInvalido,
  // Utils
  obterTodosTelefones,
};
