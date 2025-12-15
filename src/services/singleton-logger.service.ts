import { Injectable } from '@nestjs/common';
import { load } from '../util/load';

/**
 * Singleton スコープのロガーサービス
 * 
 * ポイント：
 * - アプリケーション全体で1つのインスタンス
 * - Request IDはメソッド引数で渡す必要がある（インスタンスに保持できない）
 * - DI再構築コストがない（最も高速）
 * - ただしリクエストコンテキストの伝播が面倒
 */
@Injectable()
export class SingletonLoggerService {
  private counter = 0;

  /**
   * Request IDを引数で受け取る必要がある
   * （Singletonなのでインスタンスに保持するとリクエスト間で共有されてしまう）
   */
  processRequest(requestId: string): object {
    this.counter++;

    const result = {
      requestId,
      timestamp: Date.now(),
      counter: this.counter,
      scope: 'SINGLETON',
    };

    
    // ちょっとだけCPUに負荷をかける
    load();

    return result;
  }

  getCounter(): number {
    return this.counter;
  }
}
