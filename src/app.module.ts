import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  BenchController,
  BenchRequestScopeController,
} from './bench/bench.controller';
import { MemoryTrackingInterceptor } from './bench/memory-tracking.interceptor';
import { SingletonLoggerService } from './services/singleton-logger.service';
import { RequestScopeLoggerService } from './services/request-scope-logger.service';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: any) =>
          req.headers['x-request-id'] ||
          `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
    }),
  ],
  controllers: [AppController, BenchController, BenchRequestScopeController],
  providers: [
    AppService,
    SingletonLoggerService,
    RequestScopeLoggerService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MemoryTrackingInterceptor,
    },
  ],
})
export class AppModule {}
