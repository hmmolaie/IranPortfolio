import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletPaymentStatus, WalletTxKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/secret-box';

export type WalletFeature = 'telegram' | 'suggest' | 'rebalance';

const INSUFFICIENT =
  'موجودی کیف پول برای این کار کافی نیست. از بخش کیف پول در تنظیمات، حساب خود را شارژ کنید.';
const MIN_CHARGE_RIAL = 10_000;
const MAX_CHARGE_RIAL = 500_000_000;
const MAX_BALANCE_RIAL = 2_000_000_000;

type ZarinpalBody = {
  data?: { code?: number; message?: string; authority?: string; ref_id?: number };
  errors?: { message?: string } | Array<{ message?: string }>;
};

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encKey() {
    return this.config.get<string>('LLM_TOKEN_ENCRYPTION_KEY') ?? '0123456789abcdef0123456789abcdef';
  }

  async readConfig() {
    return this.prisma.walletConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });
  }

  callbackOrigin(): string | null {
    const raw = (this.config.get<string>('PUBLIC_URL') || this.config.get<string>('CORS_ORIGIN') || '').trim();
    const first = raw.split(',')[0]?.trim().replace(/\/+$/, '') ?? '';
    if (!first || !/^https?:\/\//i.test(first)) return null;
    return first;
  }

  async publicSummary(userId: string) {
    const [cfg, user, transactions] = await Promise.all([
      this.readConfig(),
      this.prisma.user.findUnique({ where: { id: userId }, select: { walletBalanceRial: true } }),
      this.prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, amountRial: true, kind: true, balanceAfterRial: true, note: true, createdAt: true },
      }),
    ]);
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    return {
      enabled: cfg.enabled,
      balanceRial: user.walletBalanceRial,
      costs: {
        telegramDailyRial: cfg.telegramDailyRial,
        suggestRial: cfg.suggestRial,
        rebalanceRial: cfg.rebalanceRial,
      },
      gatewayReady: Boolean(cfg.merchantIdEncrypted) && Boolean(this.callbackOrigin()),
      transactions,
    };
  }

  async adminSettings() {
    const cfg = await this.readConfig();
    return {
      enabled: cfg.enabled,
      sandbox: cfg.sandbox,
      hasMerchant: Boolean(cfg.merchantIdEncrypted),
      telegramDailyRial: cfg.telegramDailyRial,
      suggestRial: cfg.suggestRial,
      rebalanceRial: cfg.rebalanceRial,
      callbackUrl: this.callbackOrigin() ? `${this.callbackOrigin()}/api/wallet/callback` : null,
    };
  }

  async saveAdminSettings(input: {
    enabled: boolean;
    sandbox: boolean;
    merchantId?: string;
    telegramDailyRial: number;
    suggestRial: number;
    rebalanceRial: number;
  }) {
    const current = await this.readConfig();
    const merchant = input.merchantId?.trim();
    let merchantIdEncrypted = current.merchantIdEncrypted;
    if (merchant) {
      if (!/^[0-9a-zA-Z-]{10,50}$/.test(merchant)) {
        throw new BadRequestException('توکن پذیرندهٔ زرین‌پال نامعتبر است.');
      }
      merchantIdEncrypted = encryptSecret(this.encKey(), merchant);
    }
    await this.prisma.walletConfig.update({
      where: { id: 'default' },
      data: {
        enabled: input.enabled,
        sandbox: input.sandbox,
        merchantIdEncrypted,
        telegramDailyRial: input.telegramDailyRial,
        suggestRial: input.suggestRial,
        rebalanceRial: input.rebalanceRial,
      },
    });
    return this.adminSettings();
  }

  async listUsersForAdmin() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, role: true, walletBalanceRial: true },
    });
  }

  async adminCredit(userId: string, amountRial: number, note?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const balanceRial = await this.credit(userId, amountRial, WalletTxKind.ADMIN, note);
    return { ok: true, balanceRial };
  }

  async startCharge(userId: string, amountRial: number) {
    if (!Number.isInteger(amountRial) || amountRial < MIN_CHARGE_RIAL || amountRial > MAX_CHARGE_RIAL) {
      throw new BadRequestException('مبلغ شارژ باید بین ۱۰٬۰۰۰ و ۵۰۰٬۰۰۰٬۰۰۰ ریال باشد.');
    }
    const cfg = await this.readConfig();
    if (!cfg.merchantIdEncrypted) {
      throw new BadRequestException('درگاه پرداخت هنوز توسط مدیر تنظیم نشده است.');
    }
    const origin = this.callbackOrigin();
    if (!origin) {
      throw new BadRequestException('نشانی عمومی سایت برای بازگشت از درگاه تنظیم نشده است.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new NotFoundException('کاربر پیدا نشد');
    const merchantId = decryptSecret(this.encKey(), cfg.merchantIdEncrypted);
    const callback = `${origin}/api/wallet/callback`;
    const body = await this.zarinpal(cfg.sandbox, 'request', {
      merchant_id: merchantId,
      amount: amountRial,
      callback_url: callback,
      description: 'شارژ کیف پول سبدیار',
      metadata: { email: user.email },
    });
    const authority = body.data?.authority?.trim();
    if (body.data?.code !== 100 || !authority) {
      this.logger.warn(`زرین‌پال درخواست ناموفق code=${body.data?.code ?? 'none'}`);
      throw new BadRequestException('اتصال به درگاه زرین‌پال ناموفق بود.');
    }
    await this.prisma.walletPayment.create({
      data: { userId, amountRial, authority, status: WalletPaymentStatus.PENDING },
    });
    const host = cfg.sandbox ? 'https://sandbox.zarinpal.com' : 'https://www.zarinpal.com';
    return { url: `${host}/pg/StartPay/${authority}` };
  }

  async handleCallback(authorityRaw: string | undefined, statusRaw: string | undefined): Promise<string> {
    const origin = this.callbackOrigin() || '';
    const fail = `${origin}/settings?wallet=fail`;
    const ok = `${origin}/settings?wallet=ok`;
    const authority = (authorityRaw ?? '').trim();
    if (!authority || !origin) return fail;
    const payment = await this.prisma.walletPayment.findUnique({ where: { authority } });
    if (!payment) return fail;
    if (payment.status === WalletPaymentStatus.PAID) return ok;
    if ((statusRaw ?? '').toUpperCase() !== 'OK') {
      await this.prisma.walletPayment.updateMany({
        where: { id: payment.id, status: WalletPaymentStatus.PENDING },
        data: { status: WalletPaymentStatus.FAILED },
      });
      return fail;
    }
    const cfg = await this.readConfig();
    if (!cfg.merchantIdEncrypted) return fail;
    const merchantId = decryptSecret(this.encKey(), cfg.merchantIdEncrypted);
    let refId = '';
    try {
      const body = await this.zarinpal(cfg.sandbox, 'verify', {
        merchant_id: merchantId,
        amount: payment.amountRial,
        authority,
      });
      const code = body.data?.code;
      if (code !== 100 && code !== 101) return fail;
      refId = body.data?.ref_id != null ? String(body.data.ref_id) : '';
    } catch (e) {
      this.logger.warn(`تأیید زرین‌پال ناموفق: ${(e as Error).message.slice(0, 160)}`);
      return fail;
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const marked = await tx.walletPayment.updateMany({
          where: { id: payment.id, status: WalletPaymentStatus.PENDING },
          data: { status: WalletPaymentStatus.PAID, refId: refId || null, paidAt: new Date() },
        });
        if (marked.count !== 1) return;
        const current = await tx.user.findUnique({
          where: { id: payment.userId },
          select: { walletBalanceRial: true },
        });
        if (!current || current.walletBalanceRial > MAX_BALANCE_RIAL - payment.amountRial) {
          throw new Error('balance cap');
        }
        const user = await tx.user.update({
          where: { id: payment.userId },
          data: { walletBalanceRial: { increment: payment.amountRial } },
          select: { walletBalanceRial: true },
        });
        await tx.walletTransaction.create({
          data: {
            userId: payment.userId,
            amountRial: payment.amountRial,
            kind: WalletTxKind.GATEWAY,
            balanceAfterRial: user.walletBalanceRial,
            note: refId ? `زرین‌پال ${refId}` : null,
          },
        });
      });
    } catch (e) {
      this.logger.warn(`ثبت شارژ کیف پول ناموفق: ${(e as Error).message.slice(0, 160)}`);
      return fail;
    }
    return ok;
  }

  /** اگر موجودی کافی نباشد خطا می‌دهد و چیزی کسر نمی‌کند */
  async ensure(userId: string, feature: WalletFeature) {
    const price = await this.price(feature);
    if (price <= 0) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalanceRial: true },
    });
    if (!user || user.walletBalanceRial < price) throw new BadRequestException(INSUFFICIENT);
  }

  /** مبلغ قابلیت را کم می‌کند. اگر کسر خاموش یا قیمت صفر باشد صفر برمی‌گرداند */
  async charge(userId: string, feature: WalletFeature): Promise<number> {
    const price = await this.price(feature);
    if (price <= 0) return 0;
    const kind =
      feature === 'telegram' ? WalletTxKind.TELEGRAM : feature === 'suggest' ? WalletTxKind.SUGGEST : WalletTxKind.REBALANCE;
    return this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: { id: userId, walletBalanceRial: { gte: price } },
          data: { walletBalanceRial: { decrement: price } },
        });
        if (updated.count !== 1) throw new BadRequestException(INSUFFICIENT);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { walletBalanceRial: true },
        });
        await tx.walletTransaction.create({
          data: {
            userId,
            amountRial: -price,
            kind,
            balanceAfterRial: user.walletBalanceRial,
          },
        });
        return price;
      });
  }

  async tryCharge(userId: string, feature: WalletFeature): Promise<{ ok: true; charged: number } | { ok: false }> {
    try {
      const charged = await this.charge(userId, feature);
      return { ok: true, charged };
    } catch (e) {
      if (e instanceof BadRequestException) return { ok: false };
      throw e;
    }
  }

  async refund(userId: string, charged: number, feature: string) {
    if (!charged || charged <= 0) return;
    await this.credit(userId, charged, WalletTxKind.REFUND, feature, MAX_BALANCE_RIAL);
  }

  async claimDailyNotice(userId: string, feature: string, dateKey: string): Promise<boolean> {
    try {
      await this.prisma.walletNotice.create({ data: { userId, feature, dateKey } });
      return true;
    } catch {
      return false;
    }
  }

  private async price(feature: WalletFeature): Promise<number> {
    const cfg = await this.readConfig();
    if (!cfg.enabled) return 0;
    if (feature === 'telegram') return Math.max(0, cfg.telegramDailyRial);
    if (feature === 'suggest') return Math.max(0, cfg.suggestRial);
    return Math.max(0, cfg.rebalanceRial);
  }

  private async credit(
    userId: string,
    amountRial: number,
    kind: WalletTxKind,
    note?: string,
    maxAmount = MAX_CHARGE_RIAL,
  ) {
    if (!Number.isInteger(amountRial) || amountRial < 1 || amountRial > maxAmount) {
      throw new BadRequestException('مبلغ شارژ نامعتبر است.');
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { walletBalanceRial: true },
      });
      if (!current) throw new NotFoundException('کاربر پیدا نشد');
      if (current.walletBalanceRial > MAX_BALANCE_RIAL - amountRial) {
        throw new BadRequestException('سقف موجودی کیف پول پر شده است.');
      }
      const user = await tx.user.update({
        where: { id: userId },
        data: { walletBalanceRial: { increment: amountRial } },
        select: { walletBalanceRial: true },
      });
      await tx.walletTransaction.create({
        data: {
          userId,
          amountRial,
          kind,
          balanceAfterRial: user.walletBalanceRial,
          note: note?.trim().slice(0, 200) || null,
        },
      });
      return user.walletBalanceRial;
    });
  }

  private async zarinpal(sandbox: boolean, action: 'request' | 'verify', payload: Record<string, unknown>) {
    const host = sandbox ? 'https://sandbox.zarinpal.com' : 'https://api.zarinpal.com';
    const res = await fetch(`${host}/pg/v4/payment/${action}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let body: ZarinpalBody;
    try {
      body = JSON.parse(text) as ZarinpalBody;
    } catch {
      throw new BadRequestException('پاسخ درگاه پرداخت نامعتبر بود.');
    }
    if (!res.ok && !body.data) {
      throw new BadRequestException('درگاه پرداخت پاسخ نداد.');
    }
    return body;
  }
}
