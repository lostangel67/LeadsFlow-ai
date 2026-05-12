# LeadsFlow — Contexto do Projeto

## REGRA OBRIGATÓRIA

**Ao final de QUALQUER ação, alteração ou decisão técnica neste projeto, ATUALIZE este context.md.**
Adicione, remova ou modifique seções conforme necessário para manter este arquivo sempre preciso e atualizado.
Isso inclui: mudanças de arquivos, novas features, fixes, mudanças de arquitetura, dependências, observações, etc.
Se algo mudou no projeto e não está refletido aqui, este arquivo perdeu seu propósito.

## O que é

App desktop (Electron) de prospecção comercial automatizada via WhatsApp Web. Dois fluxos principais:

1. **Scraping de leads** — busca negócios no Google Maps por nicho/cidade, extrai nome + telefone
2. **Envio de mensagens** — envia mensagens personalizadas via WhatsApp Web com delays humanos

## Tech Stack

- **Electron** — desktop app frameless
- **Puppeteer** — automação browser (legado standalone)
- **Supabase** — auth (email/senha, Google OAuth) + banco de dados cloud
- **NVIDIA GPT-OSS 120b** — IA para scoring de leads, sugestão de nichos, geração de mensagens, chat (via NVIDIA API, modelo `openai/gpt-oss-120b`)
- **OpenAI SDK** — cliente pra API da NVIDIA
- **Node.js** — runtime

## Estrutura de Arquivos

```
electron/
  main.js              ← Processo principal (1273 linhas). TUDO roda aqui.
  preload.js           ← Bridge IPC ↔ renderer

renderer/
  index.html           ← UI principal
  app.js               ← Lógica da UI
  login.html/js        ← Tela de login
  styles.css/login.css ← Estilos

src/
  bot/
    whatsapp.js        ← Envio via Puppeteer standalone (legado, não usado no Electron)
    maps.js            ← Scraping via Puppeteer standalone (legado, não usado no Electron)
  services/
    dbService.js       ← Camada principal de dados (Supabase). Usada pelo Electron.
    supabaseService.js ← Camada alternativa (não usada no main)
    supabaseClient.js  ← Singleton Supabase
    leadService.js     ← Persistência local JSON (legado)
    aiService.js       ← Integração NVIDIA GPT-OSS 120b (scoring, nichos, mensagens, chat)
    leadScoringService.js ← Avaliação batch de leads via IA
  config/
    supabase.js        ← Lê SUPABASE_URL e SUPABASE_ANON_KEY do .env
  utils/
    delay.js           ← Delays inteligentes (humano, digitação)
    logger.js          ← Logger
    menu.js            ← Menu terminal (legado)
    mensagens.js       ← Templates de mensagens + escolherMensagemIA
    phoneFormatter.js  ← Formatação de telefone BR (+55...)
  data/
    leads.json         ← Leads locais (legado)
    enviados.json      ← Enviados local (legado)
    invalidos.json     ← Inválidos local (legado)
    lead_lists.json    ← Listas local (legado)
```

## Banco de Dados (Supabase)

Tabelas:
- `user_config` — config por usuário (JSONB: nicho, produto, delays, etc.)
- `user_mensagens` — templates de mensagens do usuário
- `lead_lists` — listas de leads (multi-lista por usuário)
- `leads` — leads (nome, telefone, cidade, nicho, score, contatado, list_id)
- `telefones_enviados` — histórico permanente de envios (nunca repete)
- `telefones_invalidos` — números inválidos permanentes
- `chat_sessions` — sessões de chat com IA
- `chat_messages` — mensagens do chat com IA

Isolamento: tudo filtrado por `user_id` (multi-usuário).

## Fluxos Principais

### Autenticação
Login window → Supabase Auth → se sessão existe → janela principal. Senão → login.

### Busca de Leads (Google Maps)
1. Abre Google Maps dentro do Electron (BrowserView) — invisível, roda em background
2. Dashboard de workflow mostra progresso visual em tempo real (estilo n8n)
3. Busca "{nicho} em {cidade}" para cada combinação
4. Scroll até fim da lista → batch extract (nome, telefone, href)
4. Cards sem telefone: navega via href pra buscar telefone na página do estabelecimento
5. Salva leads no Supabase, deduplica contra enviados/inválidos/existentes

### Envio de Mensagens (WhatsApp Web)
1. Abre WhatsApp Web dentro do Electron (BrowserView)
2. Pra cada lead: navega pra `web.whatsapp.com/send?phone={numero}`
3. Verifica número inválido → registra em `telefones_invalidos`, pula delay
4. Digita mensagem (template aleatório ou IA) → clica enviar
5. Delay humano entre envios (35-85s padrão), limite diário configurável

### Piloto Automático
Combina busca + envio: busca leads → filtra por IA (opcional) → envia mensagens.

