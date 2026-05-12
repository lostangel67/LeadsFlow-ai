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
async function sugerirNichos(produto, descricao = "") {
  const prompt = `Você é um especialista em marketing e prospecção de clientes no Brasil.

Com base nesta descrição de produto/serviço:
"${produto}"
${descricao ? `Contexto adicional: ${descricao}` : ""}

Sugira 8 a 10 nichos de empresas/negócios que são os MELHORES potenciais compradores desse produto.
Considere: ticket médio, necessidade do serviço, facilidade de contato, volume de mercado.

Responda APENAS no formato JSON (sem markdown, sem code block):
{"nichos": ["nicho1", "nicho2", "nicho3", ...]}

Use nomes de nichos em português, minúsculos, como: "dentistas", "advogados", "restaurantes", "pet shop", etc.`;

  try {
    const openai = getClient();
    const response = await withRetry(() => openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    }), { label: "sugerirNichos" });

    const text = response.choices[0].message.content.trim();
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

    const text = response.choices[0].message.content.trim();
    const parsed = JSON.parse(text);
    return {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      motivoScore: String(parsed.motivoScore || "Sem justificativa"),
    };
  } catch (err) {
    console.error(`Erro ao avaliar lead ${lead.nome}:`, err.message);
    return { score: 0, motivoScore: `Erro: ${err.message}` };
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

    return response.choices[0].message.content.trim();
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

    const text = response.choices[0].message.content.trim();
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
    return response.choices[0].message.content.trim();
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
async function autoConfigurar(nicho, produto, objetivo = "") {
  const nichoStr = Array.isArray(nicho) ? nicho.join(", ") : nicho;
  const prompt = `Você é um especialista em prospecção via WhatsApp no Brasil.
Com base no nicho, produto e objetivo abaixo, gere uma configuração COMPLETA e OTIMIZADA para automação de prospecção.

NICHOS: ${nichoStr}
PRODUTO: ${produto}
${objetivo ? `OBJETIVO ATUAL: ${objetivo}` : ""}

Considere:
- Delays seguros para não ser bloqueado pelo WhatsApp
- Limites diários realistas para o nicho
- Horário comercial adequado ao tipo de negócio
- Tom de mensagem que funcione para o nicho
- Score mínimo que filtre leads relevantes

Retorne APENAS JSON válido (sem markdown, sem texto extra):
{
  "nichos_sugeridos": ["nicho1", "nicho2"],
  "cidade_recomendada": "brasil",
  "delay_min": 35,
  "delay_max": 85,
  "limite_diario": 40,
  "tom": "profissional",
  "min_score": 40,
  "horario_inicio": "09:00",
  "horario_fim": "18:00",
  "almoco_inicio": "12:00",
  "almoco_fim": "13:00",
  "dias_semana": [1, 2, 3, 4, 5],
  "max_per_hour": 10,
  "justificativa": "breve explicação das escolhas"
}`;

  const openai = getClient();
  const response = await withRetry(() => openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    max_tokens: 500,
  }), { label: "autoConfigurar" });

  const text = response.choices[0].message.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Resposta da IA não contém JSON válido");
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

  const text = response.choices[0].message.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Resposta da IA não contém JSON válido");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.mensagens)) throw new Error("Formato inválido");
  return parsed.mensagens;
}

module.exports = { sugerirNichos, avaliarLead, gerarMensagem, analisarResposta, chatComIA, extrairContextoChat, autoConfigurar, gerarMensagensTemplate };
