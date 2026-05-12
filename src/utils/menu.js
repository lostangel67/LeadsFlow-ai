const readline = require('readline');

/**
 * Cria uma interface interativa no terminal
 */
function exibirMenuInterativo() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.clear();
    console.log(`
=========================================================
      🤖 PAINEL DE CONTROLE - LEADSFLOW 🤖
=========================================================

  Selecione a ação que deseja executar:

  [ 1 ] 🔍 Apenas Buscar Leads no Google Maps
  [ 2 ] 📤 Apenas Enviar Mensagens (WhatsApp)
  [ 3 ] 🚀 Executar Completo (Buscar + Enviar)
  [ 4 ] ❌ Sair

=========================================================
`);

    rl.question('👉 Digite o número da opção desejada: ', (resposta) => {
      rl.close();
      resolve(resposta.trim());
    });
  });
}

module.exports = exibirMenuInterativo;
