/**
 * LeadsFlow — Serviço de IA
 * Integração com NVIDIA GPT-OSS 120b via OpenAI SDK.
 * Funções: sugerir nichos, avaliar leads, gerar mensagens, analisar respostas.
 */

const OpenAI = require("openai");
const { withRetry } = require("../utils/withRetry");

const API_KEY = "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";
const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "openai/gpt-oss-120b";

function friendlyError(err) {
  const msg = typeof err === "string" ? err : err?.message || "";
  if (msg.includes("não contém JSON válido") || msg.includes("not valid JSON"))
    return "A IA não conseguiu gerar uma resposta válida. Tente novamente.";
  if (msg.includes("Formato inválido"))
    return "A IA retornou dados em formato inesperado. Tente novamente.";
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED"))
    return "Não foi possível conectar ao serviço de IA. Verifique sua internet.";
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota"))
    return "Muitas requisições. Aguarde alguns segundos e tente novamente.";
  if (msg.includes("401") || msg.includes("API key"))
    return "Erro de autenticação com o serviço de IA. Contate o suporte.";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "Erro de conexão. Verifique sua internet.";
  return msg || "Ocorreu um erro inesperado na IA.";
}

function safeContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (content == null) throw new Error("A IA não retornou conteúdo. Tente novamente.");
  return content.trim();
}

let client = null;

function getClient() {
  if (!client) {
    if (!API_KEY) throw new Error("NVIDIA_API_KEY é obrigatória no .env");
    client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });
  }
  return client;
}

/**
 * Sugere nichos de mercado com base na descrição do produto/serviço.
 * @param {string} produto - Descrição do produto/serviço
 * @param {string} descricao - Contexto adicional (opcional)
 * @returns {Promise<string[]|null>}
 */
async function sugerirNichos(produto, objetivo = "", cidade = "") {
  const prompt = `Especialista em prospecção comercial B2B no Brasil via WhatsApp e Google Maps.

PRODUTO/SERVIÇO: "${produto}"
${objetivo ? `OBJETIVO DO USUÁRIO: ${objetivo}` : ""}
${cidade ? `REGIÃO/CIDADE: ${cidade}` : ""}

Sugira 8 nichos de negócios que COMPRARIAM este produto. Critérios obrigatórios:
1. Alta presença no Google Maps (fácil de achar por cidade)
2. Decisor acessível via WhatsApp (dono ou gerente responde)
3. Necessidade real e frequente do produto
4. Ticket médio compatível com o produto

EVITE: termos genéricos ("empresas", "negócios", "comércios"), nichos sem presença no Maps, nichos onde WhatsApp não funciona.
USE nomes específicos em português minúsculo: "clínicas de estética", "escritórios de contabilidade", "oficinas mecânicas", "academias de musculação".

JSON apenas (sem markdown, sem texto extra):
{"nichos": ["nicho1", "nicho2", "nicho3", "nicho4", "nicho5", "nicho6", "nicho7", "nicho8"]}`;

  try {
    const openai = getClient();
    const response = await withRetry(() => openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: "Responda APENAS com JSON válido. Sem markdown, sem texto extra." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 300,
    }), { label: "sugerirNichos" });

    let text = safeContent(response);
    text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.nichos) ? parsed.nichos : null;
  } catch (err) {
    console.error("Erro ao sugerir nichos:", err.message);
    return null;
  }
}

/**
 * Avalia um lead individual — quanto mais provável comprador, maior o score.
 * @param {Object} lead - {nome, telefone, cidade, nicho}
 * @param {string} produto - Descrição do produto/serviço sendo vendido
 * @param {string} [contextoChat] - Contexto das conversas recentes do chat
 * @returns {Promise<{score: number, motivoScore: string}>}
 */
