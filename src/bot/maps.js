/**
 * LeadsFlow — Scraper Rápido do Google Maps
 * Extrai leads em batch (nome + telefone) sem clicar em cada card.
 * Estratégia: scroll → extrair tudo de uma vez → só clicar nos que faltam telefone.
 */

const puppeteer = require("puppeteer");
const { formatarTelefone } = require("../utils/phoneFormatter");

// ===== LISTA DE CAPITAIS BRASILEIRAS =====
const cidadesBrasil = [
  "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Brasília", "Salvador",
  "Fortaleza", "Curitiba", "Recife", "Porto Alegre", "Goiânia", "Belém",
  "Manaus", "São Luís", "Maceió", "Natal", "João Pessoa", "Teresina",
  "Campo Grande", "Cuiabá", "Florianópolis", "Aracaju", "Palmas",
  "Boa Vista", "Rio Branco", "Macapá", "Porto Velho", "Vitória",
];

/**
 * Callback de log opcional para integração com a UI.
 * @callback LogCallback
 * @param {string} message
 */

/**
 * Busca leads no Google Maps para um nicho em uma lista de cidades.
 * Usa extração em batch para máxima velocidade.
 *
 * @param {Object} config
 * @param {string} config.nicho
 * @param {string} config.modo - "brasil" ou "cidade"
 * @param {string|null} config.cidade
 * @param {number} [config.max_leads_por_cidade=500] - Limite de leads por cidade (500+ = pegar tudo possível)
 * @param {boolean} [config.headless=false]
 * @param {Set<string>} [config._numerosJaUsados] - Números que já foram enviados (serão ignorados)
 * @param {LogCallback} [config._onLog]
 * @param {Function} [config._shouldStop]
 * @returns {Promise<Array<{nome: string, telefone: string, cidade: string, nicho: string}>>}
 */
async function buscarLeadsMaps(config) {
  const {
    nicho,
    modo,
    cidade,
    max_leads_por_cidade = 500,
    headless = false,
    _numerosJaUsados = new Set(),
    _onLog = console.log,
    _shouldStop = () => false,
  } = config;

  const cidades = modo === "brasil" ? cidadesBrasil : [cidade];
  const todosLeads = [];

  _onLog(`🌎 Busca rápida — Nicho: ${nicho} | ${cidades.length} cidade(s)`);

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    // Anti-detecção
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    for (let i = 0; i < cidades.length; i++) {
      if (_shouldStop()) {
        _onLog("⛔ Busca interrompida pelo usuário.");
        break;
      }

      const cidadeAtual = cidades[i];
      const termoBusca = `${nicho} em ${cidadeAtual}`;

      _onLog(`🔍 [${i + 1}/${cidades.length}] "${termoBusca}"`);

      try {
        const leads = await extrairLeadsDaCidade(page, termoBusca, cidadeAtual, nicho, {
          max_leads_por_cidade,
          _numerosJaUsados,
          _onLog,
          _shouldStop,
        });

        todosLeads.push(...leads);
        _onLog(`✅ ${leads.length} leads extraídos de ${cidadeAtual}`);
      } catch (err) {
        _onLog(`❌ Erro em ${cidadeAtual}: ${err.message}`);
      }

      // Pausa curta entre cidades (2-4s)
      if (i < cidades.length - 1 && !_shouldStop()) {
        const pausa = 2000 + Math.random() * 2000;
        await sleep(pausa);
      }
    }
  } catch (err) {
    _onLog(`❌ Erro geral: ${err.message}`);
  } finally {
    await browser.close();
    _onLog(`🔒 Navegador fechado. Total bruto: ${todosLeads.length} leads`);
  }

  return todosLeads;
}

/**
 * Extrai leads de uma cidade específica usando extração em batch.
 *
 * Fluxo:
 * 1. Navega para a busca
 * 2. Scroll até o FIM REAL da lista (sem limite fixo)
 * 3. Extrai TODOS os nomes e telefones de uma vez
 * 4. Só clica individualmente nos que faltam telefone (até atingir o limite)
 */
