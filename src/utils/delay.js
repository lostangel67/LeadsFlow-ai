/**
 * LeadsFlow — Módulo de Delay Inteligente
 * Simula comportamento humano com delays aleatórios.
 */

/**
 * Retorna uma Promise que resolve após um delay aleatório
 * entre min e max segundos.
 * @param {number} minSeg - Delay mínimo em segundos (padrão: 35)
 * @param {number} maxSeg - Delay máximo em segundos (padrão: 85)
 * @returns {Promise<number>} - O tempo de espera efetivo em segundos
 */
async function delayInteligente(minSeg = 35, maxSeg = 85) {
  const tempoMs = gerarDelayAleatorio(minSeg, maxSeg);
  const tempoSeg = (tempoMs / 1000).toFixed(1);
  console.log(`⏱️  Aguardando ${tempoSeg}s antes da próxima ação...`);
  await new Promise((resolve) => setTimeout(resolve, tempoMs));
  return tempoMs;
}

/**
 * Gera um valor aleatório em milissegundos entre min e max (em segundos).
 * @param {number} minSeg
 * @param {number} maxSeg
 * @returns {number} milissegundos
 */
function gerarDelayAleatorio(minSeg, maxSeg) {
  const min = minSeg * 1000;
  const max = maxSeg * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Delay curto para simular leitura / digitação humana (2-5 segundos).
 * @returns {Promise<void>}
 */
async function delayHumano() {
  const ms = Math.floor(Math.random() * 3000) + 2000; // 2000-5000ms
  console.log(`🧑  Simulando pausa humana de ${(ms / 1000).toFixed(1)}s...`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay muito curto para simular digitação caractere a caractere.
 * @returns {Promise<void>}
 */
async function delayDigitacao() {
  const ms = Math.floor(Math.random() * 150) + 50; // 50-200ms por caractere
  await new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  delayInteligente,
  gerarDelayAleatorio,
  delayHumano,
  delayDigitacao,
};
