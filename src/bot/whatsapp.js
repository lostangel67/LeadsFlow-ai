/**
 * LeadsFlow — Bot do WhatsApp Web
 * Envia mensagens automaticamente via WhatsApp Web usando Puppeteer.
 * Com simulação de comportamento humano, retry e anti-detecção.
 */

const puppeteer = require("puppeteer");
const path = require("path");
const { delayInteligente, delayHumano, delayDigitacao } = require("../utils/delay");
const { telefoneSemFormatacao } = require("../utils/phoneFormatter");
const { marcarComoContatado } = require("../services/leadService");
const { escolherMensagem } = require("../utils/mensagens");
const logger = require("../utils/logger");

/**
 * Inicia o WhatsApp Web, aguarda login via QR Code e executa a campanha de envio.
 *
 * @param {Array<Object>} leads - Lista de leads para enviar mensagem
 * @param {Object} config
 * @returns {Promise<{ enviados: number, erros: number }>}
 */
async function iniciarCampanhaWhatsApp(leads, config) {
  const {
    delay_min = 35,
    delay_max = 85,
    limite_diario = 40,
    timeout_login = 120000,
    timeout_pagina = 60000,
    max_tentativas_envio = 2,
    delay_antes_digitar = 2000,
    delay_apos_enviar = 3000,
    headless = false,
    window_width = 1366,
    window_height = 768,
  } = config;

  console.log("\n💬 ===== CAMPANHA WHATSAPP WEB =====");
  console.log(`📋 Leads para envio: ${leads.length}`);
  console.log(`⏱️  Delay: ${delay_min}s — ${delay_max}s`);
  console.log(`🔒 Limite diário: ${limite_diario}`);
  console.log(`🔄 Tentativas por lead: ${max_tentativas_envio}`);
  console.log("=====================================\n");

  logger.info(`Campanha iniciada — ${leads.length} leads | Limite: ${limite_diario}`);

  // Diretório para dados do usuário do Chrome (mantém sessão do WhatsApp)
  const userDataDir = path.join(__dirname, "..", "..", "whatsapp-session");

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    userDataDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      `--window-size=${window_width},${window_height}`,
    ],
  });

  let enviados = 0;
  let erros = 0;

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    // Remove webdriver flag
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    // Abre o WhatsApp Web
    console.log("📱 Abrindo WhatsApp Web...");
    await page.goto("https://web.whatsapp.com", {
      waitUntil: "networkidle2",
      timeout: timeout_pagina,
    });

    // Aguarda o login (QR Code ou sessão salva)
    console.log("🔑 Aguardando login no WhatsApp Web...");
    console.log("   📸 Escaneie o QR Code se necessário.");
    console.log(`   ⏳ Tempo máximo: ${timeout_login / 1000} segundos\n`);

    await aguardarLogin(page, timeout_login);
    console.log("✅ Login realizado com sucesso!\n");
    logger.sucesso("Login WhatsApp Web realizado");

    // Pausa antes de começar os envios
    await new Promise((r) => setTimeout(r, 3000));

    // Loop de envio
    for (let i = 0; i < leads.length; i++) {
      // Verifica limite diário
      if (enviados >= limite_diario) {
        console.log(`\n🛑 Limite diário atingido (${limite_diario} mensagens). Parando envios.`);
        logger.info(`Limite diário atingido: ${limite_diario}`);
        break;
      }

      const lead = leads[i];
      const mensagem = escolherMensagem(lead.nome);

      console.log(`\n📤 [${i + 1}/${leads.length}] Enviando para: ${lead.nome} (${lead.telefone})`);
      console.log(`   💬 Mensagem: "${mensagem}"`);

      let sucesso = false;

      // Tenta enviar com retry
      for (let tentativa = 1; tentativa <= max_tentativas_envio; tentativa++) {
        try {
          if (tentativa > 1) {
            console.log(`   🔄 Tentativa ${tentativa}/${max_tentativas_envio}...`);
            await new Promise((r) => setTimeout(r, 5000));
          }

          sucesso = await enviarMensagem(page, lead.telefone, mensagem, {
            timeout_pagina,
            delay_antes_digitar,
            delay_apos_enviar,
          });

          if (sucesso) break;
        } catch (erroEnvio) {
          console.error(`   ❌ Erro (tentativa ${tentativa}): ${erroEnvio.message}`);
          logger.erro(`Erro envio ${lead.telefone} (tentativa ${tentativa}): ${erroEnvio.message}`);
        }
      }

      if (sucesso) {
        enviados++;
        marcarComoContatado(lead.telefone);
        console.log(`   ✅ Mensagem enviada! (${enviados}/${limite_diario})`);
        logger.sucesso(`Mensagem enviada: ${lead.nome} — ${lead.telefone} (${enviados}/${limite_diario})`);
      } else {
        erros++;
        console.log(`   ❌ Falha após ${max_tentativas_envio} tentativas para ${lead.telefone}`);
        logger.erro(`Falha total: ${lead.nome} — ${lead.telefone}`);
      }

      // Delay inteligente entre envios (exceto no último)
      if (i < leads.length - 1 && enviados < limite_diario) {
        await delayInteligente(delay_min, delay_max);
      }
    }
  } catch (erro) {
    console.error("\n❌ Erro na campanha WhatsApp:", erro.message);
    logger.erro(`Erro campanha: ${erro.message}`);
  } finally {
    console.log("\n📊 ===== RESUMO DA CAMPANHA =====");
    console.log(`   ✅ Enviados: ${enviados}`);
    console.log(`   ❌ Erros: ${erros}`);
    console.log(`   📋 Total processado: ${enviados + erros}`);
    console.log("=================================\n");

    logger.info(`Campanha finalizada — Enviados: ${enviados} | Erros: ${erros}`);

    // Mantém o navegador aberto por 10s antes de fechar
    console.log("⏳ Fechando navegador em 10 segundos...");
    await new Promise((r) => setTimeout(r, 10000));
    await browser.close();
    console.log("🔒 Navegador do WhatsApp fechado.");
  }

  return { enviados, erros };
}

