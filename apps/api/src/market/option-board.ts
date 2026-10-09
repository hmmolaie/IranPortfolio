/** مشاهدهٔ صف و اختیار از قیمت ذخیره‌شده. توصیهٔ قطعی معامله نیست. */

export type QueueSide = 'buy' | 'sell';

export type OptionSide = 'CALL' | 'PUT';

export type BoardSource = {
  id: string;
  symbol: string;
  nameFa: string;
  assetType: string;
  lastPrice: number | null;
  closePrice: number | null;
  volume: number | null;
  raw: unknown;
  meta: unknown;
};

export type QueueRow = {
  instrumentId: string;
  symbol: string;
  nameFa: string;
  queue: QueueSide;
  queueFa: string;
  lastPrice: number | null;
  volume: number | null;
};

export type OptionIdea = {
  instrumentId: string;
  symbol: string;
  nameFa: string;
  side: OptionSide;
  sideFa: string;
  underlyingSymbol: string;
  underlyingPrice: number;
  strike: number;
  premium: number;
  premiumPctOfSpot: number;
  intrinsic: number;
  daysLeft: number | null;
  reasonFa: string;
};

export type QueueReplacement = {
  queue: QueueSide;
  symbol: string;
  nameFa: string;
  instrumentId: string;
  lastPrice: number | null;
  noteFa: string;
  replacement: {
    instrumentId: string;
    symbol: string;
    sideFa: string;
    premium: number;
  } | null;
};

export type OptionBoard = {
  disclaimerFa: string;
  buyQueues: QueueRow[];
  sellQueues: QueueRow[];
  worthwhileOptions: OptionIdea[];
  replacements: QueueReplacement[];
};

const DISCLAIMER =
  'این فهرست از قیمت امروز محاسبه شده است و توصیهٔ قطعی خرید یا فروش نیست.';

