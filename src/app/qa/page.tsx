// src/app/qa/page.tsx
// 智慧问答 - AI Chatbot Page
// The flagship feature: chat with Master Lu's 47 volumes of teachings

'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { MasterMarkdown, MessageSources, type Source } from '@/components/assistant-message';
import { QUICK_QUESTIONS } from '@/lib/quick-questions';

// Stable per-message ids (09-10 §1): every stream callback addresses ITS
// message by id, never "the last item of the array", so a reply that arrives
// after the visitor started a new conversation can't land in the wrong thread.
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'volunteer';
  content: string;
  sources?: Source[];
  streaming?: boolean;
  // Progress hint while streaming (server `stage` events, 09-10 §4).
  stage?: ReplyStage;
}

type ReplyStage = 'retrieving' | 'drafting' | 'verifying';

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

const TRANSLATIONS = {
  zh: {
    title: '智慧问答',
    subtitle: '说出您的烦恼，这里会帮您找到方向',
    basedOn: '基于卢台长47部著作及官方网站问答存档 · 约500万字开示内容',
    free: '一切完全免费，无需注册',
    placeholder: '请输入您想问的问题...',
    sending: '正在思考...',
    stageRetrieving: '检索台长开示中…',
    stageDrafting: '撰写中…',
    stageVerifying: '核对原文中…',
    quickTitle: '或从这些常见问题开始：',
    sourcesTitle: '参考开示：',
    volunteerLabel: '义工回复 🙏',
    volunteerHandlingNotice: '现在由我们的义工亲自为您回复 🙏',
    welcomeTitle: '欢迎来到 心灵法门 智慧问答',
    welcomePrivacy: '关于您的隐私',
    welcomePrivacy1: '你的对话内容将严格保密，必要时会有义工提供协助。',
    welcomePrivacy2: '不需要注册，没有账号',
    welcomePrivacy3: '无论您说什么，都不会被评判，您可以完全放心地表达',
    welcomeOffer: '这里能帮您什么',
    welcomeOffer1: '基于台长 47 部著作的智慧引导',
    welcomeOffer2: '念经、许愿、放生、化解冤结的修行方法',
    welcomeOffer3: '陪您度过困难时刻',
    welcomeLimit: '这里不替代什么',
    welcomeLimit1: '医生的诊断 \u2192 身体不舒服请看医生',
    welcomeLimit2: '律师的意见 \u2192 法律事务请咨询专业',
    welcomeLimit3: '重大决定 \u2192 人生决定请自己选择',
    welcomeLegalTitle: '🇲🇾 For Non-Muslim Only',
    welcomeLegalBody: '本平台只为非穆斯林群体提供心灵法门指引，尊重马来西亚法律与各宗教信仰。',
    welcomeEmergency: '紧急情况，请拨打：',
    welcomeBtn: '我明白了，开始问答',
    footerLine1: '一切免费结缘 \u00b7 对话严格保密 \u00b7 佛法引导不替代专业意见',
    footerLineLegal: '🇲🇾 For Non-Muslim Only',
    footerLine2: '紧急：',
    footerMental: '心理：',
    footerDV: '家暴：',
  },
  en: {
    title: 'AI Wisdom Q&A',
    subtitle: 'Share your concerns, and we will help you find direction',
    basedOn: "Based on Master Lu's 47 volumes and the official Q&A archives · ~5 million words of teachings",
    free: 'Completely free, no registration required',
    placeholder: 'Type your question...',
    sending: 'Thinking...',
    stageRetrieving: 'Searching Master Lu’s teachings…',
    stageDrafting: 'Writing…',
    stageVerifying: 'Checking against the source texts…',
    quickTitle: 'Or start with these common questions:',
    sourcesTitle: 'References:',
    volunteerLabel: 'Volunteer reply 🙏',
    volunteerHandlingNotice: 'A volunteer is personally replying to you now 🙏',
    welcomeTitle: 'Welcome to Xin Ling Fa Men Wisdom Q&A',
    welcomePrivacy: 'Your Privacy',
    welcomePrivacy1: 'Your conversations are kept strictly confidential. A volunteer may step in to help when needed.',
    welcomePrivacy2: 'No registration, no account',
    welcomePrivacy3: "Whatever you say, you won't be judged — express yourself with complete peace of mind",
    welcomeOffer: 'What We Offer',
    welcomeOffer1: "Guidance from Master Lu's 47 books (~5M words)",
    welcomeOffer2: 'Practice methods: sutra recitation, vows, life release',
    welcomeOffer3: 'Companionship through difficult times',
    welcomeLimit: "What We Don't Replace",
    welcomeLimit1: "Doctor's diagnosis \u2192 See a doctor for health concerns",
    welcomeLimit2: "Lawyer's advice \u2192 Consult a professional for legal matters",
    welcomeLimit3: 'Major decisions \u2192 These are yours to make',
    welcomeLegalTitle: '🇲🇾 For Non-Muslim Only',
    welcomeLegalBody: 'This platform serves non-Muslim audiences only, respecting Malaysian law and all religious beliefs.',
    welcomeEmergency: 'Emergency Resources:',
    welcomeBtn: 'I understand, start Q&A',
    footerLine1: 'Free distribution \u00b7 Strictly confidential \u00b7 Not a substitute for professional advice',
    footerLineLegal: '🇲🇾 For Non-Muslim Only',
    footerLine2: 'Emergency: ',
    footerMental: 'Mental: ',
    footerDV: 'DV: ',
  },
  id: {
    title: 'Tanya Jawab Kebijaksanaan',
    subtitle: 'Ungkapkan keresahan Anda, kami akan membantu menemukan arahan',
    basedOn: 'Berdasarkan 47 volume ajaran Master Lu serta arsip tanya-jawab resmi · ~5 juta kata',
    free: 'Sepenuhnya gratis, tanpa pendaftaran',
    placeholder: 'Ketik pertanyaan Anda...',
    sending: 'Memikirkan...',
    stageRetrieving: 'Mencari ajaran Master Lu…',
    stageDrafting: 'Menulis…',
    stageVerifying: 'Memeriksa teks sumber…',
    quickTitle: 'Atau mulai dengan pertanyaan umum ini:',
    sourcesTitle: 'Referensi:',
    volunteerLabel: 'Balasan sukarelawan 🙏',
    volunteerHandlingNotice: 'Seorang sukarelawan sedang membalas anda secara peribadi 🙏',
    welcomeTitle: 'Selamat Datang ke Xin Ling Fa Men Wisdom Q&A',
    welcomePrivacy: 'Privasi Anda',
    welcomePrivacy1: 'Perbualan anda dirahsiakan sepenuhnya. Sukarelawan mungkin membantu apabila diperlukan.',
    welcomePrivacy2: 'Tiada pendaftaran, tiada akaun',
    welcomePrivacy3: 'Apa pun yang anda katakan, anda tidak akan dihakimi — luahkan dengan tenang sepenuhnya',
    welcomeOffer: 'Apa Kami Tawarkan',
    welcomeOffer1: 'Panduan dari 47 buku Master Lu (~5 juta perkataan)',
    welcomeOffer2: 'Kaedah amalan: bacaan sutra, ikrar, pelepasan hidupan',
    welcomeOffer3: 'Teman dalam masa sukar',
    welcomeLimit: 'Apa Kami Tidak Gantikan',
    welcomeLimit1: 'Diagnosis doktor \u2192 Jumpa doktor untuk kesihatan',
    welcomeLimit2: 'Nasihat peguam \u2192 Rujuk profesional untuk hal undang-undang',
    welcomeLimit3: 'Keputusan besar \u2192 Ini keputusan anda sendiri',
    welcomeLegalTitle: '🇲🇾 For Non-Muslim Only',
    welcomeLegalBody: 'Platform ini hanya melayani audiens non-Muslim, menghormati hukum Malaysia dan semua kepercayaan agama.',
    welcomeEmergency: 'Bantuan Kecemasan:',
    welcomeBtn: 'Saya faham, mulakan Q&A',
    footerLine1: 'Percuma \u00b7 Dirahsiakan \u00b7 Bukan pengganti nasihat profesional',
    footerLineLegal: '🇲🇾 For Non-Muslim Only',
    footerLine2: 'Kecemasan: ',
    footerMental: 'Mental: ',
    footerDV: 'KDRT: ',
  },
};

