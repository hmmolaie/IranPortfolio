'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { adminApiErrorText, api, getToken } from '@/lib/api';
import { TELEGRAM_BOT_USERNAME } from '@/lib/telegram';
import { TelegramBotLink } from '@/components/TelegramBotLink';
import { useToast } from '@/components/Toast';
import { WebAuthnSettings } from '@/components/WebAuthnSettings';
import { WalletAdminPanel, WalletPanel } from './wallet-panel';
import { formatShamsiDate, formatShamsiDateTime } from '@/lib/shamsi-date';

type ProviderId = 'openrouter' | 'openai' | 'custom';

type FundDefinition = {
  id: string;
  nameFa: string;
  symbolCode?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  isActive: boolean;
};

type TelegramLink = {
  userId: string;
  name?: string | null;
  email: string;
  isActive: boolean;
  mobilePhone?: string | null;
  telegramUsername?: string | null;
  telegramLinkedAt?: string | null;
};

type LlmPrompt = {
  purpose: string;
  labelFa: string;
  descriptionFa: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  isCustom: boolean;
};

type SettingsTab =
  | 'profile'
  | 'password'
  | 'webauthn'
  | 'funds'
  | 'prompts'
  | 'llm'
  | 'spotPrices'
  | 'worldApis'
  | 'refreshTimes'
  | 'telegram'
  | 'telegramAssistant'
  | 'mobileLogin'
  | 'fees'
  | 'wallet'
  | 'walletAdmin';

const TABS: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
  { id: 'profile', label: 'پروفایل' },
  { id: 'password', label: 'تغییر رمز عبور' },
  { id: 'webauthn', label: 'اثر انگشت و چهره' },
  { id: 'wallet', label: 'کیف پول' },
  { id: 'funds', label: 'صندوق‌ها', adminOnly: true },
  { id: 'prompts', label: 'پرامپت‌ها', adminOnly: true },
  { id: 'llm', label: 'API مدل زبانی', adminOnly: true },
  { id: 'spotPrices', label: 'API قیمت لحظه‌ای دلار و طلا', adminOnly: true },
  { id: 'worldApis', label: 'API اقتصاد دنیا', adminOnly: true },
  { id: 'refreshTimes', label: 'ساعت به‌روزرسانی', adminOnly: true },
  { id: 'telegram', label: 'ربات تلگرام', adminOnly: true },
  { id: 'telegramAssistant', label: 'دستیار تلگرام', adminOnly: true },
  { id: 'walletAdmin', label: 'تنظیمات کیف پول', adminOnly: true },
  { id: 'mobileLogin', label: 'ورود از طریق موبایل', adminOnly: true },
  { id: 'fees', label: 'کارمزدها', adminOnly: true },
];

const FEE_FIELDS = [
  { key: 'stockBuyPct', label: 'کارمزد خرید بازار سهام تهران' },
  { key: 'stockSellPct', label: 'کارمزد فروش بازار سهام تهران' },
  { key: 'physicalUsdBuyPct', label: 'کارمزد خرید دلار فیزیکی' },
  { key: 'physicalUsdSellPct', label: 'کارمزد فروش دلار فیزیکی' },
  { key: 'physicalGoldBuyPct', label: 'کارمزد خرید طلای فیزیکی' },
  { key: 'physicalGoldSellPct', label: 'کارمزد فروش طلای فیزیکی' },
] as const;

function parseFeePct(raw: string): number {
  const normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/,/g, '.')
    .replace(/٫/g, '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > 30) {
    throw new Error('هر کارمزد باید عددی بین ۰ و ۳۰ درصد باشد.');
  }
  return value;
}

const SEND_WEEKDAYS = [
  { id: 6, label: 'شنبه' },
  { id: 0, label: 'یکشنبه' },
  { id: 1, label: 'دوشنبه' },
  { id: 2, label: 'سه‌شنبه' },
  { id: 3, label: 'چهارشنبه' },
  { id: 4, label: 'پنجشنبه' },
  { id: 5, label: 'جمعه' },
];

function clockValue(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const PROVIDERS: Record<
  ProviderId,
  { label: string; baseUrl: string; model: string; hint: string }
> = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free, google/gemma-3-27b-it:free',
    hint: 'کلید sk-or-v1-... از openrouter.ai — مدل‌های رایگان ممکن است ۴۲۹ بدهند.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'کلید sk-... از platform.openai.com',
  },
  custom: {
    label: 'سفارشی (سازگار با OpenAI)',
    baseUrl: '',
    model: '',
    hint: 'هر endpoint سازگار با /chat/completions (مثلاً DeepSeek، Groq، Azure).',
  },
};

