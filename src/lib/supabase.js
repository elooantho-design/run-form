import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
console.log("URL =", import.meta.env.VITE_SUPABASE_URL);
console.log("ANON PREFIX =", (import.meta.env.VITE_SUPABASE_ANON_KEY || "").slice(0, 25));