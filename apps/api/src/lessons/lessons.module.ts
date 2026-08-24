import { Module } from '@nestjs/common';
import { LessonsController } from './lessons.controller';

@Module({
  controllers: [LessonsController],
})
export class LessonsModule {}
