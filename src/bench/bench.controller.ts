import { Controller, Get } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { SingletonLoggerService } from '../services/singleton-logger.service';
import { RequestScopeLoggerService } from '../services/request-scope-logger.service';

@Controller('bench')
export class BenchController {
  constructor(
    private readonly singletonLogger: SingletonLoggerService,
    private readonly cls: ClsService,
  ) {}

  @Get('memory')
  getMemory() {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
      rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
      external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
      unit: 'MB',
    };
  }

  @Get('gc')
  forceGC() {
    if (global.gc) {
      global.gc();
      return { success: true, message: 'GC triggered' };
    }
    return { success: false, message: 'GC not exposed. Run node with --expose-gc' };
  }

  @Get('singleton')
  getSingleton() {
    const requestId = `req-${Date.now()}-${Math.random()}`;
    return this.singletonLogger.processRequest(requestId);
  }

  @Get('cls')
  getCls() {
    const clsId = this.cls.getId();
    const requestId = clsId || `fallback-${Date.now()}`;

    // Simulate lightweight processing with CLS
    const result = {
      requestId,
      clsId,
      timestamp: Date.now(),
      scope: 'CLS',
    };

    // Simulate minimal computation (avoid I/O)
    for (let i = 0; i < 100; i++) {
      Math.sqrt(i);
    }

    return result;
  }
}

// Separate controller for Request Scope to demonstrate bubbling
@Controller('bench')
export class BenchRequestScopeController {
  constructor(
    private readonly requestScopeLogger: RequestScopeLoggerService,
  ) {}

  @Get('request-scope')
  getRequestScope() {
    const requestId = `req-${Date.now()}-${Math.random()}`;
    return this.requestScopeLogger.processRequest(requestId);
  }
}
