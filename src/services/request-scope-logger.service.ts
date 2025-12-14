import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class RequestScopeLoggerService {
  private counter = 0;

  processRequest(requestId: string): object {
    this.counter++;

    // Simulate some lightweight processing
    const result = {
      requestId,
      timestamp: Date.now(),
      counter: this.counter,
      scope: 'REQUEST',
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