async function avaliarLead(lead, produto = "", contextoChat = "") {
  let prompt = `Analise este lead de prospecção comercial e atribua um score de 0 a 100.

Lead:
- Nome: ${lead.nome || "Desconhecido"}
- Cidade: ${lead.cidade || "N/A"}
- Nicho: ${lead.nicho || "N/A"}

${produto ? `Produto/serviço que estamos vendendo: ${produto}` : ""}`;

  if (contextoChat) {
    prompt += `\n\nContexto das conversas recentes do usuário (use para refinar a avaliação):
${contextoChat}`;
  }

  prompt += `

Critérios de avaliação:
- Negócio real com nome próprio (peso: 20)
- Nicho que mais precisa do serviço (peso: 30)
- Cidade com boa economia (peso: 15)
- Potencial de ticket médio alto (peso: 20)
- Facilidade de contato (peso: 15)

Responda APENAS no formato JSON (sem markdown, sem code block):
{"score": <número 0-100>, "motivoScore": "<breve justificativa em 1 linha>"}`;

  try {
    const openai = getClient();
    const response = await withRetry(() => openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 150,
    }), { label: "avaliarLead" });

    let text = safeContent(response);
    text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(text);
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      motivoScore: String(parsed.motivoScore || "Sem justificativa"),
    };
  } catch (err) {
    console.error(`Erro ao avaliar lead ${lead.nome}:`, err.message);
    return { score: 0, motivoScore: `Erro: ${friendlyError(err.message)}` };
  }
}

/**
 * Gera mensagem personalizada de WhatsApp para um lead.
 * @param {Object} lead - {nome, cidade, nicho}
 * @param {string} produto - Descrição do produto/serviço
 * @param {string} tom - "profissional" | "casual" | "amigável"
 * @param {string} [contextoChat] - Contexto das conversas recentes do chat
 * @returns {Promise<string|null>}
 */
async function gerarMensagem(lead, produto, tom = "profissional", contextoChat = "") {
  let prompt = `Gere uma mensagem curta de WhatsApp para prospecção comercial.

Lead:
- Nome: ${lead.nome || "Negócio"}
- Cidade: ${lead.cidade || ""}
- Nicho: ${lead.nicho || ""}

Produto/serviço: ${produto}
Tom: ${tom}`;

  if (contextoChat) {
    prompt += `\n\nContexto das conversas recentes do usuário com o assistente (use para personalizar a abordagem):
${contextoChat}`;
  }

  prompt += `

Regras:
- Máximo 2 frases curtas
- Mencione o nome do negócio se disponível
- Mencione o nicho/cidade se relevante
- Seja direto, não enrolação
- Não use emojis exagerados
- Linguagem natural em português brasileiro
- Se houver contexto do chat, use insights relevantes para personalizar

Responda APENAS com o texto da mensagem (sem aspas, sem markdown).`;

  try {
    const openai = getClient();
    const response = await withRetry(() => openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 200,
    }), { label: "gerarMensagem" });

    return safeContent(response);
  } catch (err) {
    console.error(`Erro ao gerar mensagem para ${lead.nome}:`, err.message);
    return null;
  }
}

/**
 * Analisa resposta recebida do lead e sugere ação.
 * @param {string} mensagemLead - Texto que o lead respondeu
 * @returns {Promise<{intencao: string, sugestao: string}|null>}
 */
async function analisarResposta(mensagemLead) {
  const prompt = `Analise esta resposta de um lead em prospecção comercial via WhatsApp.

Resposta do lead:
"${mensagemLead}"

Classifique a intenção e sugira uma ação:
- "interessado" = lead mostrou interesse, quer saber mais
- "recusou" = lead não tem interesse
- "duvida" = lead tem dúvida ou quer mais informações
- "agendar" = lead quer marcar reunião ou conversa
- "outro" = não se encaixa nas anteriores

Responda APENAS no formato JSON (sem markdown, sem code block):
{"intencao": "<classificação>", "sugestao": "<sugestão breve de resposta em 1 linha>"}`;

  try {
    const openai = getClient();
    const response = await withRetry(() => openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    }), { label: "analisarResposta" });

    let text = safeContent(response);
    text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (err) {
    console.error("Erro ao analisar resposta:", err.message);
    return null;
  }
}

/**
 * Chat livre com IA — mantém contexto da conversa + config do usuário.
 * @param {Array} historico - [{role: "user"|"assistant", content: "..."}]
 * @param {string} mensagem - Nova mensagem do usuário
 * @param {Object} [contexto] - Contexto do usuário (config + stats)
 * @param {string} [contexto.produto] - Produto/serviço configurado
 * @param {string} [contexto.nicho] - Nicho principal configurado
 * @param {string[]} [contexto.nichos] - Lista de nichos configurados
 * @param {string} [contexto.tom] - Tom de voz configurado
 * @param {Object} [contexto.stats] - Estatísticas de leads
 * @returns {Promise<string|null>}
 */
