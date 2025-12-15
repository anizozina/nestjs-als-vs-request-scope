import { Controller, Get, Param } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import * as v8 from 'v8';
import { SingletonLoggerService } from '../services/singleton-logger.service';
import { RequestScopeLoggerService } from '../services/request-scope-logger.service';
import {
  getAllEndpointStats,
  resetAllEndpointStats,
  resetEndpointStats,
} from './memory-tracking.interceptor';

@Controller('bench')
export class BenchController {
  constructor(
    private readonly singletonLogger: SingletonLoggerService,
    private readonly cls: ClsService,
  ) {}

  @Get('memory')
  getMemory() {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const endpointStats = getAllEndpointStats();

    return {
      // Current memory state
      current: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
        rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
        external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
      },
      // v8.getHeapStatistics()
      v8: {
        usedHeapSize: Math.round(heapStats.used_heap_size / 1024 / 1024 * 100) / 100,
        totalHeapSize: Math.round(heapStats.total_heap_size / 1024 / 1024 * 100) / 100,
        heapSizeLimit: Math.round(heapStats.heap_size_limit / 1024 / 1024 * 100) / 100,
      },
      // Per-endpoint statistics (tracked by interceptor)
      endpoints: endpointStats,
      unit: 'MB',
    };
  }

  @Get('memory/reset')
  resetMemoryTrackingAll() {
    resetAllEndpointStats();
    return { success: true, message: 'All endpoint memory stats reset' };
  }

  @Get('memory/reset/:endpoint')
  resetMemoryTrackingEndpoint(@Param('endpoint') endpoint: string) {
    resetEndpointStats(`/bench/${endpoint}`);
    return { success: true, message: `Memory stats reset for /bench/${endpoint}` };
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
