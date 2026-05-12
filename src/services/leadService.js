/**
 * LeadsFlow — Serviço de Leads
 * Gerencia o armazenamento, deduplicação e consulta de leads.
 * Inclui banco de números já enviados (enviados.json) para nunca repetir.
 * Inclui banco de números inválidos (invalidos.json) para nunca tentar de novo.
 */

const fs = require("fs");
const path = require("path");

const LEADS_PATH = path.join(__dirname, "..", "data", "leads.json");
const LEAD_LISTS_PATH = path.join(__dirname, "..", "data", "lead_lists.json");
const ENVIADOS_PATH = path.join(__dirname, "..", "data", "enviados.json");
const INVALIDOS_PATH = path.join(__dirname, "..", "data", "invalidos.json");

// ===================== BANCO DE ENVIADOS =====================
// Arquivo separado que guarda TODOS os números que já receberam mensagem.
// Nunca é limpo — serve como histórico permanente para evitar retrabalho.

/**
 * Carrega o Set de números já enviados.
 * @returns {Set<string>} Set de telefones já contatados
 */
function carregarEnviados() {
  try {
    const dir = path.dirname(ENVIADOS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(ENVIADOS_PATH)) {
      fs.writeFileSync(ENVIADOS_PATH, "[]", "utf-8");
      return new Set();
    }
    const dados = JSON.parse(fs.readFileSync(ENVIADOS_PATH, "utf-8"));
    return new Set(Array.isArray(dados) ? dados : []);
  } catch (_) {
    return new Set();
  }
}

/**
 * Salva o Set de enviados no disco.
 * @param {Set<string>} enviados
 */
