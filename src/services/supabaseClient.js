/**
 * LeadsFlow — Supabase Client
 * Singleton client para conexão com Supabase.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

let client = null;

function getSupabase() {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios no .env");
    }
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

module.exports = { getSupabase };
