import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Per-endpoint memory statistics
interface EndpointStats {
  peakHeapUsed: number;
  totalHeapUsed: number;
  sampleCount: number;
}

const endpointStats = new Map<string, EndpointStats>();

function getOrCreateStats(endpoint: string): EndpointStats {
  if (!endpointStats.has(endpoint)) {
    endpointStats.set(endpoint, {
      peakHeapUsed: 0,
      totalHeapUsed: 0,
      sampleCount: 0,
    });
  }
  return endpointStats.get(endpoint)!;
}

@Injectable()
export class MemoryTrackingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const endpoint = request.url?.split('?')[0] || 'unknown';

    // Skip memory endpoints to avoid recursion
    if (endpoint.includes('/bench/memory')) {
      return next.handle();
    }

    // Measure memory before request
    const memBefore = process.memoryUsage().heapUsed;

    return next.handle().pipe(
      tap(() => {
        // Measure memory after request
        const memAfter = process.memoryUsage().heapUsed;
        const heapUsed = memAfter;

        const stats = getOrCreateStats(endpoint);
        if (heapUsed > stats.peakHeapUsed) {
          stats.peakHeapUsed = heapUsed;
        }
        stats.totalHeapUsed += heapUsed;
        stats.sampleCount++;
      }),
    );
  }
}

// Export functions for accessing stats
export function getEndpointStats(endpoint: string): EndpointStats | null {
  return endpointStats.get(endpoint) || null;
}

export function getAllEndpointStats(): Record<string, {
  peak: number;
  avg: number;
  sampleCount: number;
}> {
  const result: Record<string, { peak: number; avg: number; sampleCount: number }> = {};
  
  for (const [endpoint, stats] of endpointStats) {
    result[endpoint] = {
      peak: Math.round(stats.peakHeapUsed / 1024 / 1024 * 100) / 100,
      avg: stats.sampleCount > 0
        ? Math.round((stats.totalHeapUsed / stats.sampleCount) / 1024 / 1024 * 100) / 100
        : 0,
      sampleCount: stats.sampleCount,
    };
  }
  
  return result;
}

export function resetAllEndpointStats(): void {
  endpointStats.clear();
}

export function resetEndpointStats(endpoint: string): void {
  endpointStats.delete(endpoint);
}

