#!/usr/bin/env node

const autocannon = require('autocannon');
const fs = require('fs');
const path = require('path');

const endpoints = [
  { name: 'Singleton', path: '/bench/singleton' },
  { name: 'Request Scope', path: '/bench/request-scope' },
  { name: 'CLS (nestjs-cls)', path: '/bench/cls' },
];

const config = {
  url: 'http://localhost:3000',
  connections: 100,
  duration: 30,
  pipelining: 1,
};

async function getMemoryUsage() {
  try {
    const res = await fetch(`${config.url}/bench/memory`);
    return await res.json();
  } catch {
    return null;
  }
}

async function triggerGC() {
  try {
    await fetch(`${config.url}/bench/gc`);
  } catch {
    // ignore
  }
}

async function resetMemoryTracking() {
  try {
    await fetch(`${config.url}/bench/memory/reset`);
  } catch {
    // ignore
  }
}

async function runBenchmark(endpoint) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Benchmarking: ${endpoint.name}`);
  console.log(`Endpoint: ${endpoint.path}`);
  console.log('='.repeat(60));

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        ...config,
        url: `${config.url}${endpoint.path}`,
      },
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      },
    );

    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function main() {
  console.log('Starting benchmark suite...');
  console.log(`Configuration: ${config.connections} connections, ${config.duration}s duration\n`);

  const results = [];

  for (const endpoint of endpoints) {
    try {
      // Reset memory tracking for this endpoint, trigger GC, and wait for stable state
      await resetMemoryTracking();
      await triggerGC();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await runBenchmark(endpoint);

      // Get memory stats after benchmark (includes per-endpoint peak and avg)
      const memAfter = await getMemoryUsage();
      const endpointStats = memAfter?.endpoints?.[endpoint.path] ?? null;

      results.push({
        name: endpoint.name,
        path: endpoint.path,
        rps: result.requests.average,
        latency: {
          mean: result.latency.mean,
          p50: result.latency.p50 || result.latency.p2_5,
          p95: result.latency.p97_5 || result.latency.p99,
          p99: result.latency.p99,
        },
        throughput: result.throughput.average,
        memory: {
          peak: endpointStats?.peak ?? null,
          avg: endpointStats?.avg ?? null,
          sampleCount: endpointStats?.sampleCount ?? null,
          v8UsedHeapSize: memAfter?.v8?.usedHeapSize ?? null,
        },
      });

      // Wait a bit between benchmarks
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Error benchmarking ${endpoint.name}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('BENCHMARK RESULTS SUMMARY');
  console.log('='.repeat(60));

  results.forEach((result) => {
    console.log(`\n${result.name}:`);
    console.log(`  Path: ${result.path}`);
    console.log(`  Avg RPS: ${result.rps.toFixed(2)}`);
    console.log(`  Latency (mean): ${result.latency.mean.toFixed(2)}ms`);
    console.log(`  Latency (p97.5): ${result.latency.p95.toFixed(2)}ms`);
    console.log(`  Latency (p99): ${result.latency.p99.toFixed(2)}ms`);
    console.log(`  Avg Throughput: ${(result.throughput / 1024 / 1024).toFixed(2)} MB/s`);
    if (result.memory.peak) {
      console.log(`  Memory (peak): ${result.memory.peak} MB`);
      console.log(`  Memory (avg): ${result.memory.avg} MB`);
      console.log(`  Memory (samples): ${result.memory.sampleCount}`);
    }
  });

  // Calculate performance comparison
  const comparison = {};
  if (results.length >= 2) {
    const baseline = results[0]; // Singleton
    console.log('\n' + '='.repeat(60));
    console.log('PERFORMANCE COMPARISON (vs Singleton baseline)');
    console.log('='.repeat(60));

    results.slice(1).forEach((result) => {
      const rpsRatio = ((result.rps / baseline.rps) * 100).toFixed(2);
      const latencyRatio = ((result.latency.mean / baseline.latency.mean) * 100).toFixed(2);
      const memoryPeakRatio = result.memory.peak && baseline.memory.peak
        ? ((result.memory.peak / baseline.memory.peak) * 100).toFixed(2)
        : null;
      const memoryAvgRatio = result.memory.avg && baseline.memory.avg
        ? ((result.memory.avg / baseline.memory.avg) * 100).toFixed(2)
        : null;

      comparison[result.name] = {
        rpsRatio: parseFloat(rpsRatio),
        latencyRatio: parseFloat(latencyRatio),
        memoryPeakRatio: memoryPeakRatio ? parseFloat(memoryPeakRatio) : null,
        memoryAvgRatio: memoryAvgRatio ? parseFloat(memoryAvgRatio) : null,
        degradation: result.rps < baseline.rps
          ? parseFloat((((baseline.rps - result.rps) / baseline.rps) * 100).toFixed(2))
          : 0,
      };

      console.log(`\n${result.name}:`);
      console.log(`  RPS: ${rpsRatio}% of baseline`);
      console.log(`  Latency: ${latencyRatio}% of baseline`);
      if (memoryPeakRatio) {
        console.log(`  Memory (peak): ${memoryPeakRatio}% of baseline`);
      }
      if (memoryAvgRatio) {
        console.log(`  Memory (avg): ${memoryAvgRatio}% of baseline`);
      }

      if (result.rps < baseline.rps) {
        const degradation = (((baseline.rps - result.rps) / baseline.rps) * 100).toFixed(2);
        console.log(`  Performance degradation: ${degradation}%`);
      }
    });
  }

  // Save results to JSON file
  const reportDir = './reports';
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    config: {
      connections: config.connections,
      duration: config.duration,
    },
    results: results.map((r) => ({
      name: r.name,
      path: r.path,
      rps: parseFloat(r.rps.toFixed(2)),
      latency: {
        mean: parseFloat(r.latency.mean.toFixed(2)),
        p95: parseFloat(r.latency.p95.toFixed(2)),
        p99: parseFloat(r.latency.p99.toFixed(2)),
      },
      memory: {
        peak: r.memory.peak ?? null,
        avg: r.memory.avg ?? null,
        sampleCount: r.memory.sampleCount ?? null,
      },
    })),
    comparison,
  };

  const reportPath = path.join(reportDir, 'benchmark-results.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nResults saved to: ${reportPath}`);

  console.log('\n');
}

main().catch((error) => {
  console.error('Benchmark suite failed:', error);
  process.exit(1);
});
