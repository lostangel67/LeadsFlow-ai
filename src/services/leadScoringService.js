/**
 * LeadsFlow — Serviço de Scoring de Leads
 * Avalia leads em batch usando IA e filtra por score mínimo.
 */

const { avaliarLead } = require("./aiService");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Avalia lista de leads com scoring de IA.
 * Processa em batches com delay de 1s entre cada batch.
 *
 * @param {Array<Object>} leads - Lista de leads para avaliar
 * @param {Object} opcoes
 * @param {number} [opcoes.batchSize=5] - Leads por chamada de API
 * @param {number} [opcoes.minScore=40] - Score mínimo para aprovar
 * @param {Function} [opcoes.onProgress] - Callback: {processados, total, aprovados}
 * @param {string} [opcoes.produto] - Descrição do produto/serviço
 * @param {string} [opcoes.contextoChat] - Contexto das conversas recentes do chat
 *
 * @returns {Promise<{aprovados: Array, rejeitados: Array, stats: {total, aprovados, number, rejeitados: number}}>}
 */
async function avaliarLeads(leads, opcoes = {}) {
  const { batchSize = 5, minScore = 40, onProgress, produto = "", contextoChat = "" } = opcoes;
  const aprovados = [];
  const rejeitados = [];
  let processados = 0;

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);
    const resultados = await Promise.all(batch.map((lead) => avaliarLead(lead, produto, contextoChat)));

    for (let j = 0; j < batch.length; j++) {
      const lead = { ...batch[j], ...resultados[j] };
      if (resultados[j].score >= minScore) {
        aprovados.push(lead);
      } else {
        rejeitados.push(lead);
      }
    }

    processados += batch.length;

    if (onProgress) {
      const lastLead = batch[batch.length - 1];
      onProgress({
        processados,
        total: leads.length,
        aprovados: aprovados.length,
        currentLead: lastLead?.nome || "Desconhecido",
      });
    }

    // Delay entre batches (exceto no último)
    if (i + batchSize < leads.length) {
      await delay(1000);
    }
  }

  return {
    aprovados,
    rejeitados,
    stats: {
      total: leads.length,
      aprovados: aprovados.length,
      rejeitados: rejeitados.length,
    },
  };
}

/**
 * Ordena leads por score decrescente.
 * @param {Array<Object>} leads
 * @returns {Array<Object>}
 */
function ordenarPorScore(leads) {
  return [...leads].sort((a, b) => (b.score || 0) - (a.score || 0));
}

module.exports = { avaliarLeads, ordenarPorScore };