/**
 * Aguarda o login no WhatsApp Web.
 * Detecta quando o chat principal aparece.
 * @param {import('puppeteer').Page} page
 * @param {number} timeout
 */
async function aguardarLogin(page, timeout = 120000) {
  // Espera até que o painel de chat apareça (indica login bem sucedido)
  const seletoresLogin = [
    '#pane-side',
    'div[data-testid="chat-list"]',
    'div[aria-label="Lista de conversas"]',
    'div[aria-label="Chat list"]',
    'header[data-testid="chatlist-header"]',
  ];

  await page.waitForFunction(
    (seletores) => {
      return seletores.some((sel) => document.querySelector(sel));
    },
    { timeout },
    seletoresLogin
  );
}

/**
 * Envia uma mensagem para um número via WhatsApp Web.
 * Simula comportamento humano com delays e digitação gradual.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} telefone - Número formatado (+55...)
 * @param {string} mensagem - Texto a enviar
 * @param {Object} opcoes
 * @returns {Promise<boolean>} - true se enviou com sucesso
 */
async function enviarMensagem(page, telefone, mensagem, opcoes = {}) {
  const {
    timeout_pagina = 60000,
    delay_antes_digitar = 2000,
    delay_apos_enviar = 3000,
  } = opcoes;

  const numero = telefoneSemFormatacao(telefone);
  const urlChat = `https://web.whatsapp.com/send?phone=${numero}&text=`;

  // 1. Abre a conversa
  console.log("   📱 Abrindo conversa...");
  await page.goto(urlChat, { waitUntil: "networkidle2", timeout: timeout_pagina });

  // Aguarda a caixa de mensagem aparecer
  await new Promise((r) => setTimeout(r, 5000));

  // Verifica se apareceu popup de número inválido
  const isInvalido = await page.evaluate(() => {
    const textoBody = document.body.textContent.toLowerCase();
    const termos = [
      "número de telefone compartilhado por url é inválido",
      "phone number shared via url is invalid",
      "número inválido",
      "invalid phone number",
    ];
    return termos.some((t) => textoBody.includes(t));
  });

  if (isInvalido) {
    console.log("   ⚠️  Número inválido ou não encontrado no WhatsApp");
    // Fecha popup se existir
    try {
      const btnOk = await page.$('div[data-testid="popup-controls-ok"], div[role="button"]');
      if (btnOk) await btnOk.click();
    } catch (_) {}
    return false;
  }

  // Seletores para o campo de mensagem — vários fallbacks
  const seletoresCampo = [
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][title="Digite uma mensagem"]',
    'div[contenteditable="true"][title="Type a message"]',
    'footer div[contenteditable="true"]',
    'div[data-testid="conversation-compose-box-input"]',
    'div[role="textbox"][contenteditable="true"]',
  ];

  // Tenta encontrar o campo
  let campo = await encontrarCampo(page, seletoresCampo);

  if (!campo) {
    // Tenta esperar mais um pouco
    console.log("   ⏳ Aguardando campo de mensagem...");
    await new Promise((r) => setTimeout(r, 8000));
    campo = await encontrarCampo(page, seletoresCampo);

    if (!campo) {
      console.log("   ❌ Campo de mensagem não encontrado");
      return false;
    }
  }

  // 2. Simula pausa humana (olhando a conversa)
  await delayHumano();

  // 3. Clica no campo de mensagem
  await campo.click();
  await new Promise((r) => setTimeout(r, delay_antes_digitar));

  // 4. Digita a mensagem caractere por caractere (simula digitação)
  console.log("   ⌨️  Digitando mensagem...");
  for (const char of mensagem) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100) + 30 });
    await delayDigitacao();
  }

  // 5. Pausa breve antes de enviar
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

  // 6. Pressiona Enter para enviar
  await page.keyboard.press("Enter");
  console.log("   📨 Mensagem enviada!");

  // 7. Aguarda o envio ser processado
  await new Promise((r) => setTimeout(r, delay_apos_enviar));

  // 8. Verifica se a mensagem foi enviada (check duplo)
  const foiEnviada = await page.evaluate(() => {
    // Procura ticks de envio (um check = enviada, dois = entregue)
    const ticks = document.querySelectorAll(
      'span[data-testid="msg-check"], span[data-testid="msg-dblcheck"], span[data-icon="msg-check"], span[data-icon="msg-dblcheck"]'
    );
    return ticks.length > 0;
  });

  if (!foiEnviada) {
    console.log("   ⚠️  Não foi possível confirmar o envio (pode ter sido enviada mesmo assim)");
  }

  return true;
}

/**
 * Tenta encontrar um campo usando múltiplos seletores.
 * @param {import('puppeteer').Page} page
 * @param {string[]} seletores
 * @returns {Promise<import('puppeteer').ElementHandle|null>}
 */
async function encontrarCampo(page, seletores) {
  for (const sel of seletores) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

module.exports = {
  iniciarCampanhaWhatsApp,
};