async function extrairLeadsDaCidade(page, termoBusca, cidade, nicho, opcoes) {
  const { max_leads_por_cidade, _numerosJaUsados, _onLog, _shouldStop } = opcoes;
  const leads = [];
  // 9999 = pegar tudo possível
  const limiteReal = (!max_leads_por_cidade || max_leads_por_cidade >= 500) ? 9999 : max_leads_por_cidade;

  // 1. Navegar
  const url = `https://www.google.com/maps/search/${encodeURIComponent(termoBusca)}`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(3000);

  // Aceitar cookies
  await tentarAceitarCookies(page);

  // 2. Scroll até o fim real da lista
  _onLog("   📜 Rolando lista até o fim...");
  await scrollAteFim(page);

  // 3. EXTRAÇÃO EM BATCH — seleciona apenas div.Nv2PK para evitar duplicatas
  // O seletor 'div.Nv2PK, a.hfpxzc' retornava cada resultado 2x (div + link interno)
  _onLog("   ⚡ Extraindo dados em batch...");
  const dadosBrutos = await page.evaluate(() => {
    const resultados = [];
    let cards = document.querySelectorAll('div.Nv2PK');
    if (cards.length === 0) {
      // Fallback: se não houver div.Nv2PK, tenta a.hfpxzc
      cards = document.querySelectorAll('a.hfpxzc');
    }

    cards.forEach((card) => {
      try {
        let nome = null;
        let telefone = null;
        let href = null;

        // Pega nome e href do link interno (a.hfpxzc)
        const link = card.querySelector('a.hfpxzc') || (card.tagName === 'A' ? card : null);
        if (link) {
          nome = (link.getAttribute('aria-label') || '').trim();
          href = link.getAttribute('href') || null;
        }
        // Fallback para nome via texto
        if (!nome) {
          const nomeEl = card.querySelector('.fontHeadlineSmall, .qBF1Pd');
          if (nomeEl) nome = nomeEl.textContent.trim();
        }

        const infoEls = card.querySelectorAll('.W4Efsd, .UsdlK, span');
        for (const el of infoEls) {
          const match = el.textContent.match(/\(?\d{2}\)?\s*\d{4,5}[\s\-]?\d{4}/);
          if (match) {
            telefone = match[0];
            break;
          }
        }

        if (nome) {
          resultados.push({ nome, telefone, temTelefone: !!telefone, href });
        }
      } catch (_) {}
    });

    return resultados;
  });

  _onLog(`   📋 ${dadosBrutos.length} resultados na lista`);

  const comTelefone = dadosBrutos.filter(d => d.temTelefone);
  const semTelefone = dadosBrutos.filter(d => !d.temTelefone);

  _onLog(`   📞 ${comTelefone.length} com tel. visível | 🔍 ${semTelefone.length} sem tel.`);

  // 4. Coleta TODOS com telefone visível (sem parar no limite — aplica no final)
  let ignoradosJaUsados = 0;
  for (const dado of comTelefone) {
    const tel = formatarTelefone(dado.telefone);
    if (tel) {
      if (_numerosJaUsados.has(tel)) {
        ignoradosJaUsados++;
        continue;
      }
      leads.push({ nome: dado.nome, telefone: tel, cidade, nicho });
      _numerosJaUsados.add(tel);
    }
  }
  if (ignoradosJaUsados > 0) {
    _onLog(`   🔄 ${ignoradosJaUsados} números pulados (já enviados/coletados)`);
  }

  // 5. Navega nas páginas dos sem telefone para buscar (mais confiável que clicar por nome)
  if (leads.length < limiteReal && semTelefone.length > 0 && !_shouldStop()) {
    const faltam = limiteReal - leads.length;
    const alvos = semTelefone.filter(d => d.href).slice(0, Math.min(faltam, semTelefone.length));
    const semHref = semTelefone.filter(d => !d.href).length;
    _onLog(`   🔎 Abrindo ${alvos.length} páginas para buscar telefone${semHref > 0 ? ` (${semHref} sem link, pulados)` : ''}...`);

    const leadsExtras = await extrairTelefonesNavegando(
      page,
      alvos,
      cidade,
      nicho,
      termoBusca,
      _onLog,
      _shouldStop,
      _numerosJaUsados,
      limiteReal - leads.length
    );

    leads.push(...leadsExtras);
  }

  // Aplica o limite final
  const resultado = leads.slice(0, limiteReal);
  if (leads.length > resultado.length) {
    _onLog(`   ✂️ Limite de ${limiteReal} aplicado (${leads.length} encontrados no total)`);
  }
  return resultado;
}

/**
 * Navega diretamente para a página de cada estabelecimento via href para extrair telefone.
 * Muito mais confiável que clicar por nome (que falha quando o card saiu do DOM ou nome não bate).
 */
