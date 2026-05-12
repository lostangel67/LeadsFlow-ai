/**
 * LeadsFlow — Logger
 * Salva logs em arquivo para histórico de execuções.
 */

const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "..", "..", "logs");
const LOG_FILE = path.join(LOGS_DIR, `execucao_${formatarData()}.log`);

/**
 * Formata a data atual para nome de arquivo.
 * @returns {string} ex: "2026-04-13_15-30"
 */
function formatarData() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  const hora = String(agora.getHours()).padStart(2, "0");
  const min = String(agora.getMinutes()).padStart(2, "0");
  return `${ano}-${mes}-${dia}_${hora}-${min}`;
}

/**
 * Garante que o diretório de logs existe.
 */
function garantirDiretorio() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Escreve uma linha no arquivo de log.
 * @param {string} tipo - Tipo da mensagem (INFO, ERRO, SUCESSO, AVISO)
 * @param {string} mensagem - Mensagem para salvar
 */
function log(tipo, mensagem) {
  garantirDiretorio();

  const timestamp = new Date().toISOString();
  const linha = `[${timestamp}] [${tipo}] ${mensagem}\n`;

  try {
    fs.appendFileSync(LOG_FILE, linha, "utf-8");
  } catch (_) {
    // Falha silenciosa — não deve interromper o bot
  }
}

/**
 * Log de informação.
 * @param {string} msg
 */
function info(msg) {
  log("INFO", msg);
}

/**
 * Log de sucesso.
 * @param {string} msg
 */
function sucesso(msg) {
  log("SUCESSO", msg);
}

/**
 * Log de aviso.
 * @param {string} msg
 */
function aviso(msg) {
  log("AVISO", msg);
}

/**
 * Log de erro.
 * @param {string} msg
 */
function erro(msg) {
  log("ERRO", msg);
}

/**
 * Salva o resumo final da execução no log.
 * @param {Object} resumo
 */
function salvarResumo(resumo) {
  log("RESUMO", "═".repeat(50));
  log("RESUMO", `Total de leads no banco: ${resumo.total || 0}`);
  log("RESUMO", `Leads novos encontrados: ${resumo.novos || 0}`);
  log("RESUMO", `Mensagens enviadas: ${resumo.enviados || 0}`);
  log("RESUMO", `Erros no envio: ${resumo.erros || 0}`);
  log("RESUMO", `Leads pendentes: ${resumo.pendentes || 0}`);
  log("RESUMO", "═".repeat(50));
}

module.exports = {
  info,
  sucesso,
  aviso,
  erro,
  salvarResumo,
  LOG_FILE,
};
