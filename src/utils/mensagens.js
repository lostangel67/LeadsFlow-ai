/**
 * LeadsFlow — Módulo de Mensagens
 * Templates de mensagens para a prospecção.
 * Edite aqui para personalizar as mensagens enviadas.
 */

// ===== MENSAGENS DE ABERTURA =====
// O bot escolhe uma mensagem aleatória para cada lead.
// Use {nome} para inserir o nome do lead automaticamente.
const mensagensAbertura = [
  "Olá! Tudo bem? Vi o trabalho de vocês e fiquei interessado. Posso fazer uma pergunta rápida?",
  "Oi, tudo certo? Encontrei vocês pelo Google e queria conversar sobre uma parceria. Posso?",
  "Bom dia! Estou entrando em contato porque acredito que posso ajudar o seu negócio a crescer. Podemos conversar?",
  "Boa tarde! Vi que vocês atuam na área e tenho uma proposta que pode ser interessante. Topa ouvir?",
  "Olá! Tudo bem com você? Vi o seu perfil e achei muito interessante. Posso te fazer uma proposta rápida?",
  "Oi! Vi vocês no Google Maps e gostei muito do trabalho. Tenho uma ideia que pode ajudar. Posso compartilhar?",
  "Olá! Tudo bem? Encontrei o seu negócio e achei que poderíamos fazer algo juntos. Posso explicar?",
  "Bom dia! Vi que vocês têm um ótimo trabalho. Queria conversar sobre como posso contribuir. Topa?",
];

/**
 * Escolhe uma mensagem aleatória e substitui variáveis.
 * @param {string} nomeLead - Nome do lead para personalizar a mensagem
 * @returns {string} Mensagem pronta para envio
 */
function escolherMensagem(nomeLead = "") {
  const indice = Math.floor(Math.random() * mensagensAbertura.length);
  let mensagem = mensagensAbertura[indice];

  // Substitui {nome} pelo nome do lead se disponível
  if (nomeLead) {
    mensagem = mensagem.replace(/\{nome\}/g, nomeLead);
  }

  return mensagem;
}

/**
 * Gera mensagem personalizada via IA. Fallback para template estático.
 * @param {Object} lead - {nome, cidade, nicho}
 * @param {string} produto - Descrição do produto/serviço
 * @param {string} tom - "profissional" | "casual" | "amigável"
 * @param {string} [contextoChat] - Contexto das conversas recentes do chat
 * @returns {Promise<string>}
 */
async function escolherMensagemIA(lead, produto, tom = "profissional", contextoChat = "") {
  try {
    const { gerarMensagem } = require("../services/aiService");
    const msg = await gerarMensagem(lead, produto, tom, contextoChat);
    if (msg) return msg;
  } catch (_) {}
  return escolherMensagem(lead.nome);
}

module.exports = {
  mensagensAbertura,
  escolherMensagem,
  escolherMensagemIA,
};