function salvarEnviados(enviados) {
  try {
    const dir = path.dirname(ENVIADOS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(ENVIADOS_PATH, JSON.stringify([...enviados], null, 2), "utf-8");
  } catch (_) {}
}

/**
 * Adiciona um número ao banco de enviados (permanente).
 * @param {string} telefone - Número formatado (+55...)
 */
function registrarEnviado(telefone) {
  const enviados = carregarEnviados();
  enviados.add(telefone);
  salvarEnviados(enviados);
}

/**
 * Verifica se um número já foi enviado anteriormente.
 * @param {string} telefone
 * @returns {boolean}
 */
function jaFoiEnviado(telefone) {
  const enviados = carregarEnviados();
  return enviados.has(telefone);
}

/**
 * Retorna a lista completa de números já enviados (para filtragem no scraper).
 * @returns {string[]}
 */
function obterTodosEnviados() {
  return [...carregarEnviados()];
}

/**
 * Retorna estatísticas do banco de enviados.
 * @returns {{ totalEnviados: number }}
 */
function obterEstatisticasEnviados() {
  return { totalEnviados: carregarEnviados().size };
}

// ===================== BANCO DE NÚMEROS INVÁLIDOS =====================
// Números que não existem no WhatsApp ou são inválidos.
// Permanente — nunca mais tenta enviar para esses números.

/**
 * Carrega o Set de números inválidos.
 * @returns {Set<string>}
 */
function carregarInvalidos() {
  try {
    const dir = path.dirname(INVALIDOS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(INVALIDOS_PATH)) {
      fs.writeFileSync(INVALIDOS_PATH, "[]", "utf-8");
      return new Set();
    }
    const dados = JSON.parse(fs.readFileSync(INVALIDOS_PATH, "utf-8"));
    return new Set(Array.isArray(dados) ? dados : []);
  } catch (_) {
    return new Set();
  }
}

/**
 * Salva o Set de inválidos no disco.
 * @param {Set<string>} invalidos
 */
function salvarInvalidos(invalidos) {
  try {
    const dir = path.dirname(INVALIDOS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(INVALIDOS_PATH, JSON.stringify([...invalidos], null, 2), "utf-8");
  } catch (_) {}
}

/**
 * Registra um número como inválido (permanente).
 * Também remove o lead da lista de leads ativos.
 * @param {string} telefone
 */
function registrarInvalido(telefone) {
  // 1. Adiciona ao banco de inválidos
  const invalidos = carregarInvalidos();
  invalidos.add(telefone);
  salvarInvalidos(invalidos);

  // 2. Remove de TODAS as listas ativas (não faz sentido manter)
  const banco = carregarBancoListas();
  let alterou = false;
  for (const lista of banco.lists) {
    const leads = banco.leadsByList[lista.id] || [];
    const filtrados = leads.filter((l) => l.telefone !== telefone);
    if (filtrados.length !== leads.length) {
      banco.leadsByList[lista.id] = filtrados;
      alterou = true;
    }
  }
  if (alterou) {
    salvarBancoListas(banco);
  }
}

/**
 * Verifica se um número é inválido.
 * @param {string} telefone
 * @returns {boolean}
 */
function ehInvalido(telefone) {
  return carregarInvalidos().has(telefone);
}

/**
 * Retorna o total de números inválidos.
 * @returns {number}
 */
function totalInvalidos() {
  return carregarInvalidos().size;
}

// ===================== LEADS LISTS =====================

function normalizarNomeLista(nome) {
  return String(nome || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function gerarIdLista(nome) {
  const base = normalizarNomeLista(nome)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `lista-${Date.now()}`;
}

function criarEstruturaPadraoListas() {
  return {
    activeListId: "padrao",
    lists: [
      { id: "padrao", nome: "Padrão", createdAt: new Date().toISOString() },
    ],
    leadsByList: {
      padrao: [],
    },
  };
}

function migrarLeadsLegadoParaListas(leadsLegado) {
  const estrutura = criarEstruturaPadraoListas();
  estrutura.leadsByList.padrao = Array.isArray(leadsLegado) ? leadsLegado : [];
  return estrutura;
}

function carregarBancoListas() {
  try {
    const dir = path.dirname(LEAD_LISTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(LEAD_LISTS_PATH)) {
      const legado = carregarLeadsLegado();
      const estrutura = migrarLeadsLegadoParaListas(legado);
      salvarBancoListas(estrutura);
      return estrutura;
    }

    const dados = JSON.parse(fs.readFileSync(LEAD_LISTS_PATH, "utf-8"));
    if (!dados || !Array.isArray(dados.lists) || typeof dados.leadsByList !== "object") {
      const legado = carregarLeadsLegado();
      const estrutura = migrarLeadsLegadoParaListas(legado);
      salvarBancoListas(estrutura);
      return estrutura;
    }

    if (!dados.activeListId || !dados.lists.some((l) => l.id === dados.activeListId)) {
      dados.activeListId = dados.lists[0]?.id || "padrao";
    }

    for (const lista of dados.lists) {
      if (!Array.isArray(dados.leadsByList[lista.id])) dados.leadsByList[lista.id] = [];
    }

    return dados;
  } catch (_) {
    return criarEstruturaPadraoListas();
  }
}

function salvarBancoListas(banco) {
  try {
    const dir = path.dirname(LEAD_LISTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LEAD_LISTS_PATH, JSON.stringify(banco, null, 2), "utf-8");
  } catch (erro) {
    console.error("❌ Erro ao salvar listas de leads:", erro.message);
  }
}

function carregarLeadsLegado() {
  try {
    const dir = path.dirname(LEADS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(LEADS_PATH)) return [];
    const conteudo = fs.readFileSync(LEADS_PATH, "utf-8");
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? dados : [];
  } catch (_) {
    return [];
  }
}

function carregarTodasAsListas() {
  const banco = carregarBancoListas();
  return banco.lists;
}

function criarLista(nome) {
  const banco = carregarBancoListas();
  const nomeNormalizado = normalizarNomeLista(nome);
  if (!nomeNormalizado) {
    throw new Error("Nome da lista inválido.");
  }
  const jaExiste = banco.lists.some((l) => l.nome.toLowerCase() === nomeNormalizado.toLowerCase());
  if (jaExiste) {
    throw new Error("Já existe uma lista com esse nome.");
  }
  let id = gerarIdLista(nomeNormalizado);
  while (banco.lists.some((l) => l.id === id)) {
    id = `${id}-${Math.floor(Math.random() * 1000)}`;
  }
  banco.lists.push({ id, nome: nomeNormalizado, createdAt: new Date().toISOString() });
  banco.leadsByList[id] = [];
  banco.activeListId = id;
  salvarBancoListas(banco);
  return { id, nome: nomeNormalizado };
}

function definirListaAtiva(listId) {
  const banco = carregarBancoListas();
  if (!banco.lists.some((l) => l.id === listId)) {
    throw new Error("Lista não encontrada.");
  }
  banco.activeListId = listId;
  salvarBancoListas(banco);
  return { activeListId: listId };
}

function renomearLista(listId, novoNome) {
  const banco = carregarBancoListas();
  const nomeNormalizado = normalizarNomeLista(novoNome);
  if (!nomeNormalizado) {
    throw new Error("Nome da lista inválido.");
  }

  const lista = banco.lists.find((l) => l.id === listId);
  if (!lista) {
    throw new Error("Lista não encontrada.");
  }

  const nomeJaExiste = banco.lists.some(
    (l) => l.id !== listId && l.nome.toLowerCase() === nomeNormalizado.toLowerCase()
  );
  if (nomeJaExiste) {
    throw new Error("Já existe uma lista com esse nome.");
  }

  lista.nome = nomeNormalizado;
  salvarBancoListas(banco);
  return { id: listId, nome: nomeNormalizado };
}

function excluirLista(listId) {
  const banco = carregarBancoListas();
  const idx = banco.lists.findIndex((l) => l.id === listId);
  if (idx === -1) {
    throw new Error("Lista não encontrada.");
  }
  if (banco.lists.length <= 1) {
    throw new Error("Não é possível excluir a última lista.");
  }

  banco.lists.splice(idx, 1);
  delete banco.leadsByList[listId];

  if (banco.activeListId === listId) {
    banco.activeListId = banco.lists[0].id;
  }

  salvarBancoListas(banco);
  return { success: true, activeListId: banco.activeListId };
}

function obterListaAtiva() {
  const banco = carregarBancoListas();
  return banco.activeListId;
}

function obterTodosTelefonesColetados() {
  const banco = carregarBancoListas();
  const set = new Set();
  for (const lista of banco.lists) {
    const arr = banco.leadsByList[lista.id] || [];
    for (const lead of arr) {
      if (lead?.telefone) set.add(lead.telefone);
    }
  }
  return set;
}

// ===================== LEADS =====================

/**
 * Carrega todos os leads do arquivo JSON.
 * @returns {Array<Object>} Lista de leads
 */
function carregarLeads() {
  const banco = carregarBancoListas();
  const listId = banco.activeListId;
  return Array.isArray(banco.leadsByList[listId]) ? banco.leadsByList[listId] : [];
}

/**
 * Salva a lista de leads no arquivo JSON.
 * @param {Array<Object>} leads
 */
function salvarLeads(leads) {
  const banco = carregarBancoListas();
  const listId = banco.activeListId;
  banco.leadsByList[listId] = Array.isArray(leads) ? leads : [];
  salvarBancoListas(banco);
}

/**
 * Verifica se um telefone já existe na lista de leads OU no banco de enviados.
 * @param {Array<Object>} leads - Lista atual de leads
 * @param {string} telefone - Telefone formatado para verificar
 * @returns {boolean}
 */
function telefoneJaExiste(leads, telefone) {
  // Checa no banco de leads atuais
  if (leads.some((lead) => lead.telefone === telefone)) return true;
  // Checa em todas as listas de coletados
  if (obterTodosTelefonesColetados().has(telefone)) return true;
  // Checa no banco permanente de enviados
  if (jaFoiEnviado(telefone)) return true;
  // Checa no banco de inválidos
  if (ehInvalido(telefone)) return true;
  return false;
}

/**
 * Adiciona novos leads à lista, evitando duplicados pelo telefone.
 * Também filtra números que já estão no banco de enviados.
 * @param {Array<Object>} novosLeads - Novos leads para adicionar
 * @returns {{ adicionados: number, duplicados: number, jaEnviados: number, total: number }}
 */
function adicionarLeads(novosLeads) {
  const banco = carregarBancoListas();
  const listId = banco.activeListId;
  const leadsAtuais = Array.isArray(banco.leadsByList[listId]) ? banco.leadsByList[listId] : [];
  const todosColetados = obterTodosTelefonesColetados();
  const enviados = carregarEnviados();
  const invalidos = carregarInvalidos();
  let adicionados = 0;
  let duplicados = 0;
  let jaEnviados = 0;
  let numInvalidos = 0;

  for (const lead of novosLeads) {
    if (!lead.telefone) {
      continue;
    }

    // Número inválido? Ignora.
    if (invalidos.has(lead.telefone)) {
      numInvalidos++;
      continue;
    }

    // Já foi enviado antes? Ignora completamente.
    if (enviados.has(lead.telefone)) {
      jaEnviados++;
      continue;
    }

    // Já existe em qualquer lista? Duplicado global.
    if (todosColetados.has(lead.telefone)) {
      duplicados++;
      continue;
    }

    leadsAtuais.push({
      nome: lead.nome || "Desconhecido",
      telefone: lead.telefone,
      contatado: false,
      cidade: lead.cidade || "",
      nicho: lead.nicho || "",
      dataExtracao: new Date().toISOString(),
    });
    todosColetados.add(lead.telefone);
    adicionados++;
  }

  banco.leadsByList[listId] = leadsAtuais;
  salvarBancoListas(banco);

  return {
    adicionados,
    duplicados,
    jaEnviados,
    invalidos: numInvalidos,
    total: leadsAtuais.length,
  };
}

/**
 * Retorna leads que ainda não foram contatados.
 * @param {number} limite - Quantidade máxima (padrão: todos)
 * @returns {Array<Object>}
 */
function obterLeadsNaoContatados(limite = Infinity) {
  const leads = carregarLeads();
  const naoContatados = leads.filter((l) => !l.contatado);
  return naoContatados.slice(0, limite);
}

/**
 * Marca um lead como contatado E registra no banco permanente de enviados.
 * @param {string} telefone
 */
function marcarComoContatado(telefone) {
  // 1. Marca no leads.json
  const leads = carregarLeads();
  const lead = leads.find((l) => l.telefone === telefone);
  if (lead) {
    lead.contatado = true;
    lead.dataContato = new Date().toISOString();
    salvarLeads(leads);
  }
  // 2. Registra no banco permanente de enviados
  registrarEnviado(telefone);
}

/**
 * Retorna estatísticas gerais dos leads + enviados.
 * @returns {Object}
 */
function obterEstatisticas() {
  const banco = carregarBancoListas();
  const leads = banco.leadsByList[banco.activeListId] || [];
  const contatados = leads.filter((l) => l.contatado).length;
  const pendentes = leads.length - contatados;
  const { totalEnviados } = obterEstatisticasEnviados();
  const numInvalidos = totalInvalidos();

  return {
    total: leads.length,
    contatados,
    pendentes,
    totalEnviados,
    totalInvalidos: numInvalidos,
    listaAtiva: banco.activeListId,
    totalListas: banco.lists.length,
  };
}

module.exports = {
  carregarLeads,
  salvarLeads,
  adicionarLeads,
  obterLeadsNaoContatados,
  marcarComoContatado,
  obterEstatisticas,
  telefoneJaExiste,
  // Banco de enviados
  carregarEnviados,
  registrarEnviado,
  jaFoiEnviado,
  obterTodosEnviados,
  obterEstatisticasEnviados,
  // Banco de inválidos
  carregarInvalidos,
  registrarInvalido,
  ehInvalido,
  totalInvalidos,
  // Listas de leads
  carregarTodasAsListas,
  criarLista,
  definirListaAtiva,
  renomearLista,
  excluirLista,
  obterListaAtiva,
  obterTodosTelefonesColetados,
};
