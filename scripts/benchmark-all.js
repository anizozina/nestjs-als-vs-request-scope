#!/usr/bin/env node

const autocannon = require('autocannon');

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
      const result = await runBenchmark(endpoint);
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
  });

  // Calculate performance comparison
  if (results.length >= 2) {
    const baseline = results[0]; // Singleton
    console.log('\n' + '='.repeat(60));
    console.log('PERFORMANCE COMPARISON (vs Singleton baseline)');
    console.log('='.repeat(60));

    results.slice(1).forEach((result) => {
      const rpsRatio = ((result.rps / baseline.rps) * 100).toFixed(2);
      const latencyRatio = ((result.latency.mean / baseline.latency.mean) * 100).toFixed(2);

      console.log(`\n${result.name}:`);
      console.log(`  RPS: ${rpsRatio}% of baseline`);
      console.log(`  Latency: ${latencyRatio}% of baseline`);

      if (result.rps < baseline.rps) {
        const degradation = (((baseline.rps - result.rps) / baseline.rps) * 100).toFixed(2);
        console.log(`  Performance degradation: ${degradation}%`);
      }
    });
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('Benchmark suite failed:', error);
  process.exit(1);
});
