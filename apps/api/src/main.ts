import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: (process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'])
      .map((s) => s.trim())
      .filter(Boolean),
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
  const port = Number(process.env.API_PORT ?? 3001);
  const listenHost = process.env.API_LISTEN_HOST ?? '127.0.0.1';
  await app.listen(port, listenHost);
  // eslint-disable-next-line no-console
  console.log(`سبدیار API روی ${listenHost}:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('API bootstrap failed', err);
  process.exit(1);
});
