-- LeadsFlow — Supabase Schema Setup
-- Run this in Supabase SQL Editor (Project > SQL Editor > New Query)

-- ===================== TABLES =====================

CREATE TABLE IF NOT EXISTS user_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  config JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_mensagens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mensagens JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_lists (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL,
  nome TEXT DEFAULT 'Desconhecido',
  telefone TEXT NOT NULL,
  cidade TEXT DEFAULT '',
  nicho TEXT DEFAULT '',
  contatado BOOLEAN DEFAULT false,
  score INTEGER DEFAULT 0,
  data_extracao TIMESTAMPTZ DEFAULT now(),
  data_contato TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leads_user_list ON leads(user_id, list_id);
CREATE INDEX IF NOT EXISTS idx_leads_user_telefone ON leads(user_id, telefone);

CREATE TABLE IF NOT EXISTS telefones_enviados (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  PRIMARY KEY (user_id, telefone)
);

CREATE TABLE IF NOT EXISTS telefones_invalidos (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  PRIMARY KEY (user_id, telefone)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo TEXT DEFAULT 'Nova conversa',
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  time TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, user_id);

-- ===================== ROW LEVEL SECURITY =====================

ALTER TABLE user_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE telefones_enviados ENABLE ROW LEVEL SECURITY;
ALTER TABLE telefones_invalidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Policies: users can only access their own data
CREATE POLICY "user_config_policy" ON user_config FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_mensagens_policy" ON user_mensagens FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lead_lists_policy" ON lead_lists FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "leads_policy" ON leads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "telefones_enviados_policy" ON telefones_enviados FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "telefones_invalidos_policy" ON telefones_invalidos FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_sessions_policy" ON chat_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_messages_policy" ON chat_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
