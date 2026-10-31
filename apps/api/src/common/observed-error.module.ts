import { Global, Module } from '@nestjs/common';
import { ObservedErrorService } from './observed-error.service';

@Global()
@Module({
  providers: [ObservedErrorService],
  exports: [ObservedErrorService],
})
export class ObservedErrorModule {}
