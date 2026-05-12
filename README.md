# LeadsFlow AI

> App desktop de prospecção comercial automatizada via WhatsApp Web com IA integrada.

## O que faz

- **Scraping de leads** — busca negócios no Google Maps por nicho/cidade, extrai nome + telefone
- **Envio de mensagens** — envia mensagens personalizadas via WhatsApp Web com delays humanos
- **IA integrada** — scoring de leads, sugestão de nichos, geração de mensagens, chat com IA
- **Piloto automático** — busca + envio em sequência automática
- **Auto-update** — atualiza automaticamente quando nova versão está disponível

## Tech Stack

- **Electron** — desktop app frameless
- **Supabase** — auth + banco de dados cloud
- **NVIDIA GPT-OSS 120b** — IA (via OpenAI SDK)
- **Node.js** — runtime

## Instalação

### Pré-requisitos

- Node.js 18+
- Conta no [Supabase](https://supabase.com)
- API key da [NVIDIA](https://build.nvidia.com)

### Setup

```bash
# Clonar repositório
git clone https://github.com/lostangel67/LeadsFlow-ai.git
cd LeadsFlow-ai

# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais (Supabase + NVIDIA)

# Rodar em modo desenvolvimento
npm run electron
```

### Build para produção

```bash
# Gerar instalador Windows (NSIS)
npm run build

# Output: dist/LeadsFlow-Setup-{version}.exe
```

## Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave anônima do Supabase |
| `NVIDIA_API_KEY` | API key da NVIDIA (GPT-OSS 120b) |

## Estrutura

```
├── electron/
│   ├── main.js          # Processo principal Electron
│   └── preload.js       # Bridge IPC
├── renderer/
│   ├── index.html       # UI principal
│   ├── app.js           # Lógica da UI
│   ├── login.html/js    # Tela de login
│   └── styles.css       # Estilos
├── src/
│   ├── services/
│   │   ├── aiService.js         # Integração IA (NVIDIA)
│   │   ├── dbService.js         # Camada Supabase
│   │   └── leadScoringService.js # Scoring batch
│   ├── utils/
│   │   ├── mensagens.js         # Templates de mensagens
│   │   ├── phoneFormatter.js    # Formatação telefone BR
│   │   └── delay.js             # Delays inteligentes
│   └── bot/                     # Legado (standalone Puppeteer)
├── build/
│   └── icon.ico
├── .github/workflows/release.yml  # CI/CD (GitHub Actions)
└── package.json
```

## Funcionalidades

- Autenticação (email/senha, Google OAuth, lembrar conta)
- Busca leads via Google Maps embutido (BrowserView)
- Envio WhatsApp com agendamento (horário, pausa almoço, rate limit)
- Chat IA com contexto do usuário
- Chat Observer (monitora conversas, sugere respostas)
- Auto-configuração por IA
- Scoring de leads por IA
- Geração de mensagens por IA
- Workflow dashboard estilo n8n
- Design light + purple (macOS aesthetic)
- Auto-update via GitHub Releases

## Auto-update

O app verifica atualizações automaticamente no startup. Quando uma nova versão está disponível:
- Download automático em background
- Notificação na tela
- Usuário pode reiniciar agora ou deixar instalar ao fechar

Para lançar uma atualização:
```bash
# Atualizar versão no package.json, depois:
git add .
git commit -m "v2.1.0: descrição da mudança"
git tag v2.1.0
git push origin main --tags
# GitHub Actions builda e publica automaticamente
```

## Licença

MIT
