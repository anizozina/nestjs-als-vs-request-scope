import { Injectable } from '@nestjs/common';

@Injectable()
export class SingletonLoggerService {
  private counter = 0;

  processRequest(requestId: string): object {
    this.counter++;

    // Simulate some lightweight processing
    const result = {
      requestId,
      timestamp: Date.now(),
      counter: this.counter,
      scope: 'SINGLETON',
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
