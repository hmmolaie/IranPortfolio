'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type ChatMessage = {
  id: string;
  role: string;
  contentFa: string;
};

export function TehranMarketChat() {
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [errorFa, setErrorFa] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  async function loadChat() {
    const messages = await api<ChatMessage[]>('/market/chat');
    setChat(messages);
  }

  useEffect(() => {
    loadChat().catch(() => undefined);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, chatBusy]);

  async function clearChat() {
    setClearing(true);
    setErrorFa('');
    try {
      await api('/market/chat', { method: 'DELETE' });
      setChat([]);
    } catch (e) {
      setErrorFa((e as Error).message);
    } finally {
      setClearing(false);
    }
  }

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput('');
    setErrorFa('');
    setChatBusy(true);
    try {
      await api<ChatMessage>('/market/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      await loadChat();
    } catch (err) {
      setErrorFa((err as Error).message);
      setChatInput(text);
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">گفتگو دربارهٔ بازار سهام تهران</h2>
          <p className="mt-1 text-sm text-navy-800/60">
            فقط دربارهٔ نمادها، شاخص و بورس تهران بپرسید. پاسخ از قیمت ذخیره‌شده و گزارش صندوق‌هایی است
            که آن سهم را دارند یا خریده‌اند. سؤال نامرتبط پاسخ داده نمی‌شود.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={clearing || chat.length === 0}
          onClick={() => {
            clearChat().catch(() => undefined);
          }}
        >
          {clearing ? '...' : 'پاک کردن گفتگوها'}
        </button>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg bg-navy-50/60 p-4">
        {chat.length === 0 && !chatBusy && (
          <p className="text-sm text-navy-800/50">
            هنوز پیامی نیست. مثلاً بپرسید: «فولاد را کدام صندوق‌ها خریده‌اند؟» یا «شاخص کل در دادهٔ سبدیار
            چند است؟»
          </p>
        )}
        {chat.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg px-3 py-2 text-sm leading-7 ${
              m.role === 'user' ? 'ms-8 bg-white text-navy-900' : 'me-8 bg-navy-900/90 text-white'
            }`}
          >
            {m.contentFa}
          </div>
        ))}
        {chatBusy && (
          <div className="me-8 rounded-lg bg-navy-900/70 px-3 py-2 text-sm text-white/90">
            در حال پاسخ با دادهٔ بازار و صندوق‌ها...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      {errorFa && <p className="text-sm text-red-700">{errorFa}</p>}
      <form onSubmit={sendChat} className="flex gap-2">
        <input
          className="input flex-1"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="نماد یا سؤال بازار تهران..."
          disabled={chatBusy}
          maxLength={800}
        />
        <button type="submit" className="btn-primary" disabled={chatBusy || !chatInput.trim()}>
          {chatBusy ? '...' : 'ارسال'}
        </button>
      </form>
    </section>
  );
}