async function extrairTelefonesNavegando(page, alvos, cidade, nicho, termoBusca, _onLog, _shouldStop, _numerosJaUsados = new Set(), limite = 9999) {
  const leads = [];
  const urlLista = `https://www.google.com/maps/search/${encodeURIComponent(termoBusca)}`;

  for (const d of alvos) {
    if (_shouldStop() || leads.length >= limite) break;

    try {
      const urlAlvo = d.href.startsWith('http') ? d.href : `https://www.google.com${d.href}`;
      await page.goto(urlAlvo, { waitUntil: "networkidle2", timeout: 30000 });
      await sleep(2000);

      const telefone = await page.evaluate(() => {
        // Método 1: link tel:
        const telLink = document.querySelector('a[href^="tel:"]');
        if (telLink) return telLink.getAttribute('href').replace('tel:', '').trim();

        // Método 2: botão de telefone
        const seletores = [
          'button[data-tooltip="Copiar número de telefone"]',
          'button[data-tooltip="Copy phone number"]',
          'button[aria-label*="Telefone"]',
          'button[aria-label*="Phone"]',
          'button[data-item-id*="phone"]',
        ];
        for (const sel of seletores) {
          const el = document.querySelector(sel);
          if (el) {
            const texto = el.getAttribute("aria-label") || el.textContent || "";
            const match = texto.match(/[\d\s\-()+ ]{8,}/);
            if (match) return match[0].trim();
          }
        }

        // Método 3: seção de informações
        const infos = document.querySelectorAll('[data-section-id="pn0"] .Io6YTe, .rogA2c .Io6YTe, .Io6YTe');
        for (const el of infos) {
          const match = el.textContent.match(/\(?\d{2}\)?\s*\d{4,5}[\s\-]?\d{4}/);
          if (match) return match[0];
        }

        return null;
      });

      if (telefone) {
        const tel = formatarTelefone(telefone);
        if (tel) {
          if (_numerosJaUsados.has(tel)) {
            _onLog(`   🔄 ${d.nome} → ${tel} (já enviado, pulando)`);
          } else {
            leads.push({ nome: d.nome, telefone: tel, cidade, nicho });
            _numerosJaUsados.add(tel);
            _onLog(`   ✅ ${d.nome} → ${tel}`);
          }
        }
      }

      await sleep(500);
    } catch (_) {
      await sleep(500);
    }
  }

  // Volta para a lista após processar todos
  if (leads.length > 0 || alvos.length > 0) {
    await page.goto(urlLista, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    await sleep(2000);
  }

  return leads;
}

/**
 * Scroll até o FIM REAL da lista de resultados do Google Maps.
 * Para quando a altura para de crescer por 3 tentativas consecutivas
 * ou quando a mensagem "chegou ao fim" aparece.
 */
async function scrollAteFim(page) {
  try {
    const scrollSeletores = [
      'div[role="feed"]',
      'div.m6QErb.DxyBCb',
      'div.m6QErb',
    ];

    let container = null;
    for (const sel of scrollSeletores) {
      container = await page.$(sel);
      if (container) break;
    }

    if (!container) return;

    let alturaAnterior = 0;
    let semMudancas = 0;

    for (let i = 0; i < 150; i++) {  // 150 scrolls máximo de segurança
      // Scroll e coleta altura antes de esperar
      await page.evaluate((el) => {
        el.scrollBy(0, 3000);
      }, container);

      await sleep(1500);  // Espera conteúdo carregar

      // Verifica altura e fim DEPOIS de esperar
      const { altura, fim } = await page.evaluate((el) => {
        const body = document.body.textContent;
        const fim = body.includes("chegou ao fim") || body.includes("end of results") || body.includes("No more results");
        return { altura: el.scrollHeight, fim };
      }, container);

      if (fim) break;

      if (altura === alturaAnterior) {
        semMudancas++;
        if (semMudancas >= 3) break;  // 3 scrolls sem mudança = fim real
      } else {
        semMudancas = 0;
      }
      alturaAnterior = altura;
    }
  } catch (_) {}
}

/**
 * Aceitar cookies do Google se aparecer.
 */
async function tentarAceitarCookies(page) {
  try {
    const seletores = [
      'button[aria-label*="Aceitar"]',
      'button[aria-label*="Accept"]',
      'form:nth-child(2) button',
      'button[jsname="higCR"]',
    ];
    for (const sel of seletores) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await sleep(1500);
        break;
      }
    }
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  buscarLeadsMaps,
  cidadesBrasil,
};
