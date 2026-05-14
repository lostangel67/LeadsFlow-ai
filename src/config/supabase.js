/**
 * LeadsFlow — Cliente Supabase
 * Singleton. Lê variáveis de ambiente ou usa defaults.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://qezhbusakpgjgrzelvkr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlemhidXNha3BnamdyemVsdmtyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxOTQ0MDYsImV4cCI6MjA5Mzc3MDQwNn0.L-tPeTTlM9SCBOQd7Z46iXJEKQakEXR58-PiuBSaQzA";

let supabase = null;

function getSupabase() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios no .env");
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

module.exports = { getSupabase };
