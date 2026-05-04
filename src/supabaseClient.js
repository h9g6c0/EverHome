import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://hxnxgioyplbhxregerxi.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4bnhnaW95cGxiaHhyZWdlcnhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDEzNTEsImV4cCI6MjA5MzAxNzM1MX0.fOhdFzt14hYK4RXcVQ_OydddQuRJWAg7ldWlhdLliFM";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