function isNearBottom(): boolean {
  return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 150;
}

// Same honest wording as the server's failure path (GENERATION_FAILED_REPLY).
function failureText(language: 'zh' | 'en' | 'id'): string {
  return language === 'zh'
    ? '不好意思，系统这会儿有点问题，没能马上回你 🙏 你的问题我们已经记下来了，义工会尽快跟进。如果方便，可以留个联系方式。'
    : language === 'id'
      ? 'Maaf, sistem sedang bermasalah dan belum bisa membalas sekarang 🙏 Pertanyaan Anda sudah kami catat dan relawan akan segera menindaklanjuti. Jika berkenan, tinggalkan kontak Anda.'
      : "Sorry — the system is having a problem right now and could not answer you immediately 🙏 Your question has been recorded and a volunteer will follow up soon. If convenient, please leave a way to contact you.";
}

function stageLabel(t: { stageRetrieving: string; stageDrafting: string; stageVerifying: string; sending: string }, stage?: ReplyStage): string {
  if (stage === 'retrieving') return t.stageRetrieving;
  if (stage === 'drafting') return t.stageDrafting;
  if (stage === 'verifying') return t.stageVerifying;
  return t.sending;
}

export default function QAPage() {
  const [language, setLanguage] = useState<'zh' | 'en' | 'id'>('zh');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [hasSeenWelcome, setHasSeenWelcome] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // True while a human volunteer is personally handling this conversation (drives
  // the honest indicator under the input). Set by the SSE handover event and by the
  // updates poll.
  const [volunteerHandling, setVolunteerHandling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasAtBottomRef = useRef(true);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);
  const browserIdRef = useRef<string | null>(null);
  // Cursor of the newest reply we've already shown — (created_at, id) so two
  // rows with the same timestamp can't be skipped or re-shown. Null until the
  // conversation exists (then seeded to "now").
  const afterRef = useRef<{ createdAt: string; id: string | null } | null>(null);
  // The in-flight turn: its AbortController and requestId. A new conversation
  // aborts the fetch, and every callback from an older request is dropped by
  // requestId, so a late reply never lands in the new thread (09-10 §1).
  const inFlightRef = useRef<{ requestId: number; controller: AbortController } | null>(null);
  const requestSeqRef = useRef(0);
  // Single-flight poll: the next tick is skipped while the previous request is
  // still out, and while a turn is streaming (its reply is delivered by the
  // stream, and `persisted` moves the cursor past it).
  const pollBusyRef = useRef(false);
  const isLoadingRef = useRef(false);
  isLoadingRef.current = isLoading;

  const t = TRANSLATIONS[language];

  useEffect(() => {
    const seen = localStorage.getItem('xlfm-welcome-seen');
    setHasSeenWelcome(seen === 'true');
  }, []);

  // Persistent anonymous browser ID — links a returning visitor's conversations
  // to one contact. Generated once and stored in localStorage.
  useEffect(() => {
    let id = localStorage.getItem('xlfm_browser_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('xlfm_browser_id', id);
    }
    browserIdRef.current = id;
  }, []);

  const dismissWelcome = () => {
    localStorage.setItem('xlfm-welcome-seen', 'true');
    setHasSeenWelcome(true);
  };

  const handleNewConversation = () => {
    if (messages.length > 0) {
      const confirmed = window.confirm(
        language === 'zh' ? '开启新对话？当前对话内容将会清空。' :
        language === 'en' ? 'Start new conversation? Current messages will be cleared.' :
        'Mulai percakapan baru? Pesan saat ini akan dihapus.'
      );
      if (!confirmed) return;
    }
    // Abort the in-flight turn: its fetch is cancelled and any callback that
    // still fires is dropped by requestId (the server finishes the reply and
    // persists it into the OLD conversation, where it belongs).
    if (inFlightRef.current) {
      inFlightRef.current.controller.abort();
      inFlightRef.current = null;
    }
    requestSeqRef.current++;
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setShowJumpButton(false);
    setConversationId(null); // fresh conversation — but keep the same browserId
    setVolunteerHandling(false);
    afterRef.current = null;
    wasAtBottomRef.current = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      wasAtBottomRef.current = isNearBottom();
      setShowJumpButton(!isNearBottom() && isLoading);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isLoading]);

  // Show/hide jump button when streaming state changes
  useEffect(() => {
    if (!isLoading) setShowJumpButton(false);
    else if (!isNearBottom()) setShowJumpButton(true);
  }, [isLoading]);

  // Smart auto-scroll: only scroll if user is near bottom
  useEffect(() => {
    if (wasAtBottomRef.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  // PART 3 — receive volunteer replies. Once a conversation exists, poll every 8s
  // for role='volunteer' messages newer than what we've shown (and the handling
  // flag). Ownership is enforced server-side via browserId. All setState lives in
  // the async callback, never synchronously in the effect body.
  useEffect(() => {
    if (!conversationId) return;
    const browserId = browserIdRef.current;
    if (!browserId) return;
    // Seed the cursor to "now" on first attach so we only surface fresh replies.
    if (afterRef.current === null) afterRef.current = { createdAt: new Date().toISOString(), id: null };

    let cancelled = false;
    const poll = async () => {
      // Single flight: never stack a second request on a slow one (a recovery
      // regeneration inside /api/chat/updates can take a minute), and never
      // poll while our own turn is streaming.
      if (pollBusyRef.current || isLoadingRef.current) return;
      pollBusyRef.current = true;
      try {
        const cursor = afterRef.current;
        const params = new URLSearchParams({
          conversationId,
          browserId,
          after: cursor?.createdAt ?? '',
          afterId: cursor?.id ?? '',
        });
        const res = await fetch(`/api/chat/updates?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        setVolunteerHandling(Boolean(json.handling));
        const incoming: { id: string; role?: string; content: string; created_at: string }[] = json.messages ?? [];
        if (incoming.length > 0) {
          const last = incoming[incoming.length - 1];
          afterRef.current = { createdAt: last.created_at, id: last.id };
          wasAtBottomRef.current = isNearBottom();
          setMessages((prev) => {
            // Recovered AI replies (role assistant) arrive here after a generation
            // failure. Skip one that exactly matches the last bubble we already
            // show — a stale client whose `after` cursor predates the live reply.
            const lastShown = [...prev].reverse().find((m) => m.role !== 'user')?.content;
            const shownIds = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter(
              (m) => !shownIds.has(m.id) && !(m.role === 'assistant' && m.content === lastShown)
            );
            if (fresh.length === 0) return prev;
            return [
              ...prev,
              ...fresh.map((m) => ({
                id: m.id,
                role: (m.role === 'assistant' ? 'assistant' : 'volunteer') as 'assistant' | 'volunteer',
                content: m.content,
              })),
            ];
          });
        }
      } catch {
        /* transient — the next tick retries */
      } finally {
        pollBusyRef.current = false;
      }
    };
    const interval = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const requestId = ++requestSeqRef.current;
    const controller = new AbortController();
    inFlightRef.current = { requestId, controller };
    // Callbacks from an older request (aborted by 新对话) must not touch state.
    const live = () => inFlightRef.current?.requestId === requestId;

    const userMessage: Message = { id: newId(), role: 'user', content: text };
    const replyId = newId();
    setMessages((prev) => [...prev, userMessage, { id: replyId, role: 'assistant', content: '', streaming: true, stage: 'retrieving' }]);
    setInput('');
    setIsLoading(true);

    // Scroll user's new message to top of viewport
    setTimeout(() => {
      if (latestUserMessageRef.current) {
        const y = latestUserMessageRef.current.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: y, behavior: 'smooth' });
        wasAtBottomRef.current = false;
      }
    }, 100);

    // Update THIS turn's reply bubble by id — never "the last item".
    const patchReply = (patch: Partial<Message> | ((m: Message) => Message)) => {
      if (!live()) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? (typeof patch === 'function' ? patch(m) : { ...m, ...patch }) : m))
      );
    };
    // The send key is enabled the moment [DONE] arrives (or the turn fails) —
    // not when the connection closes.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (inFlightRef.current?.requestId === requestId) inFlightRef.current = null;
      if (live() || requestSeqRef.current === requestId) setIsLoading(false);
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation: messages.map((m) => ({ role: m.role, content: m.content })),
          language,
          conversationId,
          browserId: browserIdRef.current,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to connect to AI');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!live()) {
          // 新对话 while streaming: stop reading; the server finishes on its own.
          reader.cancel().catch(() => {});
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // Stream complete — the reply is final; free the input right away.
            patchReply({ streaming: false, stage: undefined });
            finish();
            continue;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'stage') {
              patchReply({ stage: parsed.stage as ReplyStage });
            } else if (parsed.type === 'conversation') {
              if (parsed.conversationId && live()) setConversationId(parsed.conversationId);
            } else if (parsed.type === 'volunteer_handling') {
              // A human has taken over — no AI text is coming. Drop the empty
              // assistant placeholder and show the honest indicator. The poll will
              // surface the volunteer's reply.
              if (live()) {
                setVolunteerHandling(true);
                setMessages((prev) => prev.filter((m) => !(m.id === replyId && m.content === '')));
              }
            } else if (parsed.type === 'persisted') {
              // The live reply is now stored with this timestamp; start the
              // late-reply poll strictly after it so it is never re-shown.
              if (parsed.createdAt && live()) afterRef.current = { createdAt: parsed.createdAt, id: null };
            } else if (parsed.type === 'sources') {
              patchReply({ sources: parsed.sources });
            } else if (parsed.type === 'text') {
              patchReply((m) => ({ ...m, content: m.content + parsed.text }));
            } else if (parsed.type === 'error') {
              patchReply((m) => (m.content ? m : { ...m, content: failureText(language) }));
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError' || !live()) {
        // Aborted by 新对话 — nothing to show, nothing to reset.
        return;
      }
      console.error('Chat error:', error);
      // Network-level failure (the server never answered). The server-side
      // failure path sends the same honest wording as a normal text event.
      patchReply({ content: failureText(language), streaming: false, stage: undefined });
    } finally {
      finish();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* Welcome Modal — first visit only */}
      {hasSeenWelcome === false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-bg rounded-2xl shadow-2xl max-w-[480px] w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8">
            <h2 className="text-xl font-bold text-ink font-serif text-center mb-5">
              {t.welcomeTitle}
            </h2>

            <div className="space-y-4 text-sm text-ink">
              <div>
                <p className="font-semibold mb-1.5">{'🔒'} {t.welcomePrivacy}</p>
                <ul className="space-y-1 text-ink-muted">
                  <li>{'•'} {t.welcomePrivacy1}</li>
                  <li>{'•'} {t.welcomePrivacy2}</li>
                  <li>{'•'} {t.welcomePrivacy3}</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1.5">{'\uD83D\uDCFF'} {t.welcomeOffer}</p>
                <ul className="space-y-1 text-ink-muted">
                  <li>{'•'} {t.welcomeOffer1}</li>
                  <li>{'•'} {t.welcomeOffer2}</li>
                  <li>{'•'} {t.welcomeOffer3}</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1.5">{'\uD83D\uDE4F'} {t.welcomeLimit}</p>
                <ul className="space-y-1 text-ink-muted">
                  <li>{'•'} {t.welcomeLimit1}</li>
                  <li>{'•'} {t.welcomeLimit2}</li>
                  <li>{'•'} {t.welcomeLimit3}</li>
                </ul>
              </div>

              <div className="mb-4 p-4 rounded-lg border-2 border-red-400 bg-red-50">
                <p className="font-bold text-red-700 text-base mb-1">{t.welcomeLegalTitle}</p>
                <p className="text-sm text-red-800">{t.welcomeLegalBody}</p>
              </div>

              <div className="bg-red-50 rounded-xl p-3">
                <p className="font-semibold mb-1.5 text-red-800">{'\uD83D\uDEA8'} {t.welcomeEmergency}</p>
                <ul className="space-y-1 text-red-700 text-xs">
                  <li>{'•'} {language === 'zh' ? '医疗紧急 / 生命危险' : language === 'en' ? 'Medical / Life-threatening' : 'Kecemasan Perubatan / Nyawa'}:{' '}
                    <a href="tel:999" className="underline font-semibold">999</a>
                  </li>
                  <li>{'•'} {language === 'zh' ? '心理危机' : language === 'en' ? 'Mental Crisis' : 'Krisis Mental'}:{' '}
                    <a href="tel:0376272929" className="underline font-semibold">Befrienders KL: 03-7627 2929</a>
                  </li>
                  <li>{'•'} {language === 'zh' ? '家暴求助' : language === 'en' ? 'Domestic Violence' : 'Keganasan Rumah Tangga'}:{' '}
                    <a href="tel:15999" className="underline font-semibold">Talian Kasih: 15999</a>
                  </li>
                </ul>
              </div>
            </div>

            <p className="text-center text-xs text-ink-muted mt-4">
              {language === 'zh' ? '一切免费结缘 · 菩萨慈悲' : language === 'en' ? 'Free forever · With Bodhisattva\'s compassion' : 'Percuma selamanya · Dengan belas kasihan Bodhisattva'} {'\uD83D\uDE4F'}
            </p>

            <button
              onClick={dismissWelcome}
              className="mt-5 w-full py-3 btn-primary rounded-xl font-medium transition text-base"
            >
              {t.welcomeBtn}
            </button>
          </div>
        </div>
      )}

      <div className="border-b border-border bg-surface/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="text-accent w-6 h-6" />
            <div>
              <h1 className="text-xl font-bold text-ink font-serif">{t.title}</h1>
              <p className="text-xs text-ink-muted">{t.basedOn}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleNewConversation}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-accent-deep hover:text-accent-deep hover:bg-accent/10 rounded-full transition-colors"
                aria-label="新对话"
                title={language === 'zh' ? '新对话' : language === 'en' ? 'New chat' : 'Baru'}
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m-6-6h12" />
                </svg>
                <span className="hidden sm:inline">
                  {language === 'zh' ? '新对话' : language === 'en' ? 'New chat' : 'Baru'}
                </span>
              </button>
            )}
            <div className="flex gap-1 bg-accent/10 rounded-full p-1">
              {(['zh', 'en', 'id'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`px-3 py-1 rounded-full text-sm transition ${
                    language === lang
                      ? 'bg-accent text-white'
                      : 'text-ink hover:bg-surface'
                  }`}
                >
                  {lang === 'zh' ? '中文' : lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-6 sm:py-8 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-ink-muted mb-2 text-center">{t.subtitle}</h2>
          <p className="text-accent text-lg font-medium">{t.free}</p>

          <form onSubmit={handleSubmit} className="w-full mt-6 mb-6">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={t.placeholder}
                disabled={isLoading}
                rows={1}
                className="flex-1 p-3 border border-border-strong rounded-xl resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent text-ink bg-surface shadow-sm"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-6 py-3 btn-primary rounded-xl font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>

          <div className="w-full">
            <p className="text-sm text-ink-muted text-center mb-3">{t.quickTitle}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {QUICK_QUESTIONS[language].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(q)}
                  disabled={isLoading}
                  className="text-left p-4 bg-surface border border-border rounded-xl hover:bg-accent/5 hover:border-accent hover:text-ink transition disabled:opacity-50"
                >
                  <p className="text-ink">{q}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
        <div className="max-w-4xl mx-auto px-4 py-8 pb-32">
          <div className="space-y-6">
            {messages.map((msg, idx) => {
              const isLatestUser = msg.role === 'user' && (
                idx === messages.length - 1 ||
                (idx === messages.length - 2 && messages[messages.length - 1]?.role === 'assistant')
              );
              return (
              <div
                key={msg.id}
                ref={isLatestUser ? latestUserMessageRef : null}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl p-4 ${
                    msg.role === 'user'
                      ? 'card-selected text-ink'
                      : msg.role === 'volunteer'
                        ? 'bg-surface border border-border text-ink-body'
                        : 'bg-surface border border-border text-ink'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : msg.role === 'volunteer' ? (
                    <>
                      <div className="text-xs font-medium text-accent-deep mb-1.5">{t.volunteerLabel}</div>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </>
                  ) : (
                    <MasterMarkdown>{msg.content}</MasterMarkdown>
                  )}

                  {msg.role === 'assistant' && !msg.streaming && (
                    <MessageSources sources={msg.sources ?? []} title={t.sourcesTitle} />
                  )}

                  {msg.role === 'assistant' && !msg.streaming && msg.content && (
                    <div className="mt-3 pt-2 flex items-center gap-3">
                      <button
                        onClick={() => {
                          const shareText = `${msg.content}\n\n—— 心灵法门智慧问答\nhttps://xlfm.my`;
                          if (navigator.share) {
                            navigator.share({ text: shareText }).catch(() => {});
                          } else {
                            navigator.clipboard.writeText(shareText);
                            const btn = document.activeElement as HTMLElement;
                            if (btn) { const o = btn.innerText; btn.innerText = '已复制 ✓'; setTimeout(() => { btn.innerText = o; }, 1500); }
                          }
                        }}
                        className="text-xs text-ink-muted hover:text-accent flex items-center gap-1 transition"
                      >
                        <span>📤</span> 分享
                      </button>
                    </div>
                  )}
                </div>
              </div>
              );
            })}

            {isLoading && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="bg-surface border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 text-ink-muted">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-sm">{stageLabel(t, messages[messages.length - 1]?.stage)}</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {showJumpButton && (
          <button
            onClick={() => {
              window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
              setShowJumpButton(false);
              wasAtBottomRef.current = true;
            }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-full shadow-lg hover:brightness-110 transition-all text-sm font-medium"
            aria-label="跳到最新内容"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.59L7.3 9.24a.75.75 0 00-1.1 1.02l3.25 3.5a.75.75 0 001.1 0l3.25-3.5a.75.75 0 10-1.1-1.02l-1.95 2.1V6.75z" clipRule="evenodd" />
            </svg>
            下面有新内容
          </button>
        )}

        <form
          onSubmit={handleSubmit}
          className="fixed bottom-0 left-0 right-0 bg-surface/90 backdrop-blur-sm border-t border-border"
        >
          <div className="max-w-4xl mx-auto p-4">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={t.placeholder}
                disabled={isLoading}
                rows={1}
                className="flex-1 p-3 border border-border-strong rounded-xl resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent text-ink"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-6 py-3 btn-primary rounded-xl font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            {volunteerHandling && (
              <p className="mt-2 text-center text-xs text-accent-deep">{t.volunteerHandlingNotice}</p>
            )}
          </div>
        </form>
        </>
      )}

      {/* Persistent safety footer */}
      <div className={`${messages.length > 0 ? 'fixed bottom-[68px] left-0 right-0 bg-surface/80 backdrop-blur-sm' : ''} border-t border-border py-2 px-4`}>
        {/* Row 1: declarations + For Non-Muslim Only inline */}
        <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-xs text-ink">
          <span className="font-medium">
          {'\uD83D\uDE4F'} {t.footerLine1}</span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span className="font-bold text-red-700">{t.footerLineLegal}</span>
        </div>
        {/* Row 2: emergency contacts */}
        <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-xs text-ink mt-1">
          <span><span className="font-semibold">{t.footerLine2}</span><a href="tel:999" className="text-accent underline hover:text-accent-deep">999</a></span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span><span className="font-semibold">{t.footerMental}</span><a href="tel:0376272929" className="text-accent underline hover:text-accent-deep">Befrienders 03-7627 2929</a></span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span><span className="font-semibold">{t.footerDV}</span><a href="tel:15999" className="text-accent underline hover:text-accent-deep">Talian Kasih 15999</a></span>
        </div>
      </div>
    </div>
  );
}
