/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         LeadsFlow — Arquivo de Configuração          ║
 * ║                                                         ║
 * ║  Edite as variáveis abaixo para customizar o bot.       ║
 * ╚══════════════════════════════════════════════════════════╝
 */

module.exports = {
  // ===== BUSCA NO GOOGLE MAPS =====
  nicho: "dentistas",              // Nicho para buscar (ex: "dentistas", "advogados", "academias")
  modo: "brasil",                  // "brasil" (todas as capitais) ou "cidade" (uma cidade específica)
  cidade: null,                    // Preencher se modo === "cidade" (ex: "São Paulo")

  // ===== DELAYS (em segundos) =====
  delay_min: 35,                   // Delay mínimo entre envios de mensagem
  delay_max: 85,                   // Delay máximo entre envios de mensagem

  // ===== LIMITES =====
  limite_diario: 40,               // Máximo de mensagens por execução

  // ===== GOOGLE MAPS =====
  max_leads_por_cidade: 500,       // Máximo de leads por cidade (500 = pegar tudo possível)
  delay_entre_cidades_min: 3000,   // Delay mínimo entre cidades (ms)
  delay_entre_cidades_max: 8000,   // Delay máximo entre cidades (ms)

  // ===== WHATSAPP =====
  timeout_login: 120000,           // Timeout para login (ms) — 2 minutos
  timeout_pagina: 60000,           // Timeout para carregar páginas (ms)
  delay_antes_digitar: 2000,       // Delay antes de começar a digitar (ms)
  delay_apos_enviar: 3000,         // Delay após enviar a mensagem (ms)
  max_tentativas_envio: 2,         // Tentativas de envio por lead

  // ===== NAVEGADOR =====
  headless: false,                 // true = navegador invisível, false = visível
  window_width: 1366,
  window_height: 768,
};
