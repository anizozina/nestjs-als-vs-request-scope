import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

/**
 * CLS (Continuation Local Storage) を使用したロガーサービス
 * 
 * ポイント：
 * - Singletonスコープ（デフォルト）なのでDI再構築コストがない
 * - でもリクエストごとに異なるRequest IDにアクセスできる
 * - AsyncLocalStorageを使ってリクエストコンテキストを伝播
 */
@Injectable()
export class ClsLoggerService {
  private counter = 0;

  constructor(private readonly cls: ClsService) {}

  processRequest(): object {
    this.counter++;

    // CLSからリクエストIDを取得（リクエストスコープのようにインスタンスに保持しない）
    const requestId = this.cls.getId() || `fallback-${Date.now()}`;

    const result = {
      requestId,
      timestamp: Date.now(),
      counter: this.counter,
      scope: 'CLS',
    };

    // Simulate minimal computation (avoid I/O)
    for (let i = 0; i < 100; i++) {
      Math.sqrt(i);
    }

    return result;
  }

  getCounter(): number {
    return this.counter;
  }
}
