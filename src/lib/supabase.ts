import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[supabase] Missing SUPABASE env vars — conversation storage disabled');
}

// Server-side client using the service role key (bypasses RLS — backend only).
// Never import this into client components.
export const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      })
    : null;

export type ConversationRow = {
  id: string;
  channel: string;
  status: string;
  language: string | null;
  created_at: string;
  last_message_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: unknown | null;
  created_at: string;
};
