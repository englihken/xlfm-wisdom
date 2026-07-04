// src/lib/whatsapp.ts
// WhatsApp Cloud API channel helpers. Deliberately dormant-safe: with NO Meta
// credentials in the environment (the center is still provisioning its number +
// Business account), isWhatsAppConfigured() is false, sends are simulated, and the
// whole inbound pipeline can still be exercised end-to-end via simulated webhook
// payloads. Flip live later by adding three env vars — no code change.
//
//   WHATSAPP_VERIFY_TOKEN   — webhook GET handshake (used by the route)
//   WHATSAPP_ACCESS_TOKEN   — Bearer token for the Graph API
//   WHATSAPP_PHONE_NUMBER_ID — the sending number's id in the Graph path

const GRAPH_VERSION = 'v21.0';

// All three present → the channel can talk to Meta. Any missing → dormant.
export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_VERIFY_TOKEN &&
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

export type SendResult = { simulated?: boolean; ok?: boolean; error?: string };

// Send a plain-text WhatsApp message. When not configured, no network call is
// made — we log and return { simulated: true } so the pipeline is fully testable
// in simulation. Never throws.
export async function sendWhatsAppText(waId: string, text: string): Promise<SendResult> {
  if (!isWhatsAppConfigured()) {
    console.log('[wa] send skipped (not configured)');
    return { simulated: true };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: waId,
          type: 'text',
          text: { body: text },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[wa] send failed ${res.status}:`, errText);
      return { ok: false, error: errText };
    }
    return { ok: true };
  } catch (e) {
    console.error('[wa] send threw:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Markdown → WhatsApp formatting ────────────────────────────────────────────
// Our replies come back as the same warm markdown the web UI renders (see
// assistant-message.tsx): `**bold**`, `> ` blockquotes that become the gold
// 师父开示 card, headings, bullets, `---` rules. WhatsApp has a much smaller
// formatting vocabulary (*bold* _italic_ ~strike~, no headings, no blockquotes),
// so convert rather than dump raw markdown at the user.
//
// The one thing we must preserve loudly is verbatim Master Lu quotes: our `> `
// blockquotes carry his exact words, so each becomes a clearly marked
//   🪷 师父开示：
//   "…quote…"
//   —
// block so the user can always tell his original words from paraphrase.
export function formatForWhatsApp(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    // Gather a run of consecutive blockquote lines (`>` optionally + space) into
    // one 师父开示 block.
    if (/^\s*>\s?/.test(lines[i])) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      let quote = quoteLines.join('\n').trim();
      // The retrieved originals are often already wrapped in quotes — strip any
      // wrapping quote chars so we wrap exactly once.
      quote = quote.replace(/^["“”]+/, '').replace(/["“”]+$/, '').trim();
      if (quote) {
        out.push('🪷 师父开示：');
        out.push(`"${quote}"`);
        out.push('—');
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }

  let text = out.join('\n');

  // Headings → a bold line (WhatsApp has no headings).
  text = text.replace(/^#{1,6}\s*(.+?)\s*$/gm, '*$1*');
  // Horizontal rules (---, ***, ___) → drop entirely.
  text = text.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');
  // Bold: markdown **x** → WhatsApp *x*.
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Bullets: leading - or * → • (leave already-formatted single * bold alone —
  // bullets require the trailing space).
  text = text.replace(/^\s*[-*]\s+/gm, '• ');
  // Inline code `x` → x (WhatsApp single backticks aren't monospace).
  text = text.replace(/`([^`]+)`/g, '$1');
  // Strip citation markers cleanly: 【参考 3】-style tags and [1] / [^1] footnotes.
  text = text.replace(/【[^】]*参考[^】]*】/g, '');
  text = text.replace(/\[\^?\d+\]/g, '');
  // Tidy whitespace: no trailing spaces, collapse 3+ blank lines to 2.
  text = text.replace(/[ \t]+$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
