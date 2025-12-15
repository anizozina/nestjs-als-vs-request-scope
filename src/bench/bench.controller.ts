import { Controller, Get, Param, Headers } from '@nestjs/common';
import * as v8 from 'v8';
import { SingletonLoggerService } from '../services/singleton-logger.service';
import { RequestScopeLoggerService } from '../services/request-scope-logger.service';
import { ClsLoggerService } from '../services/cls-logger.service';
import {
  getAllEndpointStats,
  resetAllEndpointStats,
  resetEndpointStats,
} from './memory-tracking.interceptor';

/**
 * Singleton と CLS のベンチマーク用コントローラー
 * 
 * これらはSingletonスコープのServiceを使うので、
 * このコントローラー自体もSingletonで問題ない
 */
@Controller('bench')
export class BenchController {
  constructor(
    private readonly singletonLogger: SingletonLoggerService,
    private readonly clsLogger: ClsLoggerService,
  ) {}

  @Get('memory')
  getMemory() {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const endpointStats = getAllEndpointStats();

    return {
      current: {
        heapUsed: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotal: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
        rss: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
        external: Math.round((memUsage.external / 1024 / 1024) * 100) / 100,
      },
      v8: {
        usedHeapSize:
          Math.round((heapStats.used_heap_size / 1024 / 1024) * 100) / 100,
        totalHeapSize:
          Math.round((heapStats.total_heap_size / 1024 / 1024) * 100) / 100,
        heapSizeLimit:
          Math.round((heapStats.heap_size_limit / 1024 / 1024) * 100) / 100,
      },
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
    return {
      success: true,
      message: `Memory stats reset for /bench/${endpoint}`,
    };
  }

  @Get('gc')
  forceGC() {
    if (global.gc) {
      global.gc();
      return { success: true, message: 'GC triggered' };
    }
    return {
      success: false,
      message: 'GC not exposed. Run node with --expose-gc',
    };
  }

  /**
   * Singleton パターン
   * - Request IDは引数で渡す（Singletonなのでインスタンスに保持できない）
   * - 呼び出し側でRequest IDを管理する必要がある
   */
  @Get('singleton')
  getSingleton(@Headers('x-request-id') headerRequestId?: string) {
    const requestId =
      headerRequestId ||
      `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return this.singletonLogger.processRequest(requestId);
  }

  /**
   * CLS (nestjs-cls) パターン
   * - ServiceはSingletonスコープ（DI再構築コストなし）
   * - でもリクエストごとに異なるRequest IDにアクセスできる
   * - AsyncLocalStorageで自動的にリクエストコンテキストが伝播
   */
  @Get('cls')
  getCls() {
    return this.clsLogger.processRequest();
  }
}

/**
 * Request Scope のベンチマーク用コントローラー
 * 
 * Request ScopeのServiceを注入すると、このコントローラーも
 * Request Scopeにバブルアップする（NestJSの仕様）
 */
@Controller('bench')
export class BenchRequestScopeController {
  constructor(
    private readonly requestScopeLogger: RequestScopeLoggerService,
  ) {}

  /**
   * Request Scope パターン
   * - リクエストごとにServiceインスタンスが新規作成される
   * - Request IDはコンストラクタで取得してインスタンスに保持
   * - 呼び出し側でRequest IDを意識する必要がない
   * - ただしDI再構築コストが毎リクエスト発生
   */
  @Get('request-scope')
  getRequestScope() {
    return this.requestScopeLogger.processRequest();
  }
}
