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
  main.js              ← Processo principal. TUDO roda aqui.
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
1. Abre Google Maps dentro do Electron (BrowserView) — completamente invisível (off-screen)
2. Stepper profissional mostra progresso em tempo real (fases: Init → Busca → Scroll → Extract → Telefones → Salvar)
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

**Bug fix**: race condition de duplo envio resolvida — `chatSending = true` + disable do input/botão acontecem sincronicamente ANTES do primeiro `await`, impedindo cliques duplos rápidos de disparar duas requisições.

### Agendamento de Campanha
Aba dedicada "Agendamento" no sidebar (abaixo de IA). Usuário configura tudo manualmente:
- **Toggle liga/desliga**: `cfg-schedule-enabled` — quando desligado, envios ignoram restrições de horário
- **Horário de funcionamento**: `cfg-schedule-start` / `cfg-schedule-end` (ex: 09:00–18:00)
- **Pausa para almoço**: `cfg-lunch-start` / `cfg-lunch-end` (ex: 12:00–13:00)
- **Dias da semana**: botões `.day-btn` clicáveis (Dom/Seg/Ter/Qua/Qui/Sex/Sáb), JS day: 0=Dom…6=Sáb
- **Delay entre mensagens**: `cfg-delay-min` / `cfg-delay-max` (segundos)
- **Limite diário**: `cfg-limite-diario` (mensagens/dia)
- **Máximo por hora**: `cfg-max-per-hour`
- Auto-save com debounce 1s
- Config salva como JSONB no `user_config` (campos: schedule_enabled, schedule_start, schedule_end, schedule_lunch_start, schedule_lunch_end, schedule_days, delay_min, delay_max, limite_diario, max_per_hour)
- A IA (auto-config) preenche esses campos automaticamente, mas o usuário pode sobrescrever na aba

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
Configuração automática baseada no nicho, cidade, produto e objetivo do usuário:
- Usuário preenche produto e objetivo na aba IA → clica "Configurar com IA"
- IA analisa com sistema de 3 prioridades geográficas:
  - **P1**: se produto/objetivo menciona localização → usa essa, ignora campo cidade
  - **P2**: se campo cidade preenchido → usa ele
  - **P3**: IA sugere melhores cidades para o nicho
- Para estados/regiões (ex: "Maranhão e Piauí"), IA expande para lista de cidades principais
- Retorna JSON com config completa (delays, limites, horários, tom, score, nichos, cidades)
- Config salva automaticamente no Supabase
- UI atualiza campo `cfg-cidade` com cidades recomendadas
- Justificativa das escolhas exibida ao usuário
- IPC: `ai-auto-config` — recebe `{nicho, produto, objetivo, cidade}`, retorna config + salva
- Arquivo: `src/services/aiService.js` (função `autoConfigurar`)
- `max_tokens: 1000` (era 500, truncava JSON antes do `}` final)
- System message força JSON puro sem markdown

### Onboarding (Primeiro Acesso)
- Campo `first_run: true` nos defaults de config
- Na primeira abertura, overlay full-screen aparece com boas-vindas
- Botão "Começar a Usar" → vai pra aba IA
- Usuário preenche produto → auto-save dispara → `first_run: false`, vai pro dashboard
- Próximas aberturas: onboarding não aparece mais

## Estrutura de Abas (Sidebar)

Ordem atual:
1. **Dashboard** — visão geral, piloto automático
2. **Scraping** — busca leads Google Maps
3. **IA** — produto, objetivo, nichos, cidade, score mínimo, configurar com IA
4. **Agendamento** — horários, delays, dias, limites (editável pelo usuário)
5. **Chat IA** — chat livre com contexto do usuário
6. **Mensagens** — tom das mensagens + templates (rotação aleatória)
7. **WhatsApp** — QR Code, observer
8. **Leads** — lista de leads com abas, stats, filtros
9. **Sobre** — descrição do app + guia de uso
10. **Logs** — atividade do sistema em tempo real

## Contexto Compartilhado da IA