async function chatComIA(historico, mensagem, contexto = {}) {
  let systemContent = "Você é um assistente especialista em marketing digital, prospecção de clientes e vendas via WhatsApp. Responda de forma clara, direta e útil. Português brasileiro.";

  if (contexto.produto) {
    systemContent += `\n\nPRODUTO/SERVIÇO DO USUÁRIO: ${contexto.produto}`;
  }
  if (contexto.objetivo) {
    systemContent += `\nOBJETIVO ATUAL DO USUÁRIO: ${contexto.objetivo}`;
  }
  if (contexto.nicho) {
    systemContent += `\nNICHO PRINCIPAL: ${contexto.nicho}`;
  }
  if (contexto.nichos && contexto.nichos.length > 0) {
    systemContent += `\nNICHOS CONFIGURADOS: ${contexto.nichos.join(", ")}`;
  }
  if (contexto.tom) {
    systemContent += `\nTOM DE MENSAGEM: ${contexto.tom}`;
  }
  if (contexto.stats) {
    const s = contexto.stats;
    systemContent += `\nSTATUS ATUAL: ${s.total || 0} leads totais, ${s.pendentes || 0} pendentes, ${s.contatados || 0} contatados, ${s.totalEnviados || 0} enviados, ${s.totalInvalidos || 0} inválidos.`;
  }
  systemContent += "\n\nUse essas informações para dar respostas personalizadas e relevantes ao contexto do usuário. Se ele perguntar sobre nichos, leads, mensagens ou prospecção, já conheça o contexto dele.";

  const systemMsg = { role: "system", content: systemContent };
  const messages = [systemMsg, ...historico.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: mensagem }];

  try {
    const openai = getClient();
    const response = await withRetry(() => openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }), { label: "chatComIA" });
    return safeContent(response);
  } catch (err) {
    console.error("Erro no chat IA:", err.message);
    return null;
  }
}

/**
 * Extrai resumo das últimas mensagens do chat para usar como contexto.
 * @param {Array} mensagens - [{role, content}]
 * @param {number} [maxMsgs=10] - Últimas N mensagens
 * @returns {string} Resumo do contexto do chat
 */
function extrairContextoChat(mensagens, maxMsgs = 10) {
  if (!Array.isArray(mensagens) || mensagens.length === 0) return "";
  const recentes = mensagens.slice(-maxMsgs);
  return recentes.map((m) => {
    const prefixo = m.role === "user" ? "Usuário" : "Assistente";
    return `${prefixo}: ${m.content}`;
  }).join("\n");
}

/**
 * Auto-configuração por IA: analisa nicho + produto e retorna config completa.
 * @param {string|string[]} nicho - Nicho(s) do negócio
 * @param {string} produto - Descrição do produto/serviço
 * @returns {Promise<Object>} Configuração otimizada
 */
