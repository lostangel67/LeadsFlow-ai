/**
 * LeadsFlow — Módulo de Formatação de Telefone
 * Formata e valida números de telefone brasileiros.
 * Adiciona +55 automaticamente a TODOS os números que não têm.
 */

/**
 * Formata um número de telefone para o padrão internacional brasileiro.
 * - Remove caracteres não numéricos
 * - Adiciona +55 se não tiver
 * - Aceita números de 10 ou 11 dígitos (DDD + número)
 * - Aceita formatos: (11) 99999-8888, 11999998888, +5511999998888, 5511999998888
 *
 * @param {string} telefone - Número bruto extraído
 * @returns {string|null} - Número formatado (+55...) ou null se inválido
 */
function formatarTelefone(telefone) {
  if (!telefone || typeof telefone !== "string") {
    return null;
  }

  // Remove tudo que não é dígito
  let numeros = telefone.replace(/\D/g, "");

  // Remove zeros à esquerda extras (ex: 0xx)
  if (numeros.startsWith("0") && (numeros.length === 11 || numeros.length === 12)) {
    // Formato 0XX XXXX-XXXX ou 0XX 9XXXX-XXXX (com zero do DDD antigo)
    numeros = numeros.substring(1); // Remove o zero
  }

  // Se começa com 55 e tem 12-13 dígitos, já tem código do país
  if (numeros.startsWith("55") && (numeros.length === 12 || numeros.length === 13)) {
    return `+${numeros}`;
  }

  // Se começa com 55 mas tem tamanho errado
  if (numeros.startsWith("55") && numeros.length > 13) {
    // Tenta extrair os últimos 10-11 dígitos
    const ultimos = numeros.slice(-11);
    if (ultimos.length === 10 || ultimos.length === 11) {
      return `+55${ultimos}`;
    }
    return null;
  }

  // 10 dígitos = fixo (DDD + 8 dígitos): (XX) XXXX-XXXX
  // 11 dígitos = celular (DDD + 9 + 8 dígitos): (XX) 9XXXX-XXXX
  if (numeros.length === 10 || numeros.length === 11) {
    return `+55${numeros}`;
  }

  // 8-9 dígitos = sem DDD — não conseguimos completar sem saber a cidade
  // Mas para maximizar resultados, usa DDD genérico? Não — retorna null.
  if (numeros.length === 8 || numeros.length === 9) {
    // Sem DDD — inválido para WhatsApp
    return null;
  }

  // Número inválido
  return null;
}

/**
 * Valida se um número de telefone formatado é válido.
 * @param {string} telefone - Número no formato +55XXXXXXXXXXX
 * @returns {boolean}
 */
function validarTelefone(telefone) {
  if (!telefone) return false;
  // +55 + 10 ou 11 dígitos = 13 ou 14 caracteres totais
  const regex = /^\+55\d{10,11}$/;
  return regex.test(telefone);
}

/**
 * Extrai apenas os dígitos de um telefone (com código do país).
 * Útil para montar links wa.me.
 * @param {string} telefone - Número formatado (+55...)
 * @returns {string} - Apenas dígitos com código do país (ex: "5511999998888")
 */
function telefoneSemFormatacao(telefone) {
  if (!telefone) return "";
  return telefone.replace(/\D/g, "");
}

module.exports = {
  formatarTelefone,
  validarTelefone,
  telefoneSemFormatacao,
};