A IA (NVIDIA GPT-OSS 120b) é usada em 7 pontos:
1. **Chat** — recebe config do usuário (produto, objetivo, nicho, nichos, tom, stats) no system prompt
2. **Scoring de leads** — recebe produto + contexto das últimas 10 msgs do chat
3. **Geração de mensagens** — recebe produto + objetivo + tom + contexto do chat
4. **Sugestão de nichos** — recebe produto + objetivo + cidade
5. **Chat Observer** — analisa conversas em tempo real no WhatsApp Web, sugere respostas
6. **Auto-Configuração** — analisa nicho + produto + objetivo + cidade e configura tudo automaticamente
7. **Gerar mensagens com IA** — gera 5 templates via botão na aba Mensagens

Fluxo de contexto: config do usuário (produto, objetivo) → chat IA → últimas 10 mensagens → scoring/mensagens.

## Anti-detecção

- User agent customizado (Chrome 124)
- Remove flag `navigator.webdriver`
- Delays humanos entre ações
- Digitação caractere por caractere
- Janela com dimensões realistas (1366x768)

## Design Visual (Dual Theme — Claro padrão / Escuro opcional)

Dois temas: **claro** (padrão) e **escuro** (selecionável). Ambos usam accent verde, Geist/Geist Mono. Tema persiste em `localStorage("leadsflow-theme")` + Supabase config (source of truth). Toggle: ícone sol/lua no canto direito do titlebar.

### Layout — UI Full-Screen sem painéis aninhados

- `.panel { padding: 16px 18px; overflow-y: auto; height: 100%; }` — padding universal
- `.panel-header { display: none !important; }` — títulos de seção removidos
- `.card { background: transparent; border: none; border-radius: 0; }` — cards transparentes
- `.card-header { display: none !important; }` — headers dos cards removidos
- `.card-body { padding: 0; }` — sem padding interno nos cards
- `.cards-grid { grid-template-columns: 1fr; gap: 0; padding: 0; }` — grid colapsado em lista
- `#panel-chat { padding: 0; overflow: hidden; }` — chat tem layout próprio (topbar + messages + input)
- `.panel-actions` — container para botões de ação (abas Leads, Logs) fora do panel-header

### Tema

- **`:root`** = claro: bg branco/cinza, accent `#009E6C`, text dark
- **`body[data-theme="dark"]`** = escuro: bg `#0c0c0e`, accent `#00D982`, text claro
- **`--btn-primary-text`**: `#ffffff` claro / `#000000` escuro
- Fonts: `Geist` (UI) + `Geist Mono` (números, logs, labels)
- Sidebar: `border-left: 2px solid accent` no item ativo
- `body { transition: background/color 0.25s }` para troca suave

### Persistência de Tema

1. `applyTheme(theme)` → seta `data-theme` no body + salva em `localStorage`
2. Ao mudar tema → faz merge e salva `theme` no Supabase config (async, silent)
3. Ao carregar app (`loadConfig`) → se Supabase tem tema diferente do localStorage → sincroniza

### Componentes CSS Específicos

**Toggle Switch** (`.toggle-switch`) — usado no agendamento (liga/desliga):
- Input checkbox hidden, `.toggle-track` + `.toggle-thumb` como visual
- `input:checked` → track vira `var(--accent)`, thumb desloca 18px

**Days Picker** (`.days-picker` + `.day-btn`) — seletor de dias da semana:
- Botões clicáveis que toggle `.active` → `background: var(--accent-dim); border-color: var(--accent)`

**Time Input** — `input[type="time"]` agora incluso nos estilos de `.form-group` (background, border, radius iguais ao text/number). Calendar picker indicator: `filter: invert(0.6)` para combinar com tema escuro.

**Sobre** — `.sobre-container` max-width 680px, logo section, steps com contadores circulares verdes, tips com em-dash:
- `.sobre-steps li` usa `display: flex; gap: 14px` com `::before` (número) + `<div>` (conteúdo)
- IMPORTANTE: conteúdo de cada `<li>` deve estar dentro de um `<div>` filho direto para evitar fragmentação flex

## Aba IA — Campos e Comportamento

