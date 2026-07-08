// src/app/qa/page.tsx
// 智慧问答 - AI Chatbot Page
// The flagship feature: chat with Master Lu's 47 volumes of teachings

'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { MasterMarkdown, MessageSources, type Source } from '@/components/assistant-message';

interface Message {
  role: 'user' | 'assistant' | 'volunteer';
  content: string;
  sources?: Source[];
  streaming?: boolean;
}

const QUICK_QUESTIONS = {
  zh: [
    '我最近失眠很严重，念什么经好？',
    '和家人一直吵架，我可以先学什么？',
    '工作一直不顺，是不是有业障？',
    '孩子不听话，我应该如何面对自己的情绪？',
    '刚开始接触心灵法门，第一步应该做什么？',
    '家人生病了，我应该为他念什么经？',
  ],
  en: [
    'I have severe insomnia, which sutras should I recite?',
    'I keep arguing with family, what can I start learning?',
    'Work has been going badly, is it karma?',
    'My child is rebellious, how should I handle my emotions?',
    'I am new to 心灵法门, what is the first step?',
    'My family member is ill, what should I recite for them?',
  ],
  id: [
    'Saya sulit tidur, sutra apa yang harus saya baca?',
    'Saya selalu bertengkar dengan keluarga, apa yang harus saya pelajari?',
    'Pekerjaan saya tidak lancar, apakah ini karma?',
    'Anak saya nakal, bagaimana mengatasi emosi saya?',
    'Saya baru mengenal 心灵法门, apa langkah pertama?',
    'Keluarga saya sakit, apa yang harus saya baca untuk mereka?',
  ],
};

const TRANSLATIONS = {
  zh: {
    title: '智慧问答',
    subtitle: '说出您的烦恼，这里会帮您找到方向',
    basedOn: '基于卢台长47部著作 · 约500万字开示内容',
    free: '一切完全免费，无需注册',
    placeholder: '请输入您想问的问题...',
    sending: '正在思考...',
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
    basedOn: "Based on Master Lu's 47 volumes · ~5 million words of teachings",
    free: 'Completely free, no registration required',
    placeholder: 'Type your question...',
    sending: 'Thinking...',
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
    basedOn: 'Berdasarkan 47 volume ajaran Master Lu · ~5 juta kata',
    free: 'Sepenuhnya gratis, tanpa pendaftaran',
    placeholder: 'Ketik pertanyaan Anda...',
    sending: 'Memikirkan...',
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
  // ISO timestamp of the newest volunteer reply we've already shown — the poll's
  // `after` cursor. Null until the conversation exists (then set to "now").
  const afterRef = useRef<string | null>(null);

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
    if (afterRef.current === null) afterRef.current = new Date().toISOString();

    let cancelled = false;
    const poll = async () => {
      try {
        const params = new URLSearchParams({
          conversationId,
          browserId,
          after: afterRef.current ?? '',
        });
        const res = await fetch(`/api/chat/updates?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        setVolunteerHandling(Boolean(json.handling));
        const incoming: { id: string; content: string; created_at: string }[] = json.messages ?? [];
        if (incoming.length > 0) {
          afterRef.current = incoming[incoming.length - 1].created_at;
          wasAtBottomRef.current = isNearBottom();
          setMessages((prev) => [
            ...prev,
            ...incoming.map((m) => ({ role: 'volunteer' as const, content: m.content })),
          ]);
        }
      } catch {
        /* transient — the next tick retries */
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

    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
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

    setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

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

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
              // Stream complete — mark message as no longer streaming
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = { ...updated[lastIdx], streaming: false };
                return updated;
              });
              continue;
            }

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'conversation') {
              if (parsed.conversationId) setConversationId(parsed.conversationId);
            } else if (parsed.type === 'volunteer_handling') {
              // A human has taken over — no AI text is coming. Drop the empty
              // assistant placeholder and show the honest indicator. The poll will
              // surface the volunteer's reply.
              setVolunteerHandling(true);
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (updated[lastIdx]?.role === 'assistant' && updated[lastIdx].content === '') {
                  updated.pop();
                }
                return updated;
              });
            } else if (parsed.type === 'sources') {
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  sources: parsed.sources,
                };
                return updated;
              });
            } else if (parsed.type === 'text') {
              setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + parsed.text,
                };
                return updated;
              });
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        updated[lastIdx] = {
          role: 'assistant',
          content:
            language === 'zh'
              ? '抱歉，暂时无法连接。请稍后再试，或直接阅读台长的书籍。'
              : 'Sorry, unable to connect. Please try again later.',
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
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
                key={idx}
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
                    <span className="text-sm">{t.sending}</span>
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
