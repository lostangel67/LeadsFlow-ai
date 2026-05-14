/**
 * Chat Observer — monitors WhatsApp conversations and suggests responses.
 */

const OpenAI = require("openai");

const API_KEY = "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";
const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODEL = "openai/gpt-oss-120b";

let lastMessages = [];
let lastAnalysis = null;
let client = null;

function getClient() {
  if (!client) {
    if (!API_KEY) throw new Error("NVIDIA_API_KEY é obrigatória no .env");
    client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });
  }
  return client;
}

async function extractCurrentChat(wc) {
  try {
    return await wc.executeJavaScript(`
      (function() {
        var msgs = [];
        var containers = document.querySelectorAll('div[class*="message-in"], div[class*="message-out"]');
        containers.forEach(function(c) {
          var isIncoming = c.className.includes('message-in');
          var textEl = c.querySelector('span[class*="selectable-text"]');
          if (!textEl) textEl = c.querySelector('span.i0jNr');
          if (!textEl) textEl = c.querySelector('div[class*="_11JPr"]');
          if (textEl) {
            var text = textEl.innerText.trim();
            if (text) msgs.push({ from: isIncoming ? "them" : "me", text: text });
          }
        });
        return msgs.slice(-20);
      })()
    `);
  } catch (err) {
    console.error("Erro ao extrair chat:", err.message);
    return [];
  }
}

async function analyzeAndSuggest(messages, context = {}) {
  if (!messages || messages.length === 0) return null;

  const conversationText = messages.map((m) => {
    const who = m.from === "me" ? "Eu" : "Lead";
    return `${who}: ${m.text}`;
  }).join("\n");

  let prompt = `Você é um assistente de vendas por WhatsApp. Analise esta conversa e sugira a melhor resposta para o vendedor.

CONVERSA:
${conversationText}`;

  if (context.produto) prompt += `\n\nPRODUTO/SERVIÇO: ${context.produto}`;
  if (context.nicho) prompt += `\nNICHO: ${context.nicho}`;
  if (context.tom) prompt += `\nTOM: ${context.tom}`;

  prompt += `

Analise:
1. A intenção do lead (interessado, dúvida, recusou, quer agendar, etc)
2. O tom da conversa
3. A melhor resposta para enviar

Responda APENAS em JSON (sem markdown):
{"intent": "<intenção do lead>", "analysis": "<análise curta em 1 linha>", "suggestion": "<sugestão de resposta pronta para enviar>"}`;

  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 300,
    });

    const text = response.choices[0].message.content.trim();
    const parsed = JSON.parse(text);
    lastAnalysis = parsed;
    return parsed;
  } catch (err) {
    console.error("Erro na análise do chat:", err.message);
    return null;
  }
}

function getLastAnalysis() { return lastAnalysis; }
function getLastMessages() { return lastMessages; }
function setLastMessages(msgs) { lastMessages = msgs; }

module.exports = { extractCurrentChat, analyzeAndSuggest, getLastAnalysis, getLastMessages, setLastMessages };