### Chat com IA
Chat livre no app. IA conhece config do usuário (produto, nicho, stats). Contexto compartilhado com scoring e geração de mensagens.

### Agendamento de Campanha
Envio respeita horário configurável:
- **Horário de funcionamento**: início/fim (ex: 09:00–18:00)
- **Pausa para almoço**: início/fim (ex: 12:00–13:00)
- **Dias da semana**: checkboxes Seg–Dom (JS day: 0=Dom, 1=Seg…6=Sáb)
- **Rate limit**: máximo de envios por hora (1–30)
- Config salva como JSONB no `user_config` (campos: schedule_enabled, schedule_start, schedule_end, schedule_lunch_start, schedule_lunch_end, schedule_days, max_per_hour)
- `isWithinSchedule(config)` no main.js verifica se está dentro do horário antes de cada envio
- Se fora do horário, campanha retorna `{ waiting: true }` e loga aviso

### AI Chat Observer (Assistente de Conversa)
Assistente IA passivo que monitora conversas no WhatsApp Web em tempo real:
- Polling a cada 5s via `extractCurrentChat(wc)` — extrai mensagens do DOM do WhatsApp Web
- Detecção de mudança: compara texto da última mensagem com snapshot anterior
- Se mudou → `analyzeAndSuggest(messages, context)` via NVIDIA GPT-OSS 120b
- Retorna JSON: `{ intent, analysis, suggestion }`
- Sugestão aparece como overlay flutuante no painel WhatsApp (não interfere na conversa)
- Usuário pode copiar sugestão, dispensar, ou fechar o observer
- Toggle on/off via checkbox no overlay
- IPC: `ai-observer-toggle`, `ai-observer-status`, `ai-observer-refresh`, event `ai-observer-update`
- Arquivo: `src/services/chatObserverService.js`

### Auto-Configuração por IA
Configuração automática de todo o programa baseada no nicho, produto e objetivo atual do usuário:
- Usuário descreve produto e objetivo na aba IA → clica "Configurar com IA" na aba Configurações
- IA analisa nicho + produto + objetivo → retorna JSON com config completa (delays, limites, horários, tom, score)
- Campos preenchidos automaticamente no formulário
- Justificativa das escolhas exibida ao usuário
- IPC: `ai-auto-config`
- Arquivo: `src/services/aiService.js` (função `autoConfigurar`)

### Sync entre abas IA e Configurações
- Abas compartilham campos de IA (cfg-ai-produto, cfg-ai-objetivo, cfg-ai-tom, cfg-ai-enabled, cfg-ai-min-score)
- Salvar na aba IA → recarrega config na aba Configurações via `loadConfig()`

### Onboarding (Primeiro Acesso)
- Campo `first_run: true` nos defaults de config
- Na primeira abertura, overlay full-screen aparece com boas-vindas
- Botão "Começar a Usar" → vai pra aba IA, texto do botão salvar muda para "Começar a Usar"
- Usuário preenche produto, clica salvar → `first_run: false`, vai pro dashboard
- Próximas aberturas: onboarding não aparece mais

## Contexto Compartilhado da IA

A IA (NVIDIA GPT-OSS 120b) é usada em 7 pontos:
1. **Chat** — recebe config do usuário (produto, objetivo, nicho, nichos, tom, stats) no system prompt
2. **Scoring de leads** — recebe produto + contexto das últimas 10 msgs do chat
3. **Geração de mensagens** — recebe produto + objetivo + tom + contexto do chat
4. **Sugestão de nichos** — recebe descrição do produto
5. **Chat Observer** — analisa conversas em tempo real no WhatsApp Web, sugere respostas (recebe produto, nicho, tom, objetivo)
6. **Auto-Configuração** — analisa nicho + produto + objetivo e configura delays, limites, horários, tom, score automaticamente
7. **Gerar mensagens com IA** — gera templates de mensagem baseados no produto/nicho/tom/objetivo do usuário (aba Mensagens)

Fluxo de contexto: config do usuário (produto, objetivo) → chat IA → últimas 10 mensagens → scoring/mensagens.

## Anti-detecção

- User agent customizado (Chrome 124)
- Remove flag `navigator.webdriver`
- Delays humanos entre ações
- Digitação caractere por caractere
- Janela com dimensões realistas (1366x768)

## Design Visual (Light + Purple)

Tema claro com acento roxo. Arquivos alterados:

