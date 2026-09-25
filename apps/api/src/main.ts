import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { publicSiteOrigins } from './common/public-sites';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = new Set(
    [...(process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000']), ...publicSiteOrigins()]
      .map((s) => s.trim())
      .filter(Boolean),
  );
  app.enableCors({
    origin: [...allowedOrigins],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api');
  // WCDN با سیاست SMART پاسخ GET بدون هدر کش را نگه می‌دارد؛ وضعیت ورود موبایل همان‌طور خاموش می‌ماند.
  app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  });
  const port = Number(process.env.API_PORT ?? 3001);
  const listenHost = process.env.API_LISTEN_HOST ?? '127.0.0.1';
  await app.listen(port, listenHost);
  // eslint-disable-next-line no-console
  console.log(`API روی ${listenHost}:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('API bootstrap failed', err);
  process.exit(1);
});