Ordem dos campos:
1. Produto/serviço (`cfg-ai-produto`)
2. Objetivo atual (`cfg-ai-objetivo`)
3. Nichos (`cfg-nichos-multi` — textarea, separados por vírgula/newline)
4. Cidade (`cfg-cidade`)
5. Score mínimo do lead (`cfg-ai-min-score` — range 0–100)
6. Botão "Configurar com IA" (alinhado à direita, sem checkbox "Ativar IA")

**IA sempre ativa** — `ai_enabled` hardcoded como `true`. Não existe mais toggle para ligar/desligar IA.

Auto-save com debounce 1500ms em todos os campos via `scheduleIASave()`.

## Aba Mensagens — Campos e Comportamento

Ordem:
1. **Tom das mensagens** (`cfg-ai-tom` — select: Profissional/Casual/Amigável) — auto-save ao mudar
2. **Templates** — lista editável com geração via IA, botão adicionar, botão salvar

## Auto-save

- **Aba IA**: debounce 1500ms — campos: nichos, cidade, produto, objetivo, score
- **Aba Agendamento**: debounce 1000ms — todos os campos de agendamento
- **Tom das mensagens**: save imediato ao `change` event
- **Tema**: save async ao Supabase sempre que muda
- Todos fazem `getConfig()` → merge → `saveConfig()` para não sobrescrever outros campos

## Observações

- `src/bot/*.js` são versões Puppeteer standalone (legado). Electron roda tudo embutido via BrowserView.
- `src/services/supabaseService.js` é camada alternativa não usada pelo main. `dbService.js` é a principal.
- **Credenciais em `.env`**: NVIDIA_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY. Nunca hardcoded.
- Dados locais em `src/data/*.json` são legado. Tudo persiste no Supabase agora.
- `electron/main.js` é monolítico: views, IPC, scraping, envio, piloto, auth — tudo num arquivo.
- Config é um único JSONB no Supabase. Salvar em qualquer aba deve fazer merge, não overwrite.
- **Lembrar conta**: sessão Supabase salva em `{userData}/session.json`. Checkbox "Lembrar minha conta" no login. Auto-restaura no startup via `setSession()`. Logout limpa arquivo.
- **Retry**: `src/utils/withRetry.js` — wrapper genérico com backoff exponencial. Usado em chamadas críticas do dbService e todas as chamadas da API de IA.
- **Validação IPC**: handlers principais validam input antes de processar.
- **Puppeteer**: movido para devDependencies. Não entra no bundle do Electron.
- **Queries otimizadas**: carregarSessoes faz batch de mensagens (1 query em vez de N). obterEstatisticas roda 4 counts em paralelo. ehInvalido no envio usa batch.
- **Scraping otimizado**: phone lookups em batch de 6 paralelos via mini BrowserWindows. Pool de workers: 6. BrowserView do Maps roda off-screen (x: -9999). Speedup estimado: ~10-16x.
- **Chat Observer**: `src/services/chatObserverService.js` — polling 5s no DOM do WhatsApp Web.
- **Workflow UI**: stepper horizontal com 6 fases. Barra de progresso. 3 stat cards. Log expansível.
- **Campo Objetivo Atual** (`cfg-ai-objetivo`): textarea na aba IA. IA usa como contexto em tudo.
- **Auto-update**: `electron-updater` checa GitHub releases no startup (5s). Download automático. NSIS obrigatório.
- **GitHub Actions**: `.github/workflows/release.yml` — trigger em tag `v*`. Builda Windows NSIS.
- **Build**: target NSIS. `npm run build` gera `dist/LeadsFlow-Setup-{version}.exe`.
- **Versão atual**: 0.1.1 (tag `v0.1.1`)
- **Erros amigáveis**: `friendlyError()` em app.js, login.js, main.js, aiService.js. Usuário nunca vê stack trace.
- **Chat focus**: ao navegar para aba Chat IA, textarea recebe focus automático (setTimeout 50ms pós display:flex).
- **Chat double-send**: corrigido — `chatSending = true` + disable UI antes do primeiro `await` na função `chatEnviarMensagem`.