async function autoConfigurar(nicho, produto, objetivo = "", cidade = "") {
  const nichoStr = Array.isArray(nicho) ? nicho.join(", ") : nicho;

  const prompt = `Especialista em prospecção comercial via WhatsApp + Google Maps no Brasil.
Gere configuração OTIMIZADA com base nos dados do usuário abaixo.

=== DADOS DO USUÁRIO ===
PRODUTO/SERVIÇO: ${produto}
NICHO(S): ${nichoStr || "não definido — sugira os melhores para o produto"}
${objetivo ? `OBJETIVO: ${objetivo}` : ""}
CAMPO CIDADE (preenchido anteriormente): ${cidade || "vazio"}

=== REGRA CRÍTICA — cidade_recomendada ===
Determine a área geográfica REAL do usuário seguindo esta prioridade:

PRIORIDADE 1 — Se PRODUTO ou OBJETIVO menciona qualquer localização (estado, região, cidade):
  → Use ESSA localização. Ignore o CAMPO CIDADE.
  → Ex: produto diz "buscar em Minas Gerais e Goiás" → use MG e GO, não o campo cidade.

PRIORIDADE 2 — Se PRODUTO e OBJETIVO não mencionam localização, mas CAMPO CIDADE está preenchido:
  → Use o CAMPO CIDADE como está.

PRIORIDADE 3 — Sem localização em nenhum campo:
  → Sugira a melhor cidade/região para o nicho, ou "brasil" para busca nacional.

FORMATO de cidade_recomendada:
- Estado(s) ou região mencionados → liste 5-7 principais CIDADES desses estados separadas por vírgula.
  Ex: "Minas Gerais e Goiás" → "Belo Horizonte, Uberlândia, Contagem, Juiz de Fora, Goiânia, Aparecida de Goiânia, Anápolis"
- Cidade específica → só essa cidade.
- Busca nacional → "brasil".

=== OUTRAS REGRAS ===
- nichos_sugeridos: 3 a 5 nichos ESPECÍFICOS e rentáveis para o produto (ex: "cooperativas agrícolas", não "empresas"). Alto volume no Google Maps.
- delay_min/delay_max: segundos entre mensagens. Mín 30s, máx 120s.
- limite_diario: mensagens/dia. Entre 30-70.
- tom: "profissional" (B2B/agro/serviços), "casual" (varejo/alimentação), "amigável" (saúde/bem-estar).
- min_score: 0-100. Nichos amplos = 30-45. Nichos premium = 55-75.
- horario_inicio/horario_fim: horário comercial real do nicho (formato "HH:MM").
- almoco_inicio/almoco_fim: pausa ao meio-dia (formato "HH:MM").
- dias_semana: [1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb, 0=Dom].
- max_per_hour: 5-15.
- justificativa: 1 frase curta (max 15 palavras).

Retorne APENAS este JSON preenchido (sem markdown, sem texto fora do JSON):
{
  "nichos_sugeridos": ["nicho específico 1", "nicho específico 2", "nicho específico 3"],
  "cidade_recomendada": "Cidade1, Cidade2, Cidade3",
  "delay_min": 35,
  "delay_max": 75,
  "limite_diario": 50,
  "tom": "profissional",
  "min_score": 45,
  "horario_inicio": "09:00",
  "horario_fim": "18:00",
  "almoco_inicio": "12:00",
  "almoco_fim": "13:00",
  "dias_semana": [1, 2, 3, 4, 5],
  "max_per_hour": 8,
  "justificativa": "frase curta aqui"
}`;

  const openai = getClient();
  const response = await withRetry(() => openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "Responda APENAS com JSON válido. Sem markdown, sem texto extra, sem explicações fora do JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 1000,
  }), { label: "autoConfigurar" });

  let text = safeContent(response);
  // Remove markdown code blocks if present
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  console.log("[autoConfigurar] resposta bruta:", text);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("A IA não conseguiu gerar uma resposta válida. Tente novamente.");
  return JSON.parse(jsonMatch[0]);
}

/**
 * Gera templates de mensagem de WhatsApp para prospecção.
 * @param {string} produto - Descrição do produto/serviço
 * @param {string} nicho - Nicho alvo
 * @param {string} tom - "profissional" | "casual" | "amigável"
 * @param {number} quantidade - Quantidade de templates (padrão 5)
 * @returns {Promise<string[]>}
 */
async function gerarMensagensTemplate(produto, nicho = "", tom = "profissional", quantidade = 5, objetivo = "") {
  const prompt = `Gere ${quantidade} templates de mensagem de WhatsApp para prospecção comercial.

Produto/serviço: ${produto}
${nicho ? `Nicho alvo: ${nicho}` : ""}
${objetivo ? `Objetivo atual: ${objetivo}` : ""}
Tom: ${tom}

Regras:
- Cada mensagem deve ter no máximo 2 frases curtas
- Use {nome} para inserir o nome do lead
- Seja direto, sem enrolação
- Linguagem natural em português brasileiro
- Varie o estilo entre as mensagens (pergunta, elogio, proposta direta, curiosidade)
- Não use emojis exagerados

Responda APENAS no formato JSON (sem markdown, sem code block):
{"mensagens": ["mensagem1", "mensagem2", ...]}`;

  const openai = getClient();
  const response = await withRetry(() => openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.8,
    max_tokens: 800,
  }), { label: "gerarMensagensTemplate" });

  let text = safeContent(response);
  text = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("A IA não conseguiu gerar uma resposta válida. Tente novamente.");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.mensagens)) throw new Error("A IA retornou dados em formato inesperado. Tente novamente.");
  return parsed.mensagens;
}

module.exports = { sugerirNichos, avaliarLead, gerarMensagem, analisarResposta, chatComIA, extrairContextoChat, autoConfigurar, gerarMensagensTemplate };