function detectProvider(baseUrl: string): ProviderId {
  if (baseUrl.includes('openrouter.ai')) return 'openrouter';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  return 'custom';
}

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<SettingsTab>('profile');
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState({
    name: '',
    riskTolerance: 5,
    horizonMonths: 12,
    notes: '',
    investmentPreferencesFa: '',
    constraintsFa: '',
    mobilePhone: '',
    liquidityNeed: '',
    maxDrawdownPct: '',
    inflationSensitivity: '',
    fxSensitivity: '',
    objectiveFa: '',
  });
  const [provider, setProvider] = useState<ProviderId>('openrouter');
  const [llm, setLlm] = useState({
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    apiToken: '',
    usePlatformFallback: true,
    hasToken: false,
  });
  const [fundDefs, setFundDefs] = useState<FundDefinition[]>([]);
  const [newFund, setNewFund] = useState({ nameFa: '', symbolCode: '', description: '', websiteUrl: '' });
  const [editingFund, setEditingFund] = useState<FundDefinition | null>(null);
  const [editFundForm, setEditFundForm] = useState({
    nameFa: '',
    symbolCode: '',
    description: '',
    websiteUrl: '',
  });
  const [fundBusy, setFundBusy] = useState(false);
  const [prompts, setPrompts] = useState<LlmPrompt[]>([]);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState('');
  const [llmTestBusy, setLlmTestBusy] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{
    ok: boolean;
    messageFa: string;
    reply?: string;
    model?: string;
    latencyMs?: number;
  } | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [spotUri, setSpotUri] = useState('');
  const [spotBusy, setSpotBusy] = useState(false);
  const [spotFeedback, setSpotFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [spotLatest, setSpotLatest] = useState<{
    dateKey?: string;
    usdIrr?: number | null;
    goldGramRial?: number | null;
  } | null>(null);
  const [worldApis, setWorldApis] = useState({ bitpinMarketsUrl: '', yahooQuoteUrl: '' });
  const [worldApiBusy, setWorldApiBusy] = useState(false);
  const [worldApiFeedback, setWorldApiFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshTimes, setRefreshTimes] = useState({
    iranNewsHour: 8,
    iranNewsMinute: 0,
    worldHour: 7,
    worldMinute: 0,
    marketHour: 22,
    marketMinute: 0,
  });
  const [refreshTimeBusy, setRefreshTimeBusy] = useState(false);
  const [refreshTimeFeedback, setRefreshTimeFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [tgForm, setTgForm] = useState({
    botNameFa: 'سبدیار',
    botUsername: TELEGRAM_BOT_USERNAME,
    botToken: '',
    ttsModel: 'gemini-2.5-pro-preview-tts',
    sendHour: 8,
    sendMinute: 30,
    sendWeekdays: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
  });
  const [tgMeta, setTgMeta] = useState({
    hasToken: false,
    linkedCount: 0,
    lastDigest: null as null | {
      dateKey: string;
      sentCount: number;
      failedCount: number;
      skippedReasonFa?: string | null;
    },
  });
  const [tgMe, setTgMe] = useState<{
    configured: boolean;
    botNameFa: string;
    botUsername: string;
        deepLink: string | null;
        linked: boolean;
        linkedOnThisAccount?: boolean;
      } | null>(null);
  const [tgLinks, setTgLinks] = useState<TelegramLink[]>([]);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgFeedback, setTgFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [assistForm, setAssistForm] = useState({
    botNameFa: 'دستیار سبدیار',
    botUsername: '',
    botToken: '',
    enabled: true,
  });
  const [assistMeta, setAssistMeta] = useState({ hasToken: false, deepLink: null as string | null });
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistFeedback, setAssistFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [feeForm, setFeeForm] = useState({
    stockBuyPct: '0',
    stockSellPct: '0',
    physicalUsdBuyPct: '0',
    physicalUsdSellPct: '0',
    physicalGoldBuyPct: '0',
    physicalGoldSellPct: '0',
  });
  const [feeBusy, setFeeBusy] = useState(false);
  const [mobileLoginEnabled, setMobileLoginEnabled] = useState(false);
  const [mobileLoginRows, setMobileLoginRows] = useState<
    Array<{
      id: string;
      ip: string | null;
      location: string | null;
      mobilePhone: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [mobileLoginBusy, setMobileLoginBusy] = useState(false);

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  async function loadPrompts() {
    const list = await api<LlmPrompt[]>('/llm/prompts');
    setPrompts(list);
  }

  async function loadFundDefs() {
    const defs = await api<FundDefinition[]>('/funds/definitions?includeInactive=true');
    setFundDefs(defs);
  }

  async function loadRefreshTimes() {
    const cfg = await api<{
      iranNewsHour: number;
      iranNewsMinute: number;
      worldHour: number;
      worldMinute: number;
      marketHour?: number;
      marketMinute?: number;
    }>('/news/schedule');
    setRefreshTimes({
      iranNewsHour: cfg.iranNewsHour ?? 8,
      iranNewsMinute: cfg.iranNewsMinute ?? 0,
      worldHour: cfg.worldHour ?? 7,
      worldMinute: cfg.worldMinute ?? 0,
      marketHour: cfg.marketHour ?? 22,
      marketMinute: cfg.marketMinute ?? 0,
    });
  }

  async function loadWorldApis() {
    const cfg = await api<{ bitpinMarketsUrl: string; yahooQuoteUrl: string }>('/world-markets/source-api');
    setWorldApis({
      bitpinMarketsUrl: cfg.bitpinMarketsUrl ?? '',
      yahooQuoteUrl: cfg.yahooQuoteUrl ?? '',
    });
  }

  async function loadSpotConfig() {
    try {
      const c = await api<{ uri: string } | null>('/prices/config');
      setSpotUri(c?.uri?.trim() ? c.uri : '');
    } catch {
      /* non-admin or unavailable */
    }
  }

  async function loadSpotLatest() {
    try {
      const p = await api<{
        dateKey?: string;
        usdIrr?: number | null;
        goldGramRial?: number | null;
      } | null>('/prices/latest');
      setSpotLatest(p);
    } catch {
      /* ignore */
    }
  }

  async function loadTelegramMe() {
    try {
      const s = await api<{
        configured: boolean;
        botNameFa: string;
        botUsername: string;
        deepLink: string | null;
        linked: boolean;
        linkedOnThisAccount?: boolean;
      }>('/telegram/me');
      setTgMe(s);
    } catch {
      /* ignore */
    }
  }

  async function loadTelegramConfig() {
    try {
      const c = await api<{
        botNameFa?: string;
        botUsername?: string;
        enabled?: boolean;
        ttsModel?: string;
        sendHour?: number;
        sendMinute?: number;
        sendWeekdays?: number[];
        hasToken?: boolean;
        linkedCount?: number;
        lastDigest?: {
          dateKey: string;
          sentCount: number;
          failedCount: number;
          skippedReasonFa?: string | null;
        } | null;
      }>('/telegram/config');
      setTgForm({
        botNameFa: c.botNameFa?.trim() || 'سبدیار',
        botUsername: c.botUsername?.trim() || TELEGRAM_BOT_USERNAME,
        botToken: '',
        ttsModel: c.ttsModel?.trim() || 'gemini-2.5-pro-preview-tts',
        sendHour: c.sendHour ?? 8,
        sendMinute: c.sendMinute ?? 30,
        sendWeekdays: c.sendWeekdays?.length ? c.sendWeekdays : [0, 1, 2, 3, 4, 5, 6],
        enabled: c.enabled ?? true,
      });
      setTgMeta({
        hasToken: Boolean(c.hasToken),
        linkedCount: c.linkedCount ?? 0,
        lastDigest: c.lastDigest ?? null,
      });
    } catch {
      /* non-admin */
    }
  }

  async function loadTelegramLinks() {
    try {
      const list = await api<TelegramLink[]>('/telegram/links');
      setTgLinks(list);
    } catch {
      setTgLinks([]);
    }
  }

  async function unlinkTelegramUser(link: TelegramLink) {
    const label = link.name || link.email;
    if (!confirm(`اتصال «${label}» به ربات قطع شود؟ پیام روزانه دیگر برای این نفر نمی‌رود.`)) return;
    setTgBusy(true);
    try {
      await api(`/telegram/links/${link.userId}/unlink`, { method: 'POST' });
      toast.success('اتصال این کاربر به ربات قطع شد.');
      await Promise.all([loadTelegramConfig(), loadTelegramLinks()]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTgBusy(false);
    }
  }

  async function loadMobileLogins() {
    const data = await api<{
      enabled: boolean;
      rows: Array<{
        id: string;
        ip: string | null;
        location: string | null;
        mobilePhone: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/mobile-login/admin');
    setMobileLoginEnabled(data.enabled);
    setMobileLoginRows(data.rows);
  }

  async function loadTradeFees() {
    const data = await api<Record<(typeof FEE_FIELDS)[number]['key'], number>>('/trade-fees');
    setFeeForm({
      stockBuyPct: String(data.stockBuyPct ?? 0),
      stockSellPct: String(data.stockSellPct ?? 0),
      physicalUsdBuyPct: String(data.physicalUsdBuyPct ?? 0),
      physicalUsdSellPct: String(data.physicalUsdSellPct ?? 0),
      physicalGoldBuyPct: String(data.physicalGoldBuyPct ?? 0),
      physicalGoldSellPct: String(data.physicalGoldSellPct ?? 0),
    });
  }

  async function saveTradeFees(e: FormEvent) {
    e.preventDefault();
    setFeeBusy(true);
    try {
      const body = Object.fromEntries(FEE_FIELDS.map((field) => [field.key, parseFeePct(feeForm[field.key])]));
      const saved = await api<Record<(typeof FEE_FIELDS)[number]['key'], number>>('/trade-fees', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setFeeForm({
        stockBuyPct: String(saved.stockBuyPct),
        stockSellPct: String(saved.stockSellPct),
        physicalUsdBuyPct: String(saved.physicalUsdBuyPct),
        physicalUsdSellPct: String(saved.physicalUsdSellPct),
        physicalGoldBuyPct: String(saved.physicalGoldBuyPct),
        physicalGoldSellPct: String(saved.physicalGoldSellPct),
      });
      toast.success('کارمزدها ذخیره شد.');
    } catch (err) {
      toast.error(adminApiErrorText(err));
    } finally {
      setFeeBusy(false);
    }
  }

  async function saveMobileLoginEnabled(enabled: boolean) {
    setMobileLoginBusy(true);
    try {
      const saved = await api<{ enabled: boolean }>('/mobile-login/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      setMobileLoginEnabled(saved.enabled);
      toast.success(saved.enabled ? 'ورود با موبایل روشن شد.' : 'ورود با موبایل خاموش شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setMobileLoginBusy(false);
    }
  }

  async function loadAssistantConfig() {
    try {
      const c = await api<{
        botNameFa?: string;
        botUsername?: string;
        enabled?: boolean;
        hasToken?: boolean;
        deepLink?: string | null;
      }>('/telegram-assistant/config');
      setAssistForm({
        botNameFa: c.botNameFa?.trim() || 'دستیار سبدیار',
        botUsername: c.botUsername?.trim() || '',
        botToken: '',
        enabled: c.enabled ?? true,
      });
      setAssistMeta({
        hasToken: Boolean(c.hasToken),
        deepLink: c.deepLink ?? null,
      });
    } catch {
      /* non-admin */
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{
      email?: string;
      name?: string;
      role?: string;
      profile?: {
        riskTolerance: number;
        horizonMonths: number;
        notes?: string | null;
        investmentPreferencesFa?: string | null;
        constraintsFa?: string | null;
        mobilePhone?: string | null;
        liquidityNeed?: string | null;
        maxDrawdownPct?: number | null;
        inflationSensitivity?: string | null;
        fxSensitivity?: string | null;
        objectiveFa?: string | null;
      };
    }>('/users/me').then((u) => {
      const admin = u.role === 'ADMIN';
      setIsAdmin(admin);
      setEmail(u.email ?? '');
      setProfile({
        name: u.name ?? '',
        riskTolerance: u.profile?.riskTolerance ?? 5,
        horizonMonths: u.profile?.horizonMonths ?? 12,
        notes: u.profile?.notes ?? '',
        investmentPreferencesFa: u.profile?.investmentPreferencesFa ?? '',
        constraintsFa: u.profile?.constraintsFa ?? '',
        mobilePhone: u.profile?.mobilePhone ?? '',
        liquidityNeed: u.profile?.liquidityNeed ?? '',
        maxDrawdownPct: u.profile?.maxDrawdownPct != null ? String(u.profile.maxDrawdownPct) : '',
        inflationSensitivity: u.profile?.inflationSensitivity ?? '',
        fxSensitivity: u.profile?.fxSensitivity ?? '',
        objectiveFa: u.profile?.objectiveFa ?? '',
      });
      loadTelegramMe().catch(() => undefined);
      if (admin) {
        loadSpotConfig().catch(() => undefined);
        loadSpotLatest().catch(() => undefined);
        loadWorldApis().catch(() => undefined);
        loadRefreshTimes().catch(() => undefined);
        loadTelegramConfig().catch(() => undefined);
        loadAssistantConfig().catch(() => undefined);
      }
    });
    api<{
      baseUrl: string;
      model: string;
      usePlatformFallback: boolean;
      hasToken: boolean;
    } | null>('/llm/settings')
      .then((s) => {
        if (!s) return;
        setProvider(detectProvider(s.baseUrl));
        setLlm((prev) => ({
          ...prev,
          baseUrl: s.baseUrl,
          model: s.model,
          usePlatformFallback: s.usePlatformFallback,
          hasToken: s.hasToken,
        }));
      })
      .catch(() => undefined);
    loadFundDefs().catch(() => undefined);
    loadPrompts().catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (tab === 'spotPrices' && isAdmin) {
      loadSpotConfig().catch(() => undefined);
      loadSpotLatest().catch(() => undefined);
    }
    if (tab === 'worldApis' && isAdmin) {
      loadWorldApis().catch(() => undefined);
    }
    if (tab === 'refreshTimes' && isAdmin) {
      loadRefreshTimes().catch(() => undefined);
    }
    if (tab === 'telegram' && isAdmin) {
      loadTelegramConfig().catch(() => undefined);
      loadTelegramLinks().catch(() => undefined);
    }
    if (tab === 'telegramAssistant' && isAdmin) {
      loadAssistantConfig().catch(() => undefined);
    }
    if (tab === 'mobileLogin' && isAdmin) {
      loadMobileLogins().catch(() => undefined);
    }
    if (tab === 'fees' && isAdmin) {
      loadTradeFees().catch(() => undefined);
    }
  }, [tab, isAdmin]);

  async function saveRefreshTimes(e: FormEvent) {
    e.preventDefault();
    setRefreshTimeBusy(true);
    setRefreshTimeFeedback(null);
    try {
      const saved = await api<{
        iranNewsHour: number;
        iranNewsMinute: number;
        worldHour: number;
        worldMinute: number;
        marketHour: number;
        marketMinute: number;
      }>('/news/schedule', {
        method: 'PUT',
        body: JSON.stringify(refreshTimes),
      });
      setRefreshTimes(saved);
      const text = 'ساعت‌های به‌روزرسانی ذخیره شد.';
      setRefreshTimeFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'ذخیره ساعت ناموفق بود.';
      setRefreshTimeFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setRefreshTimeBusy(false);
    }
  }

  async function saveWorldApis(e: FormEvent) {
    e.preventDefault();
    setWorldApiBusy(true);
    setWorldApiFeedback(null);
    try {
      const saved = await api<{ bitpinMarketsUrl: string; yahooQuoteUrl: string }>(
        '/world-markets/source-api',
        {
          method: 'PUT',
          body: JSON.stringify({
            bitpinMarketsUrl: worldApis.bitpinMarketsUrl.trim(),
            yahooQuoteUrl: worldApis.yahooQuoteUrl.trim(),
          }),
        },
      );
      setWorldApis({
        bitpinMarketsUrl: saved.bitpinMarketsUrl,
        yahooQuoteUrl: saved.yahooQuoteUrl,
      });
      const text = 'آدرس API بیت‌پین و یاهو فایننس ذخیره شد.';
      setWorldApiFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'ذخیره آدرس‌ها ناموفق بود.';
      setWorldApiFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setWorldApiBusy(false);
    }
  }

  async function saveSpotConfig(e: FormEvent) {
    e.preventDefault();
    setSpotBusy(true);
    setSpotFeedback(null);
    try {
      const saved = await api<{ uri: string }>('/prices/config', {
        method: 'PUT',
        body: JSON.stringify({ uri: spotUri.trim() }),
      });
      if (saved?.uri) setSpotUri(saved.uri);
      const text = 'آدرس API قیمت با موفقیت ذخیره شد و پاسخ JSON تأیید شد.';
      setSpotFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'ذخیره آدرس ناموفق بود.';
      setSpotFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setSpotBusy(false);
    }
  }

  async function refreshSpotPrices() {
    setSpotBusy(true);
    setSpotFeedback(null);
    try {
      const row = await api<{
        dateKey: string;
        usdIrr?: number | null;
        goldGramRial?: number | null;
      }>('/prices/refresh', { method: 'POST' });
      setSpotLatest(row);
      const parts = [
        row.usdIrr != null ? `دلار ${row.usdIrr.toLocaleString('fa-IR')}` : null,
        row.goldGramRial != null ? `طلا ${row.goldGramRial.toLocaleString('fa-IR')}` : null,
      ].filter(Boolean);
      const text =
        parts.length > 0
          ? `به‌روزرسانی موفق بود (${parts.join(' · ')})`
          : 'به‌روزرسانی موفق بود و قیمت امروز ذخیره شد.';
      setSpotFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'به‌روزرسانی قیمت ناموفق بود.';
      setSpotFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setSpotBusy(false);
    }
  }

  const walletReturnHandled = useRef(false);
  useEffect(() => {
    if (walletReturnHandled.current) return;
    const flag = new URLSearchParams(window.location.search).get('wallet');
    if (flag !== 'ok' && flag !== 'fail') return;
    walletReturnHandled.current = true;
    setTab('wallet');
    if (flag === 'ok') toast.success('کیف پول شارژ شد.');
    else toast.error('پرداخت انجام نشد.');
    window.history.replaceState({}, '', '/settings');
  }, [toast]);

  useEffect(() => {
    if (!isAdmin && tab !== 'profile' && tab !== 'password' && tab !== 'webauthn' && tab !== 'wallet') {
      setTab('profile');
    }
  }, [isAdmin, tab]);

  function applyProvider(next: ProviderId) {
    setProvider(next);
    const p = PROVIDERS[next];
    setLlm((prev) => ({
      ...prev,
      baseUrl: p.baseUrl || prev.baseUrl,
      model: p.model || prev.model,
    }));
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    try {
      await api('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: profile.name,
          riskTolerance: Number(profile.riskTolerance),
          horizonMonths: Number(profile.horizonMonths),
          notes: profile.notes,
          investmentPreferencesFa: profile.investmentPreferencesFa,
          constraintsFa: profile.constraintsFa,
          mobilePhone: profile.mobilePhone,
          liquidityNeed: profile.liquidityNeed || null,
          maxDrawdownPct: Number(profile.maxDrawdownPct) >= 1 ? Number(profile.maxDrawdownPct) : null,
          inflationSensitivity: profile.inflationSensitivity || null,
          fxSensitivity: profile.fxSensitivity || null,
          objectiveFa: profile.objectiveFa || null,
        }),
      });
      toast.success('پروفایل ذخیره شد.');
      loadTelegramMe().catch(() => undefined);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function saveTelegram(e: FormEvent) {
    e.preventDefault();
    if (!tgForm.sendWeekdays.length) {
      const text = 'حداقل یک روز هفته را برای ارسال انتخاب کنید.';
      setTgFeedback({ ok: false, text });
      toast.error(text);
      return;
    }
    setTgBusy(true);
    setTgFeedback(null);
    try {
      await api('/telegram/config', {
        method: 'PUT',
        body: JSON.stringify({
          botNameFa: tgForm.botNameFa.trim(),
          botUsername: tgForm.botUsername.trim().replace(/^@/, ''),
          ttsModel: tgForm.ttsModel.trim(),
          sendHour: tgForm.sendHour,
          sendMinute: tgForm.sendMinute,
          sendWeekdays: tgForm.sendWeekdays,
          enabled: tgForm.enabled,
          ...(tgForm.botToken.trim() ? { botToken: tgForm.botToken.trim() } : {}),
        }),
      });
      setTgForm((p) => ({ ...p, botToken: '' }));
      await loadTelegramConfig();
      await loadTelegramMe();
      const text = 'تنظیمات ربات تلگرام ذخیره شد.';
      setTgFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'ذخیره ربات ناموفق بود.';
      setTgFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setTgBusy(false);
    }
  }

  async function testTelegram() {
    setTgBusy(true);
    setTgFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string; botUsername?: string }>(
        '/telegram/test',
        { method: 'POST' },
      );
      const text = res.messageFa ?? 'اتصال برقرار است.';
      setTgFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = adminApiErrorText(err) || 'تست ربات ناموفق بود.';
      setTgFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setTgBusy(false);
    }
  }

  async function sendTelegramTestMessage() {
    setTgBusy(true);
    setTgFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string }>('/telegram/test-message', {
        method: 'POST',
      });
      const text = res.messageFa ?? 'پیام آزمایشی فرستاده شد.';
      setTgFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = adminApiErrorText(err) || 'ارسال پیام آزمایشی ناموفق بود.';
      setTgFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setTgBusy(false);
    }
  }

  async function sendTelegramToday() {
    setTgBusy(true);
    setTgFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string }>('/telegram/send-today', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      const text = res.messageFa ?? 'ارسال انجام شد.';
      setTgFeedback({ ok: Boolean(res.ok), text });
      if (res.ok) toast.success(text);
      else toast.error(text);
      await loadTelegramConfig();
      if (res.ok) {
        // ارسال در پس‌زمینه ادامه دارد؛ نتیجهٔ «آخرین ارسال» چند لحظه بعد می‌رسد
        for (const delay of [20_000, 60_000, 150_000]) {
          setTimeout(() => {
            void loadTelegramConfig();
          }, delay);
        }
      }
    } catch (err) {
      const text = adminApiErrorText(err) || 'ارسال ناموفق بود.';
      setTgFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setTgBusy(false);
    }
  }

  async function saveAssistant(e: FormEvent) {
    e.preventDefault();
    setAssistBusy(true);
    setAssistFeedback(null);
    try {
      await api('/telegram-assistant/config', {
        method: 'PUT',
        body: JSON.stringify({
          botNameFa: assistForm.botNameFa.trim(),
          botUsername: assistForm.botUsername.trim().replace(/^@/, ''),
          enabled: assistForm.enabled,
          ...(assistForm.botToken.trim() ? { botToken: assistForm.botToken.trim() } : {}),
        }),
      });
      setAssistForm((p) => ({ ...p, botToken: '' }));
      await loadAssistantConfig();
      const text = 'تنظیمات دستیار تلگرام ذخیره شد.';
      setAssistFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'ذخیره دستیار ناموفق بود.';
      setAssistFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setAssistBusy(false);
    }
  }

  async function testAssistant() {
    setAssistBusy(true);
    setAssistFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string; botUsername?: string }>(
        '/telegram-assistant/test',
        { method: 'POST' },
      );
      const text = res.messageFa ?? 'اتصال برقرار است.';
      setAssistFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'تست دستیار ناموفق بود.';
      setAssistFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setAssistBusy(false);
    }
  }

  async function unlinkTelegram() {
    setProfileBusy(true);
    try {
      await api('/telegram/unlink', { method: 'POST' });
      await loadTelegramMe();
      toast.success('اتصال تلگرام قطع شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('رمز عبور جدید و تکرار آن یکسان نیستند.');
      return;
    }
    setPasswordBusy(true);
    try {
      await api('/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('رمز عبور با موفقیت تغییر کرد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  }

  async function saveLlm(e: FormEvent) {
    e.preventDefault();
    setLlmBusy(true);
    try {
      await api('/llm/settings', {
        method: 'PUT',
        body: JSON.stringify({
          baseUrl: llm.baseUrl,
          model: llm.model,
          usePlatformFallback: llm.usePlatformFallback,
          ...(llm.apiToken ? { apiToken: llm.apiToken } : {}),
        }),
      });
      setLlm((prev) => ({ ...prev, apiToken: '', hasToken: prev.hasToken || Boolean(llm.apiToken) }));
      toast.success('تنظیمات LLM ذخیره شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLlmBusy(false);
    }
  }

  async function testLlm() {
    setLlmTestBusy(true);
    setLlmTestResult(null);
    try {
      const res = await api<{
        ok: boolean;
        messageFa?: string;
        error?: string;
        reply?: string;
        model?: string;
        latencyMs?: number;
      }>('/llm/test', {
        method: 'POST',
        body: JSON.stringify({
          baseUrl: llm.baseUrl.trim() || undefined,
          model: llm.model.trim() || undefined,
          ...(llm.apiToken.trim() ? { apiToken: llm.apiToken.trim() } : {}),
        }),
      });
      setLlmTestResult({
        ok: res.ok,
        messageFa: res.messageFa ?? (res.ok ? 'اتصال برقرار است.' : res.error ?? 'تست ناموفق'),
        reply: res.reply,
        model: res.model,
        latencyMs: res.latencyMs,
      });
      if (res.ok) toast.success(res.messageFa ?? 'اتصال LLM برقرار است.');
      else toast.error(res.messageFa ?? res.error ?? 'تست LLM ناموفق بود.');
    } catch (err) {
      const message = (err as Error).message;
      setLlmTestResult({ ok: false, messageFa: message });
      toast.error(message);
    } finally {
      setLlmTestBusy(false);
    }
  }

  async function addFund(e: FormEvent) {
    e.preventDefault();
    if (!newFund.nameFa.trim()) return;
    setFundBusy(true);
    try {
      await api('/funds/definitions', {
        method: 'POST',
        body: JSON.stringify({
          nameFa: newFund.nameFa.trim(),
          symbolCode: newFund.symbolCode.trim() || undefined,
          description: newFund.description.trim() || undefined,
          websiteUrl: newFund.websiteUrl.trim() || undefined,
        }),
      });
      setNewFund({ nameFa: '', symbolCode: '', description: '', websiteUrl: '' });
      await loadFundDefs();
      toast.success('صندوق اضافه شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFundBusy(false);
    }
  }

  async function deactivateFund(id: string, name: string) {
    if (!confirm(`صندوق «${name}» غیرفعال شود؟`)) return;
    setFundBusy(true);
    try {
      await api(`/funds/definitions/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      });
      await loadFundDefs();
      if (editingFund?.id === id) setEditingFund(null);
      toast.success('صندوق غیرفعال شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFundBusy(false);
    }
  }

  async function activateFund(id: string, name: string) {
    if (!confirm(`صندوق «${name}» فعال شود؟`)) return;
    setFundBusy(true);
    try {
      await api(`/funds/definitions/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true }),
      });
      await loadFundDefs();
      toast.success('صندوق فعال شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFundBusy(false);
    }
  }

  function openEditFund(fund: FundDefinition) {
    setEditingFund(fund);
    setEditFundForm({
      nameFa: fund.nameFa,
      symbolCode: fund.symbolCode ?? '',
      description: fund.description ?? '',
      websiteUrl: fund.websiteUrl ?? '',
    });
  }

  async function saveEditFund(e: FormEvent) {
    e.preventDefault();
    if (!editingFund) return;
    setFundBusy(true);
    try {
      await api(`/funds/definitions/${editingFund.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nameFa: editFundForm.nameFa.trim(),
          symbolCode: editFundForm.symbolCode.trim() || undefined,
          description: editFundForm.description.trim() || undefined,
          websiteUrl: editFundForm.websiteUrl.trim(),
        }),
      });
      await loadFundDefs();
      setEditingFund(null);
      toast.success('صندوق به‌روز شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFundBusy(false);
    }
  }

  function updatePromptText(purpose: string, systemPrompt: string) {
    setPrompts((prev) => prev.map((p) => (p.purpose === purpose ? { ...p, systemPrompt } : p)));
  }

  async function savePrompt(purpose: string) {
    const p = prompts.find((x) => x.purpose === purpose);
    if (!p) return;
    setPromptBusy(purpose);
    try {
      await api(`/llm/prompts/${purpose}`, {
        method: 'PUT',
        body: JSON.stringify({ systemPrompt: p.systemPrompt }),
      });
      await loadPrompts();
      toast.success(`پرامپت «${p.labelFa}» ذخیره شد.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPromptBusy('');
    }
  }

  async function resetPrompt(purpose: string) {
    const p = prompts.find((x) => x.purpose === purpose);
    if (!p || !confirm(`پرامپت «${p.labelFa}» به پیش‌فرض برگردد؟`)) return;
    setPromptBusy(purpose);
    try {
      await api(`/llm/prompts/${purpose}`, { method: 'DELETE' });
      await loadPrompts();
      toast.success(`پرامپت «${p.labelFa}» بازنشانی شد.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPromptBusy('');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">تنظیمات</h1>
        <p className="mt-2 text-navy-800/70">پروفایل، کیف پول، ورود زیست‌سنجی، پرامپت‌ها، صندوق‌ها، اتصال مدل زبانی، ربات و دستیار تلگرام</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-navy-900/10 bg-white p-1.5 lg:w-56 lg:flex-col lg:overflow-visible"
          aria-label="بخش‌های تنظیمات"
        >
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                'whitespace-nowrap rounded-lg px-3 py-2.5 text-start text-sm font-medium transition',
                tab === t.id
                  ? 'bg-navy-900 text-white shadow-sm'
                  : 'text-navy-800/65 hover:bg-navy-50 hover:text-navy-900',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
      {tab === 'profile' && (
        <div className="space-y-6">
          <section className="card max-w-2xl space-y-4">
            <h2 className="text-lg font-semibold">حساب کاربری</h2>
            <div>
              <label className="label">نام کاربری</label>
              <input className="input bg-navy-50/80" value={email} readOnly dir="ltr" />
            </div>
          </section>

          <form onSubmit={saveProfile} className="card grid max-w-2xl gap-4">
            <h2 className="text-lg font-semibold">پروفایل سرمایه‌گذاری</h2>
            <div>
              <label className="label">نام نمایشی</label>
              <input
                className="input"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">موبایل (برای پیام تلگرام)</label>
              <input
                className="input"
                value={profile.mobilePhone}
                onChange={(e) => setProfile({ ...profile, mobilePhone: e.target.value })}
                placeholder="09121234567"
                dir="ltr"
                inputMode="tel"
              />
              <p className="mt-1 text-xs text-navy-800/55">
                با ثبت موبایل، خلاصه فقط در روز و ساعتی که مدیر برای ربات گذاشته می‌رسد، و فقط وقتی که ربات تلگرام را با همین شماره
                وصل کرده باشید. لینک ربات:
              </p>
              <p className="mt-1 text-xs">
                <TelegramBotLink />
              </p>
            </div>
            <div>
              <label className="label">تحمل ریسک (۱–۱۰)</label>
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                value={profile.riskTolerance}
                onChange={(e) => setProfile({ ...profile, riskTolerance: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">افق سرمایه‌گذاری (ماه)</label>
              <input
                className="input"
                type="number"
                min={1}
                value={profile.horizonMonths}
                onChange={(e) => setProfile({ ...profile, horizonMonths: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">نیاز به نقدشوندگی</label>
              <select
                className="input"
                value={profile.liquidityNeed}
                onChange={(e) => setProfile({ ...profile, liquidityNeed: e.target.value })}
              >
                <option value="">اعلام نشده</option>
                <option value="LOW">کم</option>
                <option value="MEDIUM">متوسط</option>
                <option value="HIGH">زیاد</option>
              </select>
            </div>
            <div>
              <label className="label">حداکثر افت قابل قبول (درصد)</label>
              <input
                className="input"
                dir="ltr"
                inputMode="numeric"
                value={profile.maxDrawdownPct}
                onChange={(e) => setProfile({ ...profile, maxDrawdownPct: e.target.value.replace(/[^\d]/g, '') })}
              />
            </div>
            <div>
              <label className="label">حساسیت به تورم</label>
              <select
                className="input"
                value={profile.inflationSensitivity}
                onChange={(e) => setProfile({ ...profile, inflationSensitivity: e.target.value })}
              >
                <option value="">اعلام نشده</option>
                <option value="LOW">کم</option>
                <option value="MEDIUM">متوسط</option>
                <option value="HIGH">زیاد</option>
              </select>
            </div>
            <div>
              <label className="label">حساسیت به ارز</label>
              <select
                className="input"
                value={profile.fxSensitivity}
                onChange={(e) => setProfile({ ...profile, fxSensitivity: e.target.value })}
              >
                <option value="">اعلام نشده</option>
                <option value="LOW">کم</option>
                <option value="MEDIUM">متوسط</option>
                <option value="HIGH">زیاد</option>
              </select>
            </div>
            <div>
              <label className="label">هدف سرمایه‌گذاری</label>
              <input
                className="input"
                value={profile.objectiveFa}
                maxLength={300}
                onChange={(e) => setProfile({ ...profile, objectiveFa: e.target.value })}
              />
            </div>
            <div>
              <label className="label">علاقه‌مندی‌های سرمایه‌گذاری</label>
              <textarea
                className="input min-h-[5rem]"
                value={profile.investmentPreferencesFa}
                onChange={(e) => setProfile({ ...profile, investmentPreferencesFa: e.target.value })}
                placeholder="مثلاً تمایل به سهام صنعتی، اجتناب از نمادهای پرنوسان..."
              />
            </div>
            <div>
              <label className="label">محدودیت‌ها</label>
              <textarea
                className="input min-h-[5rem]"
                value={profile.constraintsFa}
                onChange={(e) => setProfile({ ...profile, constraintsFa: e.target.value })}
                placeholder="مثلاً بدون اهرم، حداکثر ۲۰٪ طلا، عدم سرمایه‌گذاری در بانک‌ها..."
              />
            </div>
            <button className="btn-primary w-fit" disabled={profileBusy}>
              {profileBusy ? 'در حال ذخیره...' : 'ذخیره پروفایل'}
            </button>
          </form>

          <section className="card max-w-2xl space-y-3">
            <h2 className="text-lg font-semibold">پیام تلگرام</h2>
            <p className="text-sm leading-7 text-navy-800/75">
              ۱. موبایل را در همین صفحه ذخیره کنید.
              <br />
              ۲. ربات را در تلگرام باز کنید، /start بزنید و همان شماره را بفرستید.
              <br />
              در روزها و ساعتی که مدیر برای ربات مشخص کرده، نمودار سبد، پیشنهاد بهبود، اخبار و فرصت‌های سرمایه‌گذاری به‌صورت متن و فایل صوتی فارسی با صدای زن (حداکثر حدود دو دقیقه) می‌آید.
            </p>
            <p className="text-sm">
              لینک ربات:
              <br />
              <TelegramBotLink />
            </p>
            {isAdmin && tgMe && !tgMe.configured && (
              <p className="text-sm text-navy-800/70">
                ارسال خودکار بعد از ذخیرهٔ توکن و انتخاب روز و ساعت، در تب ربات تلگرام فعال می‌شود.
              </p>
            )}
            {tgMe && (
              <>
                <p className="text-sm">
                  وضعیت اتصال:{' '}
                  <strong>{tgMe.linked ? 'وصل شده' : 'هنوز وصل نشده'}</strong>
                </p>
                {tgMe.linked && tgMe.linkedOnThisAccount === false && (
                  <p className="text-sm leading-7 text-navy-800/70">
                    همین شماره در حساب دیگری به ربات وصل است. پیام آزمایشی به همان چت تلگرام می‌رود.
                  </p>
                )}
                {tgMe.linked && (
                  <button
                    type="button"
                    className="btn-secondary w-fit"
                    disabled={profileBusy}
                    onClick={unlinkTelegram}
                  >
                    قطع اتصال تلگرام
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'password' && (
        <form onSubmit={savePassword} className="card grid max-w-2xl gap-4">
          <h2 className="text-lg font-semibold">تغییر رمز عبور</h2>
          <div>
            <label className="label">رمز عبور فعلی</label>
            <input
              className="input"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
              }
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">رمز عبور جدید</label>
            <input
              className="input"
              type="password"
              minLength={6}
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              required
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">تکرار رمز عبور جدید</label>
            <input
              className="input"
              type="password"
              minLength={6}
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
              }
              required
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn-primary w-fit" disabled={passwordBusy}>
            {passwordBusy ? 'در حال ذخیره...' : 'تغییر رمز عبور'}
          </button>
        </form>
      )}

      {tab === 'webauthn' && <WebAuthnSettings />}

      {tab === 'wallet' && <WalletPanel />}

      {tab === 'walletAdmin' && isAdmin && <WalletAdminPanel />}

      {tab === 'funds' && isAdmin && (
        <section className="space-y-4">
          <p className="text-sm text-navy-800/70">
            نام صندوق‌ها را اینجا تعریف و مدیریت کنید؛ در صفحه صندوق‌ها فقط موارد فعال در لیست انتخاب
            می‌شوند.
          </p>

          <div className="card overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-navy-900 text-white">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">نام صندوق</th>
                  <th className="px-4 py-3 text-start font-medium">کد / نماد</th>
                  <th className="px-4 py-3 text-start font-medium">سایت</th>
                  <th className="px-4 py-3 text-start font-medium">وضعیت</th>
                  <th className="px-4 py-3 text-start font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {fundDefs.map((f) => (
                  <tr
                    key={f.id}
                    className={clsx(
                      'border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40',
                      !f.isActive && 'opacity-60',
                    )}
                  >
                    <td className="px-4 py-3 font-medium">{f.nameFa}</td>
                    <td className="px-4 py-3 text-navy-800/70">{f.symbolCode || '—'}</td>
                    <td className="px-4 py-3 text-navy-800/70">
                      {f.websiteUrl ? (
                        <a
                          href={f.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-navy-800 underline"
                          dir="ltr"
                        >
                          {f.websiteUrl.replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'rounded-full px-2.5 py-0.5 text-xs font-medium',
                          f.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
                        )}
                      >
                        {f.isActive ? 'فعال' : 'غیرفعال'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-xs text-navy-800 hover:underline"
                          onClick={() => openEditFund(f)}
                          disabled={fundBusy}
                        >
                          ویرایش
                        </button>
                        {f.isActive ? (
                          <button
                            type="button"
                            className="text-xs text-red-700 hover:underline"
                            onClick={() => deactivateFund(f.id, f.nameFa)}
                            disabled={fundBusy}
                          >
                            غیرفعال
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs text-emerald-700 hover:underline"
                            onClick={() => activateFund(f.id, f.nameFa)}
                            disabled={fundBusy}
                          >
                            فعال‌سازی
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fundDefs.length === 0 && (
              <p className="p-6 text-sm text-navy-800/60">هنوز صندوقی تعریف نشده.</p>
            )}
          </div>

          {editingFund && (
            <form onSubmit={saveEditFund} className="card grid max-w-2xl gap-4">
              <h2 className="text-lg font-semibold">ویرایش صندوق</h2>
              <div>
                <label className="label">نام صندوق</label>
                <input
                  className="input"
                  value={editFundForm.nameFa}
                  onChange={(e) => setEditFundForm({ ...editFundForm, nameFa: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">کد / نماد (اختیاری)</label>
                <input
                  className="input"
                  value={editFundForm.symbolCode}
                  onChange={(e) => setEditFundForm({ ...editFundForm, symbolCode: e.target.value })}
                />
              </div>
              <div>
                <label className="label">سایت (اختیاری)</label>
                <input
                  className="input"
                  type="text"
                  inputMode="url"
                  dir="ltr"
                  placeholder="https://"
                  value={editFundForm.websiteUrl}
                  onChange={(e) => setEditFundForm({ ...editFundForm, websiteUrl: e.target.value })}
                />
              </div>
              <div>
                <label className="label">توضیحات (اختیاری)</label>
                <textarea
                  className="input min-h-[4rem]"
                  value={editFundForm.description}
                  onChange={(e) => setEditFundForm({ ...editFundForm, description: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={fundBusy}>
                  {fundBusy ? '...' : 'ذخیره'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingFund(null)}
                >
                  انصراف
                </button>
              </div>
            </form>
          )}

          <form onSubmit={addFund} className="card grid max-w-2xl gap-4">
            <h2 className="text-lg font-semibold">افزودن صندوق</h2>
            <div>
              <label className="label">نام صندوق</label>
              <input
                className="input"
                value={newFund.nameFa}
                onChange={(e) => setNewFund({ ...newFund, nameFa: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">کد / نماد (اختیاری)</label>
              <input
                className="input"
                value={newFund.symbolCode}
                onChange={(e) => setNewFund({ ...newFund, symbolCode: e.target.value })}
              />
            </div>
            <div>
              <label className="label">سایت (اختیاری)</label>
              <input
                className="input"
                type="text"
                inputMode="url"
                dir="ltr"
                placeholder="https://"
                value={newFund.websiteUrl}
                onChange={(e) => setNewFund({ ...newFund, websiteUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="label">توضیحات (اختیاری)</label>
              <textarea
                className="input min-h-[4rem]"
                value={newFund.description}
                onChange={(e) => setNewFund({ ...newFund, description: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-secondary w-fit" disabled={fundBusy}>
              افزودن صندوق
            </button>
          </form>
        </section>
      )}

      {tab === 'prompts' && isAdmin && (
        <section className="card max-w-3xl space-y-4">
          <p className="text-sm text-navy-800/70">
            متن system هر بخش نرم‌افزار را ویرایش کنید. پس از ذخیره، همان پرامپت به مدل ارسال می‌شود.
          </p>
          <div className="space-y-3">
            {prompts.map((p) => {
              const isOpen = openPrompt === p.purpose;
              return (
                <div key={p.purpose} className="rounded-lg border border-navy-900/10">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
                    onClick={() => setOpenPrompt(isOpen ? null : p.purpose)}
                  >
                    <div>
                      <div className="font-medium">{p.labelFa}</div>
                      <div className="text-xs text-navy-800/55">{p.descriptionFa}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {p.isCustom && (
                        <span className="rounded bg-gold-400/20 px-2 py-0.5 text-gold-600">سفارشی</span>
                      )}
                      <span className="text-navy-800/40">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t border-navy-900/10 px-4 py-3">
                      <div>
                        <label className="label">شناسه</label>
                        <input className="input font-mono text-xs" value={p.purpose} readOnly dir="ltr" />
                      </div>
                      <div>
                        <label className="label">پرامپت system</label>
                        <textarea
                          className="input min-h-[12rem] font-mono text-xs leading-6"
                          value={p.systemPrompt}
                          onChange={(e) => updatePromptText(p.purpose, e.target.value)}
                          dir="auto"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={promptBusy === p.purpose}
                          onClick={() => savePrompt(p.purpose)}
                        >
                          {promptBusy === p.purpose ? '...' : 'ذخیره پرامپت'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={promptBusy === p.purpose}
                          onClick={() => resetPrompt(p.purpose)}
                        >
                          بازگشت به پیش‌فرض
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'llm' && isAdmin && (
        <form onSubmit={saveLlm} className="card grid max-w-2xl gap-4">
          <p className="rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800/80">
            اشتراک Cursor API عمومی برای اپلیکیشن‌های بیرونی ندارد؛ فقط داخل IDE کار می‌کند. برای پیپ از
            OpenRouter، OpenAI یا هر سرویس سازگار با OpenAI استفاده کنید.
          </p>

          <div>
            <label className="label">ارائه‌دهنده</label>
            <select
              className="input"
              value={provider}
              onChange={(e) => applyProvider(e.target.value as ProviderId)}
            >
              {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-navy-800/55">{PROVIDERS[provider].hint}</p>
          </div>

          <div>
            <label className="label">Base URL</label>
            <input
              className="input"
              value={llm.baseUrl}
              onChange={(e) => {
                const baseUrl = e.target.value;
                setLlm({ ...llm, baseUrl });
                setProvider(detectProvider(baseUrl));
              }}
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">مدل (چندتایی با ویرگول = جایگزین خودکار)</label>
            <input
              className="input"
              value={llm.model}
              onChange={(e) => setLlm({ ...llm, model: e.target.value })}
              dir="ltr"
              placeholder="model-a:free, model-b:free"
            />
          </div>
          <div>
            <label className="label">API Token</label>
            <input
              className="input"
              type="password"
              value={llm.apiToken}
              onChange={(e) => setLlm({ ...llm, apiToken: e.target.value })}
              placeholder={llm.hasToken ? 'برای جایگزینی توکن جدید وارد کنید' : 'sk-...'}
              dir="ltr"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={llm.usePlatformFallback}
              onChange={(e) => setLlm({ ...llm, usePlatformFallback: e.target.checked })}
            />
            در صورت نبود توکن شخصی، از کلید پلتفرم استفاده شود
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary w-fit" disabled={llmBusy || llmTestBusy}>
              {llmBusy ? 'در حال ذخیره...' : 'ذخیره LLM'}
            </button>
            <button
              type="button"
              className="btn-secondary w-fit"
              disabled={llmTestBusy}
              onClick={testLlm}
            >
              {llmTestBusy ? 'در حال تست...' : 'تست LLM'}
            </button>
          </div>
          {llmTestResult && (
            <div
              className={`rounded-lg px-3 py-3 text-sm leading-7 ${
                llmTestResult.ok
                  ? 'bg-emerald-50 text-emerald-900'
                  : 'bg-red-50 text-red-800'
              }`}
            >
              <p className="font-medium">{llmTestResult.messageFa}</p>
              {llmTestResult.ok && (
                <ul className="mt-2 space-y-1 text-xs opacity-90">
                  {llmTestResult.model && (
                    <li>
                      مدل:{' '}
                      <span className="font-mono" dir="ltr">
                        {llmTestResult.model}
                      </span>
                    </li>
                  )}
                  {llmTestResult.latencyMs != null && (
                    <li>
                      زمان پاسخ: {llmTestResult.latencyMs.toLocaleString('fa-IR')} میلی‌ثانیه
                    </li>
                  )}
                  {llmTestResult.reply && (
                    <li>
                      پاسخ مدل:{' '}
                      <span className="font-mono" dir="ltr">
                        {llmTestResult.reply}
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </form>
      )}

      {tab === 'spotPrices' && isAdmin && (
        <form onSubmit={saveSpotConfig} className="card grid max-w-2xl gap-4">
          <p className="text-sm leading-7 text-navy-800/75">
            منبع پیش‌فرض روزانه بیت‌پین است (تتر برای دلار آزاد، انس طلای دیجیتال برای گرم ۱۸ عیار).
            آدرس زیر فقط اگر بخواهید منبع دیگری بگذارید لازم است.
          </p>
          <div>
            <label className="label">آدرس API جایگزین (اختیاری)</label>
            <input
              className="input"
              value={spotUri}
              onChange={(e) => setSpotUri(e.target.value)}
              placeholder="https://api.bitpin.ir/v1/mkt/markets/"
              dir="ltr"
            />
          </div>
          {spotLatest && (
            <div className="rounded-lg border border-navy-100 bg-white px-3 py-3 text-sm text-navy-800/80">
              <div>آخرین ذخیره: {formatShamsiDate(spotLatest.dateKey)}</div>
              <div className="mt-1">
                دلار:{' '}
                {spotLatest.usdIrr != null
                  ? spotLatest.usdIrr.toLocaleString('fa-IR')
                  : '—'}{' '}
                ریال
              </div>
              <div className="mt-1">
                طلا (گرم):{' '}
                {spotLatest.goldGramRial != null
                  ? spotLatest.goldGramRial.toLocaleString('fa-IR')
                  : '—'}{' '}
                ریال
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary w-fit" disabled={spotBusy}>
              {spotBusy ? 'در حال ذخیره...' : 'ذخیره آدرس'}
            </button>
            <button
              type="button"
              className="btn-secondary w-fit"
              disabled={spotBusy}
              onClick={refreshSpotPrices}
            >
              {spotBusy ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی الان'}
            </button>
          </div>
          {spotFeedback && (
            <div
              className={clsx(
                'rounded-lg px-3 py-3 text-sm leading-7',
                spotFeedback.ok
                  ? 'bg-emerald-50 text-emerald-900'
                  : 'bg-red-50 text-red-800',
              )}
              role={spotFeedback.ok ? 'status' : 'alert'}
            >
              {spotFeedback.ok ? '✓ ' : '! '}
              {spotFeedback.text}
            </div>
          )}
        </form>
      )}

      {tab === 'worldApis' && isAdmin && (
        <form onSubmit={saveWorldApis} className="card grid max-w-2xl gap-4">
          <p className="text-sm leading-7 text-navy-800/75">
            این دو نشانی برای فهرست بازار بیت‌پین و قیمت جهانی یاهو فایننس استفاده می‌شوند. اگر عوض
            شوند، همگام‌سازی بعدی اقتصاد دنیا و قیمت دلار و طلا از بیت‌پین همان آدرس تازه را می‌خواند.
          </p>
          <div>
            <label className="label">آدرس API بیت‌پین</label>
            <input
              className="input"
              value={worldApis.bitpinMarketsUrl}
              onChange={(e) => setWorldApis({ ...worldApis, bitpinMarketsUrl: e.target.value })}
              placeholder="https://api.bitpin.ir/v1/mkt/markets/"
              dir="ltr"
              required
            />
          </div>
          <div>
            <label className="label">آدرس API یاهو فایننس</label>
            <input
              className="input"
              value={worldApis.yahooQuoteUrl}
              onChange={(e) => setWorldApis({ ...worldApis, yahooQuoteUrl: e.target.value })}
              placeholder="https://query1.finance.yahoo.com/v7/finance/quote"
              dir="ltr"
              required
            />
          </div>
          <button type="submit" className="btn-primary w-fit" disabled={worldApiBusy}>
            {worldApiBusy ? 'در حال ذخیره...' : 'ذخیره آدرس‌ها'}
          </button>
          {worldApiFeedback && (
            <div
              className={clsx(
                'rounded-lg px-3 py-3 text-sm leading-7',
                worldApiFeedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
              )}
              role={worldApiFeedback.ok ? 'status' : 'alert'}
            >
              {worldApiFeedback.ok ? '✓ ' : '! '}
              {worldApiFeedback.text}
            </div>
          )}
        </form>
      )}

      {tab === 'refreshTimes' && isAdmin && (
        <form onSubmit={saveRefreshTimes} className="card grid max-w-2xl gap-4">
          <p className="text-sm leading-7 text-navy-800/75">
            ساعت‌ها به وقت تهران است. اگر در همان روز خبر، اقتصاد دنیا یا بازار سهام خالی بماند، یک ساعت و دو ساعت
            بعد دوباره تلاش می‌شود.
          </p>
          <div>
            <label className="label">ساعت اخبار ایران</label>
            <input
              className="input max-w-[10rem]"
              type="time"
              dir="ltr"
              value={clockValue(refreshTimes.iranNewsHour, refreshTimes.iranNewsMinute)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!Number.isInteger(h) || !Number.isInteger(m)) return;
                setRefreshTimes({ ...refreshTimes, iranNewsHour: h, iranNewsMinute: m });
              }}
            />
          </div>
          <div>
            <label className="label">ساعت اقتصاد دنیا</label>
            <input
              className="input max-w-[10rem]"
              type="time"
              dir="ltr"
              value={clockValue(refreshTimes.worldHour, refreshTimes.worldMinute)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!Number.isInteger(h) || !Number.isInteger(m)) return;
                setRefreshTimes({ ...refreshTimes, worldHour: h, worldMinute: m });
              }}
            />
          </div>
          <div>
            <label className="label">ساعت بازار سهام ایران</label>
            <input
              className="input max-w-[10rem]"
              type="time"
              dir="ltr"
              value={clockValue(refreshTimes.marketHour, refreshTimes.marketMinute)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!Number.isInteger(h) || !Number.isInteger(m)) return;
                setRefreshTimes({ ...refreshTimes, marketHour: h, marketMinute: m });
              }}
            />
          </div>
          <button type="submit" className="btn-primary w-fit" disabled={refreshTimeBusy}>
            {refreshTimeBusy ? 'در حال ذخیره...' : 'ذخیره ساعت‌ها'}
          </button>
          {refreshTimeFeedback && (
            <div
              className={clsx(
                'rounded-lg px-3 py-3 text-sm leading-7',
                refreshTimeFeedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
              )}
              role={refreshTimeFeedback.ok ? 'status' : 'alert'}
            >
              {refreshTimeFeedback.ok ? '✓ ' : '! '}
              {refreshTimeFeedback.text}
            </div>
          )}
        </form>
      )}

      {tab === 'telegram' && isAdmin && (
        <form onSubmit={saveTelegram} className="card grid max-w-2xl gap-4">
          <p className="text-sm leading-7 text-navy-800/75">
            ربات عمومی سبدیار همین است:
            <br />
            <TelegramBotLink />
            <br />
            نام کاربری پیش‌فرض را عوض نکنید مگر ربات دیگری می‌سازید. توکن را از BotFather بگیرید و
            ذخیره کنید. سرویس API باید روشن بماند تا در روز و ساعت انتخاب‌شده پیام برود. اخبار و فرصت‌ها هم به‌صورت فایل صوتی فارسی با صدای زن (حداکثر حدود دو دقیقه) فرستاده می‌شود. کاربر باید موبایل را در
            پروفایل ثبت کند و ربات را استارت کند؛ تلگرام با شماره به‌تنهایی پیام نمی‌فرستد.
          </p>
          <div>
            <label className="label">نام ربات (برای متن پیام)</label>
            <input
              className="input"
              value={tgForm.botNameFa}
              onChange={(e) => setTgForm({ ...tgForm, botNameFa: e.target.value })}
              placeholder="سبدیار"
            />
          </div>
          <div>
            <label className="label">نام کاربری ربات (بدون @)</label>
            <input
              className="input"
              value={tgForm.botUsername}
              onChange={(e) => setTgForm({ ...tgForm, botUsername: e.target.value })}
              placeholder={TELEGRAM_BOT_USERNAME}
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">توکن ربات</label>
            <input
              className="input"
              type="password"
              value={tgForm.botToken}
              onChange={(e) => setTgForm({ ...tgForm, botToken: e.target.value })}
              placeholder={tgMeta.hasToken ? 'برای جایگزینی توکن جدید وارد کنید' : 'از BotFather'}
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">مدل متن به صدا</label>
            <input
              className="input"
              value={tgForm.ttsModel}
              onChange={(e) => setTgForm({ ...tgForm, ttsModel: e.target.value })}
              placeholder="gemini-2.5-pro-preview-tts"
              dir="ltr"
              spellCheck={false}
            />
            <p className="mt-1 text-xs leading-6 text-navy-800/55">
              همین نام برای ساخت فایل صوتی اخبار روزانه استفاده می‌شود. اگر نشانی مدل زبانی گپ‌جی‌پی‌تی باشد، مدل Gemini فرستاده نمی‌شود و به‌جای آن مدل سازگار همان سرویس با صدای زنانه می‌رود.
            </p>
          </div>
          <div>
            <label className="label">ساعت ارسال (تهران)</label>
            <input
              className="input max-w-[10rem]"
              type="time"
              value={clockValue(tgForm.sendHour, tgForm.sendMinute)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!Number.isInteger(h) || !Number.isInteger(m)) return;
                setTgForm({ ...tgForm, sendHour: h, sendMinute: m });
              }}
              dir="ltr"
            />
          </div>
          <fieldset>
            <legend className="label">روزهای ارسال</legend>
            <div className="flex flex-wrap gap-2">
              {SEND_WEEKDAYS.map((day) => {
                const on = tgForm.sendWeekdays.includes(day.id);
                return (
                  <label
                    key={day.id}
                    className={clsx(
                      'cursor-pointer rounded-full border px-3 py-1.5 text-sm',
                      on
                        ? 'border-navy-900 bg-navy-900 text-white'
                        : 'border-navy-900/15 bg-white text-navy-800',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        const sendWeekdays = on
                          ? tgForm.sendWeekdays.filter((id) => id !== day.id)
                          : [...tgForm.sendWeekdays, day.id];
                        setTgForm({ ...tgForm, sendWeekdays });
                      }}
                    />
                    {day.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tgForm.enabled}
              onChange={(e) => setTgForm({ ...tgForm, enabled: e.target.checked })}
            />
            ارسال خودکار در روزها و ساعت انتخاب‌شده فعال باشد
          </label>
          <div className="rounded-lg border border-navy-100 bg-white px-3 py-3 text-sm text-navy-800/80">
            <div>توکن ذخیره شده: {tgMeta.hasToken ? 'بله' : 'خیر'}</div>
            <div className="mt-1">
              کاربران وصل‌شده:{' '}
              {tgMeta.linkedCount.toLocaleString('fa-IR')}
            </div>
            {tgMeta.lastDigest && (
              <div className="mt-1">
                آخرین ارسال: {formatShamsiDate(tgMeta.lastDigest.dateKey)} — موفق{' '}
                {tgMeta.lastDigest.sentCount.toLocaleString('fa-IR')}
                {tgMeta.lastDigest.skippedReasonFa
                  ? ` — ${tgMeta.lastDigest.skippedReasonFa}`
                  : ''}
              </div>
            )}
          </div>
          <p className="text-xs leading-6 text-navy-800/60">
            «تست پیام به موبایل من» فقط به تلگرام وصل‌شده با شماره موبایل همین حساب مدیر می‌رود. کاربران دیگر این پیام را نمی‌گیرند و ارسال روزانهٔ همه عوض نمی‌شود.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary w-fit" disabled={tgBusy}>
              {tgBusy ? 'در حال ذخیره...' : 'ذخیره ربات'}
            </button>
            <button
              type="button"
              className="btn-secondary w-fit"
              disabled={tgBusy || !tgMeta.hasToken}
              onClick={testTelegram}
            >
              تست اتصال
            </button>
            <button
              type="button"
              className="btn-secondary w-fit"
              disabled={tgBusy || !tgMeta.hasToken}
              onClick={sendTelegramTestMessage}
            >
              تست پیام به موبایل من
            </button>
            <button
              type="button"
              className="btn-secondary w-fit"
              disabled={tgBusy || !tgMeta.hasToken}
              onClick={sendTelegramToday}
            >
              ارسال خلاصهٔ امروز
            </button>
          </div>
          {tgFeedback && (
            <div
              className={clsx(
                'whitespace-pre-wrap break-words rounded-lg px-3 py-3 text-sm leading-7',
                tgFeedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
              )}
              role={tgFeedback.ok ? 'status' : 'alert'}
            >
              {tgFeedback.ok ? '✓ ' : '! '}
              {tgFeedback.text}
            </div>
          )}
        </form>
      )}

      {tab === 'telegram' && isAdmin && (
        <section className="card max-w-4xl overflow-x-auto p-0">
          <div className="px-4 py-4">
            <h2 className="text-lg font-semibold">کاربران وصل‌شده به ربات</h2>
            <p className="mt-1 text-sm leading-7 text-navy-800/70">
              قطع اتصال فقط دریافت پیام روزانه را برای همان نفر متوقف می‌کند. حساب سایت حذف نمی‌شود.
            </p>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="px-4 py-3 text-start font-medium">نام</th>
                <th className="px-4 py-3 text-start font-medium">نام کاربری</th>
                <th className="px-4 py-3 text-start font-medium">موبایل</th>
                <th className="px-4 py-3 text-start font-medium">تلگرام</th>
                <th className="px-4 py-3 text-start font-medium">تاریخ اتصال</th>
                <th className="px-4 py-3 text-start font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {tgLinks.map((link) => (
                <tr key={link.userId} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                  <td className="px-4 py-3 font-medium">{link.name || '—'}</td>
                  <td className="px-4 py-3">{link.email}</td>
                  <td className="px-4 py-3" dir="ltr">
                    {link.mobilePhone || '—'}
                  </td>
                  <td className="px-4 py-3" dir="ltr">
                    {link.telegramUsername ? `@${link.telegramUsername}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-navy-800/70">
                    {link.telegramLinkedAt ? formatShamsiDate(link.telegramLinkedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      disabled={tgBusy}
                      onClick={() => unlinkTelegramUser(link)}
                    >
                      قطع اتصال
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tgLinks.length === 0 && (
            <p className="p-6 text-sm text-navy-800/60">کسی به ربات وصل نیست.</p>
          )}
        </section>
      )}

      {tab === 'telegramAssistant' && isAdmin && (
        <form onSubmit={saveAssistant} className="card grid max-w-2xl gap-4">
          <p className="text-sm leading-7 text-navy-800/75">
            این ربات دوطرفه است و با ربات یک‌طرفهٔ خلاصهٔ صبح فرق دارد. توکن جدا از BotFather بسازید.
            سؤال را به فارسی جواب می‌دهد، لینک صفحه را ترجمه یا خلاصه می‌کند، PDF را به PDF فارسی راست‌چین
            برمی‌گرداند، و لینک یوتیوب را به متن و فایل صوتی فارسی تبدیل می‌کند. کارهای طولانی با پیام صبر همراه است.
          </p>
          {assistMeta.deepLink && (
            <p className="text-sm">
              لینک ربات:
              <br />
              <a className="font-mono underline" href={assistMeta.deepLink} target="_blank" rel="noreferrer" dir="ltr">
                {assistMeta.deepLink}
              </a>
            </p>
          )}
          <div>
            <label className="label">نام ربات</label>
            <input
              className="input"
              value={assistForm.botNameFa}
              onChange={(e) => setAssistForm({ ...assistForm, botNameFa: e.target.value })}
              placeholder="دستیار سبدیار"
            />
          </div>
          <div>
            <label className="label">نام کاربری ربات (بدون @)</label>
            <input
              className="input"
              value={assistForm.botUsername}
              onChange={(e) => setAssistForm({ ...assistForm, botUsername: e.target.value })}
              placeholder="my_assistant_bot"
              dir="ltr"
            />
          </div>
          <div>
            <label className="label">توکن ربات</label>
            <input
              className="input"
              type="password"
              value={assistForm.botToken}
              onChange={(e) => setAssistForm({ ...assistForm, botToken: e.target.value })}
              placeholder={assistMeta.hasToken ? 'برای جایگزینی توکن جدید وارد کنید' : 'از BotFather'}
              dir="ltr"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={assistForm.enabled}
              onChange={(e) => setAssistForm({ ...assistForm, enabled: e.target.checked })}
            />
            دستیار فعال باشد و به پیام‌ها جواب بدهد
          </label>
          <div className="rounded-lg border border-navy-100 bg-white px-3 py-3 text-sm text-navy-800/80">
            توکن ذخیره شده: {assistMeta.hasToken ? 'بله' : 'خیر'}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary w-fit" disabled={assistBusy}>
              {assistBusy ? 'در حال ذخیره...' : 'ذخیره دستیار'}
            </button>
            <button
              type="button"
              className="btn-secondary w-fit"
              disabled={assistBusy || !assistMeta.hasToken}
              onClick={testAssistant}
            >
              تست اتصال
            </button>
          </div>
          {assistFeedback && (
            <div
              className={clsx(
                'rounded-lg px-3 py-3 text-sm leading-7',
                assistFeedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
              )}
              role={assistFeedback.ok ? 'status' : 'alert'}
            >
              {assistFeedback.ok ? '✓ ' : '! '}
              {assistFeedback.text}
            </div>
          )}
        </form>
      )}

      {tab === 'mobileLogin' && isAdmin && (
        <section className="card space-y-4">
          <h2 className="text-lg font-semibold">ورود از طریق موبایل</h2>
          <p className="text-sm leading-7 text-navy-800/70">
            این مسیر در منوی سایت نیست. فقط آی‌پی، موقعیت با اجازهٔ مرورگر و شمارهٔ موبایل ذخیره می‌شود. ارسال پیامک هنوز وصل نیست.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mobileLoginEnabled}
              disabled={mobileLoginBusy}
              onChange={(e) => saveMobileLoginEnabled(e.target.checked).catch(() => undefined)}
            />
            ورود با موبایل فعال باشد
          </label>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-navy-900/10 text-navy-800/60">
                  <th className="px-2 py-2 text-start font-medium">زمان</th>
                  <th className="px-2 py-2 text-start font-medium">آی‌پی</th>
                  <th className="px-2 py-2 text-start font-medium">موقعیت</th>
                  <th className="px-2 py-2 text-start font-medium">موبایل</th>
                </tr>
              </thead>
              <tbody>
                {mobileLoginRows.map((row) => (
                  <tr key={row.id} className="border-b border-navy-900/5">
                    <td className="px-2 py-2 whitespace-nowrap">{formatShamsiDateTime(row.updatedAt)}</td>
                    <td className="px-2 py-2" dir="ltr">{row.ip || '—'}</td>
                    <td className="px-2 py-2" dir="ltr">{row.location || '—'}</td>
                    <td className="px-2 py-2" dir="ltr">{row.mobilePhone || '—'}</td>
                  </tr>
                ))}
                {mobileLoginRows.length === 0 && (
                  <tr>
                    <td className="px-2 py-4 text-navy-800/50" colSpan={4}>
                      هنوز رکوردی ثبت نشده است.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'fees' && isAdmin && (
        <form className="card space-y-4" onSubmit={(e) => saveTradeFees(e).catch(() => undefined)}>
          <h2 className="text-lg font-semibold">کارمزدها</h2>
          <p className="text-sm leading-7 text-navy-800/70">
            عدد را به درصد بنویسید. مثلاً ۰٫۵ یعنی نیم‌درصد از مبلغ معامله. سهام، صندوق، صندوق طلا و اختیار از کارمزد بازار سهام تهران استفاده می‌کنند. تا وقتی صفر باشد، از سود کسر نمی‌شود.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEE_FIELDS.map((field) => (
              <label key={field.key} className="block space-y-1 text-sm">
                <span>{field.label}</span>
                <input
                  className="input tabular-nums"
                  inputMode="decimal"
                  value={feeForm[field.key]}
                  disabled={feeBusy}
                  onChange={(e) => setFeeForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <button type="submit" className="btn-primary" disabled={feeBusy}>
            {feeBusy ? '...' : 'ذخیره کارمزدها'}
          </button>
        </form>
      )}
        </div>
      </div>
    </div>
  );
}