export function marketNumber(value: unknown): number | null {
  const raw = unwrap(value);
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let text = String(raw)
    .trim()
    .replace(/,/g, '')
    .replace(/٫/g, '.')
    .replace(/[−–]/g, '-');
  if (text.endsWith('-') && !text.startsWith('-')) text = `-${text.slice(0, -1)}`;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function parseOptionMeta(item: Record<string, unknown>, symbol: string, nameFa: string) {
  const side = optionSide(symbol, nameFa, item);
  const underlyingSymbol =
    text(
      item.base_l18 ??
        item.baseSymbol ??
        item.namadPayeh ??
        item.underlyingSymbol ??
        item.underlying ??
        underlyingFromName(nameFa),
    ) || null;
  const strike = marketNumber(
    item.price_strike ?? item.qeymateEmal ?? item.strikePrice ?? item.gheymatEmal ?? strikeFromName(nameFa),
  );
  const daysLeft = marketNumber(
    item.day_remain ?? item.baghimandetasarresid ?? item.daysUntilExpiry ?? item.buyBaqimandeTaSarresId,
  );
  const contractSize = marketNumber(item.size_contract ?? item.buyAndazeyeQarardad ?? item.contractSize);
  const underlyingPrice = marketNumber(item.base_pl ?? item.base_pc ?? item.qeymateMabna);
  return {
    side,
    sideFa: side === 'CALL' ? 'اختیار خرید' : side === 'PUT' ? 'اختیار فروش' : null,
    underlyingSymbol,
    strike,
    daysLeft,
    contractSize,
    underlyingPrice,
  };
}

export function buildOptionBoard(rows: BoardSource[]): OptionBoard {
  const stocks = rows.filter((row) => row.assetType === 'STOCK' || row.assetType === 'GOLD_ETF' || row.assetType === 'FUND');
  const options = rows.filter((row) => row.assetType === 'OPTION');
  const priceBySymbol = new Map<string, number>();
  for (const row of stocks) {
    const price = row.lastPrice ?? row.closePrice;
    if (price != null && price > 0) priceBySymbol.set(fold(row.symbol), price);
  }

  const queued: QueueRow[] = [];
  for (const row of stocks) {
    const queue = detectQueue(row.raw, row.lastPrice ?? row.closePrice);
    if (!queue) continue;
    queued.push({
      instrumentId: row.id,
      symbol: row.symbol,
      nameFa: row.nameFa,
      queue,
      queueFa: queue === 'buy' ? 'صف خرید' : 'صف فروش',
      lastPrice: row.lastPrice ?? row.closePrice,
      volume: row.volume,
    });
  }
  queued.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const buyQueues = queued.filter((row) => row.queue === 'buy').slice(0, 12);
  const sellQueues = queued.filter((row) => row.queue === 'sell').slice(0, 12);

  const ideas: OptionIdea[] = [];
  for (const row of options) {
    const meta = asRecord(row.meta);
    const raw = asRecord(row.raw);
    const parsed = parseOptionMeta({ ...raw, ...meta }, row.symbol, row.nameFa);
    if (!parsed.side || !parsed.underlyingSymbol || parsed.strike == null || parsed.strike <= 0) continue;
    const premium = row.lastPrice ?? row.closePrice;
    if (premium == null || premium <= 0) continue;
    if (detectQueue(row.raw, premium)) continue;
    if (row.volume === 0) continue;
    const underlyingPrice =
      priceBySymbol.get(fold(parsed.underlyingSymbol)) ??
      (parsed.underlyingPrice != null && parsed.underlyingPrice > 0 ? parsed.underlyingPrice : null);
    if (underlyingPrice == null || underlyingPrice <= 0) continue;
    const idea = assessOption({
      instrumentId: row.id,
      symbol: row.symbol,
      nameFa: row.nameFa,
      side: parsed.side,
      underlyingSymbol: parsed.underlyingSymbol,
      underlyingPrice,
      strike: parsed.strike,
      premium,
      daysLeft: parsed.daysLeft,
    });
    if (idea) ideas.push(idea);
  }
  ideas.sort((a, b) => scoreOption(a) - scoreOption(b));
  const worthwhileOptions = ideas.slice(0, 8);

  const replacements = [...buyQueues.slice(0, 8), ...sellQueues.slice(0, 8)].map((row) => {
    const side: OptionSide = row.queue === 'buy' ? 'CALL' : 'PUT';
    const match =
      ideas.find((idea) => idea.side === side && fold(idea.underlyingSymbol) === fold(row.symbol)) ?? null;
    const noteFa = match
      ? row.queue === 'buy'
        ? `سهم ${row.symbol} صف خرید است. به‌جای خرید خود سهم، اختیار خرید ${match.symbol} نسبت به قیمت سهم بررسی شود.`
        : `سهم ${row.symbol} صف فروش است. به‌جای خرید خود سهم، اختیار فروش ${match.symbol} بررسی شود یا تا جمع شدن صف صبر شود.`
      : row.queue === 'buy'
        ? `سهم ${row.symbol} صف خرید است. تا باز شدن صف، خرید خود سهم پیشنهاد نمی‌شود و اختیار نزدیک به قیمت این سهم در دادهٔ امروز پیدا نشد.`
        : `سهم ${row.symbol} صف فروش است. خرید خود سهم در کف روزانه پیشنهاد نمی‌شود.`;
    return {
      queue: row.queue,
      symbol: row.symbol,
      nameFa: row.nameFa,
      instrumentId: row.instrumentId,
      lastPrice: row.lastPrice,
      noteFa,
      replacement: match
        ? {
            instrumentId: match.instrumentId,
            symbol: match.symbol,
            sideFa: match.sideFa,
            premium: match.premium,
          }
        : null,
    };
  });

  return { disclaimerFa: DISCLAIMER, buyQueues, sellQueues, worthwhileOptions, replacements };
}

export function optionBoardForPrompt(board: OptionBoard) {
  return {
    disclaimerFa: board.disclaimerFa,
    buyQueues: board.buyQueues.slice(0, 8).map((row) => ({
      symbol: row.symbol,
      queueFa: row.queueFa,
      lastPrice: row.lastPrice,
    })),
    sellQueues: board.sellQueues.slice(0, 8).map((row) => ({
      symbol: row.symbol,
      queueFa: row.queueFa,
      lastPrice: row.lastPrice,
    })),
    worthwhileOptions: board.worthwhileOptions.slice(0, 6).map((row) => ({
      symbol: row.symbol,
      sideFa: row.sideFa,
      underlyingSymbol: row.underlyingSymbol,
      underlyingPrice: row.underlyingPrice,
      strike: row.strike,
      premium: row.premium,
      premiumPctOfSpot: row.premiumPctOfSpot,
      reasonFa: row.reasonFa,
    })),
    replacements: board.replacements.slice(0, 8).map((row) => ({
      symbol: row.symbol,
      queueFa: row.queue === 'buy' ? 'صف خرید' : 'صف فروش',
      replacementSymbol: row.replacement?.symbol ?? null,
      noteFa: row.noteFa,
    })),
  };
}

export function optionBoardTelegramLines(board: OptionBoard): string[] {
  const lines: string[] = [];
  for (const row of board.worthwhileOptions.slice(0, 3)) {
    lines.push(
      `${row.sideFa} ${row.symbol} روی ${row.underlyingSymbol}: قیمت اختیار ${formatPlain(row.premium)} و حدود ${formatPlain(row.premiumPctOfSpot)} درصد قیمت سهم.`,
    );
  }
  for (const row of board.replacements.slice(0, 3)) {
    lines.push(row.noteFa);
  }
  return lines;
}

export function redirectAnalysisSuggestion<
  T extends { action?: string; symbol?: string; assetType?: string; bodyFa?: string },
>(item: T, board: OptionBoard): T {
  const action = item.action;
  const symbol = item.symbol;
  if (!symbol || !action || action === 'SKIP' || action === 'REMOVE' || action === 'DECREASE') return item;
  const hit = board.replacements.find((row) => fold(row.symbol) === fold(symbol));
  if (!hit) return item;
  if (!hit.replacement) {
    return { ...item, action: 'SKIP', bodyFa: hit.noteFa } as T;
  }
  return {
    ...item,
    symbol: hit.replacement.symbol,
    assetType: 'OPTION',
    bodyFa: [hit.noteFa, item.bodyFa].filter(Boolean).join(' '),
  } as T;
}

export function redirectQueuedSymbol<T extends { symbol: string; assetType: string; reasonFa?: string }>(
  item: T,
  board: OptionBoard,
): T {
  const hit = board.replacements.find((row) => fold(row.symbol) === fold(item.symbol));
  if (!hit) return item;
  if (!hit.replacement) {
    return {
      ...item,
      reasonFa: [hit.noteFa, item.reasonFa].filter(Boolean).join(' '),
    };
  }
  return {
    ...item,
    symbol: hit.replacement.symbol,
    assetType: 'OPTION',
    reasonFa: [hit.noteFa, item.reasonFa].filter(Boolean).join(' '),
  };
}

export function describeQuote(row: BoardSource): {
  queue: QueueSide | null;
  queueFa: string | null;
  optionSideFa: string | null;
  underlyingSymbol: string | null;
  strike: number | null;
} {
  const queue = detectQueue(row.raw, row.lastPrice ?? row.closePrice);
  if (row.assetType !== 'OPTION') {
    return {
      queue,
      queueFa: queue === 'buy' ? 'صف خرید' : queue === 'sell' ? 'صف فروش' : null,
      optionSideFa: null,
      underlyingSymbol: null,
      strike: null,
    };
  }
  const meta = asRecord(row.meta);
  const raw = asRecord(row.raw);
  const parsed = parseOptionMeta({ ...raw, ...meta }, row.symbol, row.nameFa);
  return {
    queue,
    queueFa: queue === 'buy' ? 'صف خرید' : queue === 'sell' ? 'صف فروش' : null,
    optionSideFa: parsed.sideFa,
    underlyingSymbol: parsed.underlyingSymbol,
    strike: parsed.strike,
  };
}

function assessOption(input: {
  instrumentId: string;
  symbol: string;
  nameFa: string;
  side: OptionSide;
  underlyingSymbol: string;
  underlyingPrice: number;
  strike: number;
  premium: number;
  daysLeft: number | null;
}): OptionIdea | null {
  const { underlyingPrice, strike, premium, side, daysLeft } = input;
  const distance = Math.abs(strike - underlyingPrice) / underlyingPrice;
  const premiumPct = (premium / underlyingPrice) * 100;
  if (distance > 0.12 || premiumPct > 15 || premiumPct < 0.15) return null;
  if (daysLeft != null && (daysLeft < 7 || daysLeft > 120)) return null;
  const intrinsic = side === 'CALL' ? Math.max(0, underlyingPrice - strike) : Math.max(0, strike - underlyingPrice);
  if (intrinsic > 0 && premium / intrinsic > 1.45) return null;
  if (intrinsic === 0 && (premiumPct > 5 || distance > 0.08)) return null;
  const premiumPctOfSpot = Math.round(premiumPct * 10) / 10;
  const reasonFa =
    intrinsic > 0
      ? `قیمت این ${side === 'CALL' ? 'اختیار خرید' : 'اختیار فروش'} نزدیک ارزش ذاتی نسبت به قیمت سهم است و فاصلهٔ قیمت اعمال تا سهم کم است.`
      : `قیمت اعمال نزدیک قیمت سهم است و قیمت اختیار بخش کوچکی از قیمت سهم است.`;
  return {
    instrumentId: input.instrumentId,
    symbol: input.symbol,
    nameFa: input.nameFa,
    side,
    sideFa: side === 'CALL' ? 'اختیار خرید' : 'اختیار فروش',
    underlyingSymbol: input.underlyingSymbol,
    underlyingPrice,
    strike,
    premium,
    premiumPctOfSpot,
    intrinsic,
    daysLeft,
    reasonFa,
  };
}

function scoreOption(idea: OptionIdea): number {
  const distance = Math.abs(idea.strike - idea.underlyingPrice) / idea.underlyingPrice;
  return distance * 2 + idea.premiumPctOfSpot / 100;
}

function detectQueue(raw: unknown, lastPrice: number | null): QueueSide | null {
  if (lastPrice == null || !(lastPrice > 0)) return null;
  const row = asRecord(raw);
  const status = text(row.statename ?? row.state ?? row.status ?? row.cEtavalTitle);
  if (/صف\s*خرید/.test(status)) return 'buy';
  if (/صف\s*فروش/.test(status)) return 'sell';
  const max = marketNumber(row.tmax ?? row.priceMax ?? row.maxValue ?? row.highAllowed ?? row.psGelStaMax);
  const min = marketNumber(row.tmin ?? row.priceMin ?? row.minValue ?? row.lowAllowed ?? row.psGelStaMin);
  const sellVolume = marketNumber(row.qo1 ?? row.sellVolume ?? row.qTitMeOf ?? row.Sell_I_Volume ?? row.bestSellVolume);
  const buyVolume = marketNumber(row.qd1 ?? row.buyVolume ?? row.qTitMeDem ?? row.Buy_I_Volume ?? row.bestBuyVolume);
  if (max != null && max > 0 && lastPrice >= max * 0.997 && (sellVolume == null || sellVolume <= 0)) return 'buy';
  if (min != null && min > 0 && lastPrice <= min * 1.003 && (buyVolume == null || buyVolume <= 0)) return 'sell';
  return null;
}

function optionSide(symbol: string, nameFa: string, item: Record<string, unknown>): OptionSide | null {
  const explicit = text(item.type ?? item.optionType ?? item.side).toLowerCase();
  if (explicit === 'call' || explicit === 'c' || explicit.includes('خرید')) return 'CALL';
  if (explicit === 'put' || explicit === 'p' || explicit.includes('فروش')) return 'PUT';
  const foldedName = nameFa.replace(/\s/g, '');
  if (foldedName.includes('اختیارخ') || foldedName.includes('اختیارخرید')) return 'CALL';
  if (foldedName.includes('اختیارف') || foldedName.includes('اختیارفروش')) return 'PUT';
  const ch = symbol.trim().charAt(0);
  if (ch === 'ض') return 'CALL';
  if (ch === 'ط') return 'PUT';
  return null;
}

function underlyingFromName(name: string): string | null {
  const match = name.match(/اختیار\s*[خف]\.?\s*([^\s\-–]+)/);
  return match?.[1]?.trim() || null;
}

function strikeFromName(name: string): number | null {
  const match = name.match(/(\d{3,})/);
  return match ? Number(match[1]) : null;
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  const raw = unwrap(value);
  return raw == null ? '' : String(raw).trim();
}

function fold(value: string): string {
  return value.trim().replace(/[يك]/g, (ch) => (ch === 'ي' ? 'ی' : 'ک')).replace(/\u200c/g, '');
}

function formatPlain(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
