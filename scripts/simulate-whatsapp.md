# Simulating the WhatsApp channel (no live Meta credentials needed)

The WhatsApp webhook at `/api/webhooks/whatsapp` runs the full inbound pipeline —
find-or-create contact, conversation windowing, dedup, RAG reply, persistence,
classification — **without** any Meta credentials. When
`WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`
are absent, outbound sends are **simulated**: the server logs
`[wa] send skipped (not configured)` instead of calling Graph, so you can exercise
everything end-to-end from your terminal.

These commands POST realistic Meta-format payloads. Watch the **dev server console**
for the `[wa] …` logs and the reply text, and check the dashboard (`/dashboard`) —
a `whatsapp` (✆) conversation from **测试师兄** should appear and grow.

## Setup

Start the app first:

```powershell
npm run dev
```

Pick your target (local dev, or prod once deployed):

```powershell
# Local
$Url = "http://localhost:3000/api/webhooks/whatsapp"

# Production (swap in your domain)
# $Url = "https://YOUR-DOMAIN.vercel.app/api/webhooks/whatsapp"
```

All four scenarios use the same sender: wa_id `60123456789`, profile name `测试师兄`.

> Note: the pipeline calls Claude + Pinecone, so each text scenario takes a few
> seconds to return. The HTTP response is always `{"ok":true}` (200) — the reply
> itself goes out via WhatsApp (simulated), so read the **server console** to see it.

---

## (1) First text from a NEW wa_id

Creates a new `whatsapp` contact (测试师兄) + a new conversation, stores the user
message with its `wa_message_id`, generates a reply, and (simulated) sends it.

```powershell
$body1 = @'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "60312345678", "phone_number_id": "PHONE_NUMBER_ID" },
        "contacts": [{ "profile": { "name": "测试师兄" }, "wa_id": "60123456789" }],
        "messages": [{
          "from": "60123456789",
          "id": "wamid.TEST0001",
          "timestamp": "1720000000",
          "type": "text",
          "text": { "body": "师兄您好，我最近和先生吵架吵得很凶，心里很乱，该怎么办？" }
        }]
      }
    }]
  }]
}
'@
Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $body1 | Select-Object -Expand Content
```

**Expected:** `{"ok":true}`. Server logs show a reply being generated and
`[wa] send skipped (not configured)`. Dashboard shows a new ✆ conversation from
**测试师兄** with a user message + an AI reply, and (after the post-reply pass) a
category such as `感情婚姻`.

---

## (2) Follow-up in the SAME 24h window

Same wa_id, a **new** message id, sent right after (1). No new contact and **no new
conversation** — it appends to the existing open conversation (reused because its
`last_message_at` is within 24h and status ≠ `closed`). The reply now has the prior
turn as context.

```powershell
$body2 = @'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "60312345678", "phone_number_id": "PHONE_NUMBER_ID" },
        "contacts": [{ "profile": { "name": "测试师兄" }, "wa_id": "60123456789" }],
        "messages": [{
          "from": "60123456789",
          "id": "wamid.TEST0002",
          "timestamp": "1720000060",
          "type": "text",
          "text": { "body": "谢谢师兄。那我可以念什么经来化解我们之间的冤结呢？" }
        }]
      }
    }]
  }]
}
'@
Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $body2 | Select-Object -Expand Content
```

**Expected:** `{"ok":true}`. Dashboard: the **same** conversation now has four
messages (two user, two AI) — no second conversation row appears.

---

## (3) Duplicate of message (1) — proves dedup

Re-send the **exact** payload from (1), reusing `wamid.TEST0001` (this is what Meta
does on retry). The webhook detects the already-stored `wa_message_id` and skips the
whole pipeline — no duplicate message, no second reply.

```powershell
Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $body1 | Select-Object -Expand Content
```

**Expected:** `{"ok":true}`. Server logs `[wa] duplicate message wamid.TEST0001 —
skipping`. Dashboard is **unchanged** (no extra user message, no extra AI reply,
no new conversation). No Claude/Pinecone call is made.

---

## (4) Non-text (image) message

An image-type inbound. No pipeline runs; the user gets the gentle text-only nudge
(simulated send).

```powershell
$body4 = @'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "60312345678", "phone_number_id": "PHONE_NUMBER_ID" },
        "contacts": [{ "profile": { "name": "测试师兄" }, "wa_id": "60123456789" }],
        "messages": [{
          "from": "60123456789",
          "id": "wamid.TEST0004",
          "timestamp": "1720000120",
          "type": "image",
          "image": { "id": "MEDIA_ID", "mime_type": "image/jpeg", "sha256": "abc", "caption": "" }
        }]
      }
    }]
  }]
}
'@
Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $body4 | Select-Object -Expand Content
```

**Expected:** `{"ok":true}`. Server logs `[wa] send skipped (not configured)` for
the nudge `目前我只能阅读文字消息，请用文字告诉我您想聊的 🙏`. Nothing is
persisted for this message; the dashboard conversation is unchanged.

---

## Bonus: status receipt (sent / delivered / read)

Meta also posts delivery statuses. These are logged and accepted (stored later):

```powershell
$bodyStatus = @'
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "60312345678", "phone_number_id": "PHONE_NUMBER_ID" },
        "statuses": [{
          "id": "wamid.TEST0001",
          "status": "delivered",
          "timestamp": "1720000130",
          "recipient_id": "60123456789"
        }]
      }
    }]
  }]
}
'@
Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $bodyStatus | Select-Object -Expand Content
```

**Expected:** `{"ok":true}`. Server logs `[wa] status delivered for message
wamid.TEST0001`. No dashboard change.

---

## Bonus: verification handshake (GET)

Once `WHATSAPP_VERIFY_TOKEN` is set, Meta calls GET to verify the webhook. Simulate it:

```powershell
# With WHATSAPP_VERIFY_TOKEN=my-secret in the environment:
Invoke-WebRequest -Uri "$($Url)?hub.mode=subscribe&hub.verify_token=my-secret&hub.challenge=CHALLENGE123" |
  Select-Object -Expand Content
```

**Expected:** the body is exactly `CHALLENGE123` with HTTP 200. A wrong/absent
token returns 403.

---

## Going live later (no code change)

Add these env vars in Vercel and redeploy — the channel flips from simulated to real:

```
WHATSAPP_VERIFY_TOKEN=<the token you enter in Meta's webhook config>
WHATSAPP_ACCESS_TOKEN=<permanent system-user token>
WHATSAPP_PHONE_NUMBER_ID=<the number's id from Meta>
```

Then point Meta's webhook at `https://YOUR-DOMAIN/api/webhooks/whatsapp` and
subscribe to the `messages` field. **Before go-live, run
`migrations/010_wa_message_id.sql`** in Supabase so inbound dedup has its column +
unique index.
```
