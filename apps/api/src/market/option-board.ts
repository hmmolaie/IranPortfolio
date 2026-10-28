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

export type UnderlyingOptionQuote = {
  id: string;
  symbol: string;
  nameFa: string;
  side: OptionSide;
  sideFa: string;
  strike: number;
  premium: number | null;
  daysLeft: number | null;
  premiumPctOfSpot: number | null;
  intrinsic: number | null;
  worthwhile: boolean;
  verdictFa: string;
  reasonFa: string;
};

export function optionTradePrice(source: {
  lastPrice?: number | null;
  closePrice?: number | null;
  raw?: unknown;
}): { last: number | null; close: number | null } {
  const raw = asRecord(source.raw);
  const positive = (value: unknown) => {
    const n = marketNumber(value);
    return n != null && n > 0 ? n : null;
  };
  const last =
    positive(source.lastPrice) ??
    positive(raw.pl) ??
    positive(raw.pd1) ??
    positive(raw.po1) ??
    positive(raw.pf) ??
    positive(raw.py) ??
    positive(raw.pDrCotVal) ??
    positive(raw.lastPrice);
  const close = positive(source.closePrice) ?? positive(raw.pc) ?? positive(raw.py) ?? last;
  return { last, close };
}

export function quotesForUnderlying(
  underlyingSymbol: string,
  underlyingPrice: number | null,
  rows: BoardSource[],
  underlyingInsCode?: string | null,
): UnderlyingOptionQuote[] {
  const target = fold(underlyingSymbol);
  const out: UnderlyingOptionQuote[] = [];
  for (const row of rows) {
    if (row.assetType !== 'OPTION') continue;
    const raw = asRecord(row.raw);
    const meta = asRecord(row.meta);
    const parsed = parseOptionMeta({ ...raw, ...meta }, row.symbol, row.nameFa);
    const baseId = text(raw.base_id ?? meta.base_id ?? meta.baseId);
    const nameFa = fold(row.nameFa);
    const sameUnderlying =
      Boolean(parsed.underlyingSymbol && fold(parsed.underlyingSymbol) === target) ||
      Boolean(underlyingInsCode && baseId && baseId === underlyingInsCode) ||
      (target.length >= 2 && nameFa.includes(`${target}-`));
    if (!parsed.side || !sameUnderlying) continue;
    if (parsed.strike == null || parsed.strike <= 0) continue;
    const premium = optionTradePrice(row).last ?? optionTradePrice(row).close;
    const spot =
      underlyingPrice != null && underlyingPrice > 0
        ? underlyingPrice
        : parsed.underlyingPrice != null && parsed.underlyingPrice > 0
          ? parsed.underlyingPrice
          : null;
    const judged = judgeOption({
      side: parsed.side,
      strike: parsed.strike,
      premium,
      spot,
      daysLeft: parsed.daysLeft,
    });
    out.push({
      id: row.id,
      symbol: row.symbol,
      nameFa: row.nameFa,
      side: parsed.side,
      sideFa: parsed.sideFa ?? (parsed.side === 'CALL' ? 'اختیار خرید' : 'اختیار فروش'),
      strike: parsed.strike,
      premium: premium != null && premium > 0 ? premium : null,
      daysLeft: parsed.daysLeft,
      premiumPctOfSpot: judged.premiumPctOfSpot,
      intrinsic: judged.intrinsic,
      worthwhile: judged.worthwhile,
      verdictFa: judged.verdictFa,
      reasonFa: judged.reasonFa,
    });
  }
  out.sort((a, b) => (a.side === b.side ? a.strike - b.strike : a.side === 'CALL' ? -1 : 1));
  return out;
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
  const judged = judgeOption({
    side: input.side,
    strike: input.strike,
    premium: input.premium,
    spot: input.underlyingPrice,
    daysLeft: input.daysLeft,
  });
  if (!judged.worthwhile || judged.premiumPctOfSpot == null || judged.intrinsic == null) return null;
  return {
    instrumentId: input.instrumentId,
    symbol: input.symbol,
    nameFa: input.nameFa,
    side: input.side,
    sideFa: input.side === 'CALL' ? 'اختیار خرید' : 'اختیار فروش',
    underlyingSymbol: input.underlyingSymbol,
    underlyingPrice: input.underlyingPrice,
    strike: input.strike,
    premium: input.premium,
    premiumPctOfSpot: judged.premiumPctOfSpot,
    intrinsic: judged.intrinsic,
    daysLeft: input.daysLeft,
    reasonFa: judged.reasonFa,
  };
}

