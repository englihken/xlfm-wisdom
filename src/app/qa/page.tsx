// src/app/qa/page.tsx
// 智慧问答 - AI Chatbot Page
// The flagship feature: chat with Master Lu's 47 volumes of teachings

'use client';

import { useState, useRef, useEffect, type ComponentPropsWithoutRef } from 'react';
import { Send, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type Source = {
  book: string;
  page_start?: number;
  page_end?: number;
  excerpt?: string;
  count: number;
};

interface Message {
  role: 'user' | 'assistant';
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
    welcomeTitle: '欢迎来到 心灵法门 智慧问答',
    welcomePrivacy: '关于您的隐私',
    welcomePrivacy1: '对话不会被保存',
    welcomePrivacy2: '不需要注册，没有账号',
    welcomePrivacy3: '每次对话都是全新的开始',
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
    footerLine1: '一切免费结缘 \u00b7 对话不保存 \u00b7 佛法引导不替代专业意见',
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
    welcomeTitle: 'Welcome to Xin Ling Fa Men Wisdom Q&A',
    welcomePrivacy: 'Your Privacy',
    welcomePrivacy1: 'Conversations are not stored',
    welcomePrivacy2: 'No registration, no account',
    welcomePrivacy3: 'Each session starts fresh',
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
    footerLine1: 'Free forever \u00b7 Conversations not stored \u00b7 Spiritual guidance, not professional advice',
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
    welcomeTitle: 'Selamat Datang ke Xin Ling Fa Men Wisdom Q&A',
    welcomePrivacy: 'Privasi Anda',
    welcomePrivacy1: 'Perbualan tidak disimpan',
    welcomePrivacy2: 'Tiada pendaftaran, tiada akaun',
    welcomePrivacy3: 'Setiap sesi bermula semula',
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
    footerLine1: 'Percuma selamanya \u00b7 Perbualan tidak disimpan \u00b7 Panduan rohani bukan nasihat profesional',
    footerLineLegal: '🇲🇾 For Non-Muslim Only',
    footerLine2: 'Kecemasan: ',
    footerMental: 'Mental: ',
    footerDV: 'DV: ',
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasAtBottomRef = useRef(true);
  const latestUserMessageRef = useRef<HTMLDivElement | null>(null);

  const t = TRANSLATIONS[language];

  useEffect(() => {
    const seen = localStorage.getItem('xlfm-welcome-seen');
    setHasSeenWelcome(seen === 'true');
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

            if (parsed.type === 'sources') {
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
    <div className="min-h-screen bg-[#FFF3DA]">
      {/* Welcome Modal — first visit only */}
      {hasSeenWelcome === false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-[#FFF3DA] rounded-2xl shadow-2xl max-w-[480px] w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8">
            <h2 className="text-xl font-bold text-[#583A0F] text-center mb-5">
              {t.welcomeTitle}
            </h2>

            <div className="space-y-4 text-sm text-[#583A0F]">
              <div>
                <p className="font-semibold mb-1.5">{'🔒'} {t.welcomePrivacy}</p>
                <ul className="space-y-1 text-[#8B6F47]">
                  <li>{'•'} {t.welcomePrivacy1}</li>
                  <li>{'•'} {t.welcomePrivacy2}</li>
                  <li>{'•'} {t.welcomePrivacy3}</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1.5">{'\uD83D\uDCFF'} {t.welcomeOffer}</p>
                <ul className="space-y-1 text-[#8B6F47]">
                  <li>{'•'} {t.welcomeOffer1}</li>
                  <li>{'•'} {t.welcomeOffer2}</li>
                  <li>{'•'} {t.welcomeOffer3}</li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1.5">{'\uD83D\uDE4F'} {t.welcomeLimit}</p>
                <ul className="space-y-1 text-[#8B6F47]">
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

            <p className="text-center text-xs text-[#8B6F47] mt-4">
              {language === 'zh' ? '一切免费结缘 · 菩萨慈悲' : language === 'en' ? 'Free forever · With Bodhisattva\'s compassion' : 'Percuma selamanya · Dengan belas kasihan Bodhisattva'} {'\uD83D\uDE4F'}
            </p>

            <button
              onClick={dismissWelcome}
              className="mt-5 w-full py-3 bg-[#D89938] hover:bg-[#A87929] text-white rounded-xl font-medium transition text-base"
            >
              {t.welcomeBtn}
            </button>
          </div>
        </div>
      )}

      <div className="border-b border-[#EFE3BF] bg-white/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="text-[#D89938] w-6 h-6" />
            <div>
              <h1 className="text-xl font-bold text-[#583A0F]">{t.title}</h1>
              <p className="text-xs text-[#8B6F47]">{t.basedOn}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleNewConversation}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-800 hover:text-amber-900 hover:bg-amber-100/60 rounded-full transition-colors"
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
            <div className="flex gap-1 bg-[#FAEFD0] rounded-full p-1">
              {(['zh', 'en', 'id'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`px-3 py-1 rounded-full text-sm transition ${
                    language === lang
                      ? 'bg-[#D89938] text-white'
                      : 'text-[#583A0F] hover:bg-white'
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
        <div className="flex flex-col items-center px-4 py-8 sm:py-12 max-w-2xl mx-auto">
          <div className="inline-block p-4 bg-[#FAEFD0] rounded-full mb-4">
            <Sparkles className="w-12 h-12 text-[#D89938]" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#583A0F] mb-3 text-center">{t.subtitle}</h2>
          <p className="text-[#8B6F47] text-lg">{t.free}</p>

          <form onSubmit={handleSubmit} className="w-full mt-8 mb-10">
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
                className="flex-1 p-3 border border-[#EFE3BF] rounded-xl resize-none focus:outline-none focus:border-[#D89938] focus:ring-1 focus:ring-[#D89938] text-[#583A0F] bg-white shadow-sm"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-6 py-3 bg-[#D89938] hover:bg-[#A87929] text-white rounded-xl font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>

          <div className="w-full">
            <p className="text-sm text-[#8B6F47] text-center mb-4">{t.quickTitle}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {QUICK_QUESTIONS[language].map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(q)}
                  disabled={isLoading}
                  className="text-left p-4 bg-white border border-[#EFE3BF] rounded-xl hover:border-[#D89938] hover:shadow-md transition disabled:opacity-50"
                >
                  <p className="text-[#583A0F]">{q}</p>
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
                      ? 'bg-[#D89938] text-white'
                      : 'bg-white border border-[#EFE3BF] text-[#583A0F]'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : (
                    <ReactMarkdown
                      components={{
                        p: (props: ComponentPropsWithoutRef<'p'>) => <p className="my-2 leading-relaxed" {...props} />,
                        h1: (props: ComponentPropsWithoutRef<'h1'>) => <h1 className="text-xl font-semibold my-3" {...props} />,
                        h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 className="text-lg font-semibold my-3" {...props} />,
                        h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 className="text-base font-semibold my-2" {...props} />,
                        ul: (props: ComponentPropsWithoutRef<'ul'>) => <ul className="my-2 ml-5 list-disc" {...props} />,
                        ol: (props: ComponentPropsWithoutRef<'ol'>) => <ol className="my-2 ml-5 list-decimal" {...props} />,
                        li: (props: ComponentPropsWithoutRef<'li'>) => <li className="my-1" {...props} />,
                        hr: () => <hr className="my-4 border-amber-200/60" />,
                        blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => <blockquote className="my-3 pl-3 border-l-2 border-amber-300 italic text-amber-900/80" {...props} />,
                        strong: (props: ComponentPropsWithoutRef<'strong'>) => <strong className="text-amber-900 font-semibold" {...props} />,
                        code: (props: ComponentPropsWithoutRef<'code'>) => <code className="bg-amber-100/50 px-1 py-0.5 rounded text-sm" {...props} />,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  )}

                  {msg.role === 'assistant' && !msg.streaming && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-[#EFE3BF] animate-[fadeIn_0.5s_ease-in]">
                      <div className="text-xs text-[#8B6F47] mb-2">{t.sourcesTitle}</div>
                      <div className="space-y-1">
                        {msg.sources.map((s: Source, sidx: number) => {
                          const pageInfo = s.page_start
                            ? (s.page_start === s.page_end
                                ? `第 ${s.page_start} 页`
                                : `第 ${s.page_start}-${s.page_end} 页`)
                            : '';
                          return (
                            <div key={sidx} className="text-xs text-[#8B6F47] flex items-center gap-1">
                              <span>📖</span>
                              <span className="font-medium">《{s.book}》</span>
                              {pageInfo && <span className="text-[#8B6F47]/70">· {pageInfo}</span>}
                              {s.count > 1 && <span className="text-[#8B6F47]/60 text-[10px]">({s.count}段)</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              );
            })}

            {isLoading && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="bg-white border border-[#EFE3BF] rounded-2xl p-4">
                  <div className="flex items-center gap-2 text-[#8B6F47]">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-[#D89938] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-[#D89938] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-[#D89938] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-full shadow-lg hover:bg-amber-600 transition-all text-sm font-medium"
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
          className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-[#EFE3BF]"
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
                className="flex-1 p-3 border border-[#EFE3BF] rounded-xl resize-none focus:outline-none focus:border-[#D89938] focus:ring-1 focus:ring-[#D89938] text-[#583A0F]"
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="px-6 py-3 bg-[#D89938] hover:bg-[#A87929] text-white rounded-xl font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </form>
        </>
      )}

      {/* Persistent safety footer */}
      <div className={`${messages.length > 0 ? 'fixed bottom-[68px] left-0 right-0 bg-white/80 backdrop-blur-sm' : ''} border-t border-[#EFE3BF] py-2 px-4 text-center`}>
        <p className="text-[10px] text-amber-700/60 leading-relaxed">
          {'\uD83D\uDE4F'} {t.footerLine1}
        </p>
        <div className="text-center my-2">
          <p className="text-sm font-bold text-red-700 px-3 py-1.5 inline-block bg-red-50 border-2 border-red-300 rounded-md">
            {t.footerLineLegal}
          </p>
        </div>
        <p className="text-[10px] text-amber-700/50 leading-relaxed">
          {t.footerLine2}<a href="tel:999" className="underline">999</a>
          {' | '}{t.footerMental}<a href="tel:0376272929" className="underline">Befrienders 03-7627 2929</a>
          {' | '}{t.footerDV}<a href="tel:15999" className="underline">Talian Kasih 15999</a>
        </p>
      </div>
    </div>
  );
}