### renderer/styles.css — tema light + purple
- **Tokens**: accent purple (#7C3AED), backgrounds brancos (#ffffff, #f8f8fa, #f0f0f5), text #1a1a1e/#6e6e73/#a1a1a6
- **Glass effect**: `backdrop-filter: blur(20px) saturate(180%)` em sidebar, titlebar, statusbar, toast, modal
- **Sidebar**: fundo semi-transparente branco com vibrancy
- **Cards**: bg branco, radius 10px, hover com box-shadow sutil
- **Inputs/Buttons**: accent purple, focus ring roxo, radius 6px
- **Scrollbar**: thumb escuro sobre fundo claro
- **Animações**: 0.2s ease-out em transições, panelIn com opacity+translateY

### renderer/index.html — titlebar
- **Traffic lights** (vermelho/amarelo/verde) no canto esquerdo da titlebar
- Botões com SVGs de close/minimize/maximize que aparecem no hover
- Titlebar padding-left ajustado para 78px (espaço para traffic lights)
- Controles antigos (.titlebar-controls) hidden via CSS

### renderer/login.css — tema light + purple
- Glass-morphism card com backdrop-filter
- Accent purple (#7C3AED)
- Background com 3 radial gradients sutis (roxos)
- Borders, radius, shadows seguindo padrão claro

## Observações

- `src/bot/*.js` são versões Puppeteer standalone (legado). Electron roda tudo embutido via BrowserView.
- `src/services/supabaseService.js` é camada alternativa não usada pelo main. `dbService.js` é a principal.
- **Credenciais em `.env`**: NVIDIA_API_KEY (GPT-OSS 120b), SUPABASE_URL, SUPABASE_ANON_KEY. Nunca hardcoded. `.env.example` como referência.
- Dados locais em `src/data/*.json` são legado. Tudo persiste no Supabase agora.
- `electron/main.js` é monolítico: views, IPC, scraping, envio, piloto, auth — tudo num arquivo.
- Config é um único JSONB no Supabase. Salvar em qualquer aba deve fazer merge, não overwrite.
- **Lembrar conta**: sessão Supabase salva em `{userData}/session.json` (access_token, refresh_token). Checkbox "Lembrar minha conta" no login. Auto-restaura no startup via `setSession()`. Logout limpa arquivo.
- **Retry**: `src/utils/withRetry.js` — wrapper genérico com backoff exponencial. Usado em chamadas críticas do dbService (loadConfig, marcarComoContatado, registrarInvalido, adicionarLeads insert) e todas as chamadas da API de IA.
- **Validação IPC**: handlers principais validam input antes de processar (config, mensagens, auth, chat, leads).
- **Puppeteer**: movido para devDependencies. Não entra no bundle do Electron.
- **Queries otimizadas**: carregarSessoes faz batch de mensagens (1 query em vez de N). obterEstatisticas roda 4 counts em paralelo. delete/reset lead usam query direta. ehInvalido no envio usa batch (obterTodosInvalidos).
- **Scoring progress**: onProgress em avaliarLeads emite nome do lead atual via emitLog/emitStatus.
- **Chat Observer**: `src/services/chatObserverService.js` — polling 5s no DOM do WhatsApp Web, extrai mensagens, analisa via IA, emite sugestões via IPC `ai-observer-update`. Overlay flutuante no renderer.
- **Workflow Dashboard**: painel de scraping substitui visual do Google Maps por dashboard estilo n8n. 6 nodes (Iniciar, Buscar, Rolar, Extrair, Telefones, Salvo) com estados idle/running/done/error. Eventos IPC `workflow-step` emitidos pelo main.js durante scraping. Renderer atualiza nodes em tempo real. Log expansível mostra eventos detalhados. BrowserView do Maps roda em background (invisível).
- **Gerar mensagens com IA**: botão na aba Mensagens chama `ai-gerar-mensagens` IPC → `gerarMensagensTemplate()` no aiService.js → gera 5 templates via NVIDIA baseado em produto/nicho/tom/objetivo do usuário → append na lista de mensagens.
- **Campo Objetivo Atual** (`cfg-ai-objetivo` / `ai_objetivo`): textarea na aba IA abaixo do produto. Usuário descreve o que quer fazer naquele momento (ex: "prospectar dentistas em SP hoje"). IA usa como contexto no chat, scoring, geração de mensagens, auto-config e chat observer. Diferente do produto (o que vende), objetivo é o que quer fazer agora.
- **Auto-update**: `electron-updater` checa GitHub releases no startup (5s após janela). Download automático. Notifica renderer via IPC `update-status`. Usuário pode clicar "Reinstalar agora" ou deixa instalar ao fechar. NSIS installer obrigatório (portable não suporta).
- **GitHub Actions**: `.github/workflows/release.yml` — trigger em tag `v*`. Builda Windows NSIS, publica release no GitHub automaticamente. Precisa secret `GH_TOKEN` no repo.
- **Build**: target NSIS (installer). `npm run build` gera `dist/LeadsFlow-Setup-{version}.exe`. `build.publish` aponta pro repo GitHub.
- **README**: seção "Download" no topo pro usuário final (só baixar .exe + criar conta). Seção "Para Desenvolvedores" no final com setup Node.js/Supabase/NVIDIA. Usuário final não vê prereqs técnicos.
