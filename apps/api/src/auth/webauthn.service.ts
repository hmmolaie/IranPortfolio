import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CREDENTIALS = 8;

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async registrationOptions(userId: string) {
    const { rpID, rpName } = this.relyingParty();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { webauthnCredentials: true },
    });
    if (!user) throw new UnauthorizedException('جلسه نامعتبر است');
    if (!user.isActive) throw new UnauthorizedException('حساب کاربری غیرفعال است');
    if (user.webauthnCredentials.length >= MAX_CREDENTIALS) {
      throw new BadRequestException('تعداد دستگاه‌های ثبت‌شده به سقف رسیده است. یکی را حذف کنید.');
    }

    await this.purgeExpired();
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.name?.trim() || user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      timeout: 120_000,
      preferredAuthenticatorType: 'localDevice',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: user.webauthnCredentials.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      })),
    });

    await this.prisma.webAuthnChallenge.create({
      data: {
        userId,
        kind: 'register',
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    friendlyName?: string,
  ) {
    const { rpID, origins } = this.relyingParty();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('جلسه نامعتبر است');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        expectedChallenge: (challenge) => this.consumeChallenge('register', challenge, userId),
      });
    } catch (e) {
      this.logger.warn(`ثبت WebAuthn ناموفق: ${(e as Error).message}`);
      throw new UnauthorizedException('ثبت اثر انگشت یا چهره ناموفق بود. دوباره تلاش کنید.');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('ثبت اثر انگشت یا چهره تأیید نشد.');
    }

    const info = verification.registrationInfo;
    const credentialId = info.credential.id;
    const existing = await this.prisma.webAuthnCredential.findUnique({ where: { credentialId } });
    if (existing) {
      throw new BadRequestException('این دستگاه قبلاً برای ورود زیست‌سنجی ثبت شده است.');
    }

    const row = await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: info.credential.counter,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        transports: JSON.stringify(info.credential.transports ?? []),
        friendlyName: (friendlyName ?? '').trim().slice(0, 80) || null,
      },
    });

    return {
      ok: true,
      credential: {
        id: row.id,
        friendlyName: row.friendlyName,
        createdAt: row.createdAt,
      },
    };
  }

  async authenticationOptions(email?: string) {
    const { rpID } = this.relyingParty();
    await this.purgeExpired();

    let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> | undefined;
    const trimmed = email?.trim();
    if (trimmed) {
      const user = await this.prisma.user.findUnique({
        where: { email: trimmed },
        include: { webauthnCredentials: true },
      });
      if (user?.webauthnCredentials.length) {
        allowCredentials = user.webauthnCredentials.map((c) => ({
          id: c.credentialId,
          transports: parseTransports(c.transports),
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 120_000,
      userVerification: 'required',
      allowCredentials,
    });

    await this.prisma.webAuthnChallenge.create({
      data: {
        kind: 'authenticate',
        challenge: options.challenge,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
    return options;
  }

  async verifyAuthentication(response: AuthenticationResponseJSON) {
    const { rpID, origins } = this.relyingParty();
    const credentialId = response?.id;
    if (!credentialId) throw new UnauthorizedException('پاسخ زیست‌سنجی ناقص است');

    const stored = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException('این دستگاه برای ورود زیست‌سنجی ثبت نشده است.');
    }
    if (!stored.user.isActive) throw new UnauthorizedException('حساب کاربری غیرفعال است');

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        expectedChallenge: (challenge) => this.consumeChallenge('authenticate', challenge),
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: stored.counter,
          transports: parseTransports(stored.transports),
        },
      });
    } catch (e) {
      this.logger.warn(`ورود WebAuthn ناموفق: ${(e as Error).message}`);
      throw new UnauthorizedException('تأیید اثر انگشت یا چهره ناموفق بود.');
    }

    if (!verification.verified) {
      throw new UnauthorizedException('تأیید اثر انگشت یا چهره ناموفق بود.');
    }

    await this.prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    return this.auth.sessionFor(stored.user);
  }

  listCredentials(userId: string) {
    return this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        friendlyName: true,
        deviceType: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }

  async removeCredential(userId: string, id: string) {
    const row = await this.prisma.webAuthnCredential.findFirst({ where: { id, userId } });
    if (!row) throw new BadRequestException('دستگاه یافت نشد');
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    return { ok: true };
  }

  private async consumeChallenge(kind: string, challenge: string, userId?: string): Promise<boolean> {
    await this.purgeExpired();
    const row = await this.prisma.webAuthnChallenge.findFirst({
      where: { kind, challenge, ...(userId ? { userId } : {}) },
    });
    if (!row) return false;
    await this.prisma.webAuthnChallenge.delete({ where: { id: row.id } });
    return true;
  }

  private async purgeExpired() {
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  private relyingParty(): { rpID: string; rpName: string; origins: string[] } {
    const rpName = this.config.get<string>('WEBAUTHN_RP_NAME')?.trim() || 'سبدیار';
    const origins = uniqueOrigins([
      ...(this.config.get<string>('WEBAUTHN_ORIGINS') ?? '').split(','),
      this.config.get<string>('PUBLIC_URL') ?? '',
      ...(this.config.get<string>('CORS_ORIGIN') ?? '').split(','),
      'http://localhost:3000',
    ]);
    const explicitRp = this.config.get<string>('WEBAUTHN_RP_ID')?.trim();
    const fromPublic = hostnameOf(this.config.get<string>('PUBLIC_URL') ?? '');
    const fromOrigin = origins.map(hostnameOf).find((h) => h && !isIpHost(h));
    const rpID = stripWww(explicitRp || fromPublic || fromOrigin || 'localhost');

    if (isIpHost(rpID)) {
      throw new BadRequestException(
        'ورود با اثر انگشت یا چهره روی آدرس IP پشتیبانی نمی‌شود. سایت را با دامنه و HTTPS باز کنید.',
      );
    }
    if (!origins.length) {
      throw new BadRequestException('تنظیم مبدأ ورود زیست‌سنجی ناقص است.');
    }
    return { rpID, rpName, origins };
  }
}

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return undefined;
    return arr.filter((t): t is AuthenticatorTransportFuture => typeof t === 'string');
  } catch {
    return undefined;
  }
}

function hostnameOf(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    return new URL(v).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, '');
}

function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function uniqueOrigins(raw: string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const s = item.trim().replace(/\/$/, '');
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const origin = u.origin;
      if (!out.includes(origin)) out.push(origin);
    } catch {
      /* ignore */
    }
  }
  return out;
}
