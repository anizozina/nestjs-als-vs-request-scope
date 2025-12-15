import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { load } from '../util/load';

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Request Scope を使用したロガーサービス
 * 
 * ポイント：
 * - リクエストごとにインスタンスが新規作成される
 * - Request IDをインスタンス変数として保持できる
 * - ただしDI再構築コストが毎リクエスト発生する
 */
@Injectable({ scope: Scope.REQUEST })
export class RequestScopeLoggerService {
  private counter = 0;
  private readonly requestId: string;

  constructor(@Inject(REQUEST) request: RequestWithHeaders) {
    // リクエストからIDを取得してインスタンスに保持
    this.requestId =
      (request.headers['x-request-id'] as string) ||
      `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  processRequest(): object {
    this.counter++;

    const result = {
      requestId: this.requestId,
      timestamp: Date.now(),
      counter: this.counter,
      scope: 'REQUEST',
    };

    
    // ちょっとだけCPUに負荷をかける
    load();

    return result;
  }

  getRequestId(): string {
    return this.requestId;
  }

  getCounter(): number {
    return this.counter;
  }
}
