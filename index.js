/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║              LeadsFlow — Sistema Principal           ║
 * ║                                                         ║
 * ║  Automação de prospecção via WhatsApp Web               ║
 * ║  • Busca leads no Google Maps                           ║
 * ║  • Extrai nome e telefone                               ║
 * ║  • Envia mensagens no WhatsApp com simulação humana     ║
 * ║  • Anti-duplicação e controle de limites                ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const { buscarLeadsMaps } = require("./src/bot/maps");
const { iniciarCampanhaWhatsApp } = require("./src/bot/whatsapp");
const {
  adicionarLeads,
  obterLeadsNaoContatados,
  obterEstatisticas,
} = require("./src/services/leadService");
const config = require("./config");
const logger = require("./src/utils/logger");

const exibirMenuInterativo = require("./src/utils/menu");

// ===== ARGUMENTOS DE LINHA DE COMANDO =====
const args = process.argv.slice(2);
let APENAS_BUSCAR = args.includes("--apenas-buscar");
let APENAS_ENVIAR = args.includes("--apenas-enviar");

/**
 * Fluxo principal do sistema.
 */
async function main() {
  // Se não foi passado nenhum argumento, mostra o menu interativo
  if (args.length === 0) {
    let opcaoValida = false;
    while (!opcaoValida) {
      const opcao = await exibirMenuInterativo();
      
      if (opcao === "1") {
        APENAS_BUSCAR = true;
        opcaoValida = true;
      } else if (opcao === "2") {
        APENAS_ENVIAR = true;
        opcaoValida = true;
      } else if (opcao === "3") {
        // Busca + Envio (Default)
        opcaoValida = true;
      } else if (opcao === "4") {
        console.log("\n👋 Saindo do sistema...\n");
        process.exit(0);
      } else {
        console.log("\n⚠️  Opção inválida! Tente novamente.");
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    console.clear();
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                   LeadsFlow v1.0                        ║
║                Prospecção Automatizada                   ║
╚══════════════════════════════════════════════════════════╝
  `);

  console.log("⚙️  Configuração carregada:");
  console.log(`   📌 Nicho: ${config.nicho}`);
  console.log(`   🏙️  Modo: ${config.modo === "brasil" ? "Brasil inteiro" : config.cidade}`);
  console.log(`   ⏱️  Delay: ${config.delay_min}s — ${config.delay_max}s`);
  console.log(`   🔒 Limite diário: ${config.limite_diario}`);
  console.log(`   📂 Log: ${logger.LOG_FILE}`);

  logger.info("=== LeadsFlow iniciado ===");
  logger.info(`Nicho: ${config.nicho} | Modo: ${config.modo} | Limite: ${config.limite_diario}`);

  if (APENAS_BUSCAR) {
    console.log("\n🔍 Modo: APENAS BUSCA (sem envio de mensagens)\n");
    logger.info("Modo: APENAS BUSCA");
  } else if (APENAS_ENVIAR) {
    console.log("\n📤 Modo: APENAS ENVIO (sem busca de leads)\n");
    logger.info("Modo: APENAS ENVIO");
  } else {
    console.log("\n🚀 Modo: COMPLETO (busca + envio)\n");
    logger.info("Modo: COMPLETO");
  }

  // Mostra estatísticas iniciais
  const statsInicio = obterEstatisticas();
  console.log("📊 Estatísticas atuais:");
  console.log(`   📋 Total de leads: ${statsInicio.total}`);
  console.log(`   ✅ Contatados: ${statsInicio.contatados}`);
  console.log(`   ⏳ Pendentes: ${statsInicio.pendentes}`);
  console.log("");

  let novosLeads = 0;

  // ===== ETAPA 1: BUSCA DE LEADS =====
  if (!APENAS_ENVIAR) {
    console.log("━".repeat(60));
    console.log("  ETAPA 1: BUSCA DE LEADS NO GOOGLE MAPS");
    console.log("━".repeat(60));

    try {
      const leadsEncontrados = await buscarLeadsMaps(config);

      if (leadsEncontrados.length > 0) {
        console.log(`\n📥 Salvando ${leadsEncontrados.length} leads encontrados...`);
        const resultado = adicionarLeads(leadsEncontrados);
        novosLeads = resultado.adicionados;
        console.log(`\n✅ Busca finalizada!`);
        console.log(`   ➕ Novos: ${resultado.adicionados}`);
        console.log(`   🔄 Duplicados: ${resultado.duplicados}`);
        console.log(`   📋 Total no banco: ${resultado.total}`);
        logger.info(`Busca: ${resultado.adicionados} novos | ${resultado.duplicados} duplicados | ${resultado.total} total`);
      } else {
        console.log("\n⚠️  Nenhum lead encontrado na busca.");
        logger.aviso("Busca: nenhum lead encontrado");
      }
    } catch (erroBusca) {
      console.error("\n❌ Erro na etapa de busca:", erroBusca.message);
      logger.erro(`Erro busca: ${erroBusca.message}`);
      console.log("   Continuando para a etapa de envio...\n");
    }
  }

  // Pausa entre busca e envio
  if (!APENAS_BUSCAR && !APENAS_ENVIAR) {
    console.log("\n⏳ Pausa de 5 segundos entre busca e envio...\n");
    await new Promise((r) => setTimeout(r, 5000));
  }

  let enviados = 0;
  let errosEnvio = 0;

  // ===== ETAPA 2: ENVIO DE MENSAGENS =====
  if (!APENAS_BUSCAR) {
    console.log("━".repeat(60));
    console.log("  ETAPA 2: ENVIO DE MENSAGENS VIA WHATSAPP");
    console.log("━".repeat(60));

    // Obtém leads não contatados
    const leadsParaEnvio = obterLeadsNaoContatados(config.limite_diario);

    if (leadsParaEnvio.length === 0) {
      console.log("\n⚠️  Nenhum lead pendente para envio.");
      console.log("   Todos os leads já foram contatados ou o banco está vazio.");
      logger.aviso("Envio: nenhum lead pendente");
    } else {
      console.log(`\n📋 ${leadsParaEnvio.length} leads pendentes para envio`);

      try {
        const resultado = await iniciarCampanhaWhatsApp(leadsParaEnvio, config);
        enviados = resultado.enviados;
        errosEnvio = resultado.erros;
        console.log("\n🏁 Campanha finalizada!");
        console.log(`   ✅ Mensagens enviadas: ${resultado.enviados}`);
        console.log(`   ❌ Erros: ${resultado.erros}`);
      } catch (erroEnvio) {
        console.error("\n❌ Erro na etapa de envio:", erroEnvio.message);
        logger.erro(`Erro envio: ${erroEnvio.message}`);
      }
    }
  }

  // ===== RESUMO FINAL =====
  const statsFinal = obterEstatisticas();
  console.log("\n" + "═".repeat(60));
  console.log("  📊 RESUMO FINAL");
  console.log("═".repeat(60));
  console.log(`   📋 Total de leads: ${statsFinal.total}`);
  console.log(`   ✅ Contatados: ${statsFinal.contatados}`);
  console.log(`   ⏳ Pendentes: ${statsFinal.pendentes}`);
  console.log("═".repeat(60));
  console.log("\n🎯 LeadsFlow encerrado com sucesso!\n");

  // Salva resumo no log
  logger.salvarResumo({
    total: statsFinal.total,
    novos: novosLeads,
    enviados,
    erros: errosEnvio,
    pendentes: statsFinal.pendentes,
  });

  logger.info("=== LeadsFlow encerrado ===");

  // Segura a tela no final para o usuário ler as métricas
  if (args.length === 0) {
    console.log("\n(Pressione Enter para sair da aplicação)");
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(r => rl.question('', r));
    rl.close();
  }
}

// ===== EXECUÇÃO =====
main().catch((erro) => {
  console.error("\n💥 ERRO FATAL:", erro.message);
  console.error(erro.stack);
  logger.erro(`ERRO FATAL: ${erro.message}\n${erro.stack}`);
  
  console.log("\n(Pressione Enter para fechar)");
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', () => { process.exit(1); });
});