function judgeOption(input: {
  side: OptionSide;
  strike: number;
  premium: number | null;
  spot: number | null;
  daysLeft: number | null;
}): {
  worthwhile: boolean;
  verdictFa: string;
  reasonFa: string;
  premiumPctOfSpot: number | null;
  intrinsic: number | null;
} {
  const { side, strike, premium, spot, daysLeft } = input;
  const sideFa = side === 'CALL' ? 'اختیار خرید' : 'اختیار فروش';
  if (premium == null || !(premium > 0) || spot == null || !(spot > 0)) {
    return {
      worthwhile: false,
      verdictFa: 'بدون قیمت',
      reasonFa: 'قیمت اختیار یا قیمت سهم برای مقایسه کافی نیست.',
      premiumPctOfSpot: null,
      intrinsic: null,
    };
  }
  const distance = Math.abs(strike - spot) / spot;
  const premiumPct = (premium / spot) * 100;
  const intrinsic = side === 'CALL' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const premiumPctOfSpot = Math.round(premiumPct * 10) / 10;
  const base = { premiumPctOfSpot, intrinsic, worthwhile: false as boolean };
  if (daysLeft != null && daysLeft < 0) {
    return { ...base, verdictFa: 'سررسید گذشته', reasonFa: 'روز باقی‌ماندهٔ این قرارداد تمام شده است.' };
  }
  if (distance > 0.12) {
    return {
      ...base,
      verdictFa: 'دور از سهم',
      reasonFa: `فاصلهٔ قیمت اعمال تا سهم حدود ${(Math.round(distance * 1000) / 10).toLocaleString('en-US')} درصد است.`,
    };
  }
  if (premiumPct > 15) {
    return { ...base, verdictFa: 'گران', reasonFa: `قیمت این ${sideFa} بیش از ۱۵ درصد قیمت سهم است.` };
  }
  if (premiumPct < 0.15) {
    return { ...base, verdictFa: 'نامتعارف', reasonFa: 'قیمت اختیار نسبت به سهم خیلی کوچک است.' };
  }
  if (daysLeft != null && daysLeft > 120) {
    return { ...base, verdictFa: 'سررسید دور', reasonFa: 'تا سررسید بیش از ۱۲۰ روز مانده است.' };
  }
  if (intrinsic > 0 && premium / intrinsic > 1.45) {
    return { ...base, verdictFa: 'گران', reasonFa: `قیمت این ${sideFa} از ارزش ذاتی نسبت به قیمت سهم بالاتر است.` };
  }
  if (intrinsic === 0 && (premiumPct > 5 || distance > 0.08)) {
    return {
      ...base,
      verdictFa: 'گران',
      reasonFa: `این ${sideFa} هنوز وارد سود نشده و قیمتش نسبت به نزدیکی به سهم بالاست.`,
    };
  }
  return {
    worthwhile: true,
    verdictFa: 'ارزنده',
    premiumPctOfSpot,
    intrinsic,
    reasonFa:
      intrinsic > 0
        ? `قیمت این ${sideFa} نزدیک ارزش ذاتی نسبت به قیمت سهم است و فاصلهٔ قیمت اعمال تا سهم کم است.`
        : `قیمت اعمال نزدیک قیمت سهم است و قیمت اختیار بخش کوچکی از قیمت سهم است.`,
  };
}

export type ValuableOption = {
  id: string;
  symbol: string;
  nameFa: string;
  sideFa: string;
  underlyingSymbol: string;
  underlyingPrice: number;
  strike: number;
  premium: number;
  daysLeft: number;
  contractSize: number | null;
  profitPerUnit: number;
  profitRial: number;
  profitPct: number;
  reasonFa: string;
};

/** سود هر واحد = ارزش ذاتی نسبت به قیمت دارایی پایه، منهای قیمت اختیار. کمتر از ۵ درصد قیمت اختیار، قابل توجه نیست. */
const MIN_PROFIT_PCT = 5;

export function listValuableOptions(rows: BoardSource[]): ValuableOption[] {
  const spotBySymbol = new Map<string, number>();
  for (const row of rows) {
    if (row.assetType === 'OPTION') continue;
    const price = row.lastPrice ?? row.closePrice;
    if (price != null && price > 0) spotBySymbol.set(fold(row.symbol), price);
  }

  const out: ValuableOption[] = [];
  for (const row of rows) {
    if (row.assetType !== 'OPTION') continue;
    if (row.volume === 0) continue;
    const raw = asRecord(row.raw);
    const meta = asRecord(row.meta);
    const parsed = parseOptionMeta({ ...raw, ...meta }, row.symbol, row.nameFa);
    if (!parsed.side || !parsed.underlyingSymbol || parsed.strike == null || !(parsed.strike > 0)) continue;
    if (parsed.daysLeft == null || parsed.daysLeft < 0) continue;
    const premium = optionTradePrice(row).last ?? optionTradePrice(row).close;
    if (premium == null || !(premium > 0)) continue;
    const spot =
      spotBySymbol.get(fold(parsed.underlyingSymbol)) ??
      (parsed.underlyingPrice != null && parsed.underlyingPrice > 0 ? parsed.underlyingPrice : null);
    if (spot == null) continue;
    const intrinsic = parsed.side === 'CALL' ? Math.max(0, spot - parsed.strike) : Math.max(0, parsed.strike - spot);
    const profitPerUnit = intrinsic - premium;
    if (!(profitPerUnit > 0)) continue;
    const profitPct = (profitPerUnit / premium) * 100;
    if (profitPct < MIN_PROFIT_PCT) continue;
    const contractSize = parsed.contractSize != null && parsed.contractSize > 0 ? parsed.contractSize : null;
    const sideFa = parsed.sideFa ?? (parsed.side === 'CALL' ? 'اختیار خرید' : 'اختیار فروش');
    out.push({
      id: row.id,
      symbol: row.symbol,
      nameFa: row.nameFa,
      sideFa,
      underlyingSymbol: parsed.underlyingSymbol,
      underlyingPrice: spot,
      strike: parsed.strike,
      premium,
      daysLeft: parsed.daysLeft,
      contractSize,
      profitPerUnit,
      profitRial: profitPerUnit * (contractSize ?? 1),
      profitPct: Math.round(profitPct * 10) / 10,
      reasonFa: `ارزش ذاتی این ${sideFa} از قیمت اختیار بیشتر است و تا سررسید ${Math.round(parsed.daysLeft).toLocaleString('en-US')} روز مانده.`,
    });
  }
  out.sort((a, b) => b.profitRial - a.profitRial || b.profitPct - a.profitPct);
  return out;
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
