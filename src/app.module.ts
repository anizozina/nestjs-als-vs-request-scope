import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  BenchController,
  BenchRequestScopeController,
} from './bench/bench.controller';
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
  providers: [AppService, SingletonLoggerService, RequestScopeLoggerService],
})
export class AppModule {}
