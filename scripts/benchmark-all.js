#!/usr/bin/env node

const autocannon = require('autocannon');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

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

// 軽いウォームアップを入れてJITの偏りを減らす
const warmupConfig = {
  connections: 20,
  duration: 5,
  pipelining: 1,
};

// cgroupパス（v2優先、v1フォールバック）
const CGROUP_CPU_STAT = ['/sys/fs/cgroup/cpu.stat', '/sys/fs/cgroup/cpuacct/cpuacct.usage'];
const CGROUP_CPU_MAX = ['/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu/cpu.cfs_quota_us'];
const CGROUP_CPU_PERIOD = ['/sys/fs/cgroup/cpu/cpu.cfs_period_us'];
const CGROUP_MEM_CURRENT = [
  '/sys/fs/cgroup/memory.current',
  '/sys/fs/cgroup/memory/memory.usage_in_bytes',
];
const CGROUP_MEM_PEAK = [
  '/sys/fs/cgroup/memory.peak',
  '/sys/fs/cgroup/memory/memory.max_usage_in_bytes',
];

const reportDir = './reports';

function readNumberFromFile(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8').trim();
        const num = Number(raw.split(/\s+/)[0]);
        if (!Number.isNaN(num)) return num;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function readCpuStat() {
  // cgroup v2: cpu.stat (usage_usec, user_usec, system_usec)
  const v2Path = CGROUP_CPU_STAT[0];
  if (fs.existsSync(v2Path)) {
    try {
      const content = fs.readFileSync(v2Path, 'utf8');
      const data = Object.fromEntries(
        content
          .trim()
          .split('\n')
          .map((line) => line.split(/\s+/))
          .map(([k, v]) => [k, Number(v)]),
      );
      return {
        usageUsec: data.usage_usec ?? null,
        userUsec: data.user_usec ?? null,
        systemUsec: data.system_usec ?? null,
      };
    } catch {
      // ignore
    }
  }

  // cgroup v1 fallback: cpuacct.usage (nanoseconds)
  const v1Usage = readNumberFromFile([CGROUP_CPU_STAT[1]]);
  if (v1Usage !== null) {
    return { usageUsec: v1Usage / 1000, userUsec: null, systemUsec: null };
  }
  return null;
}

function detectCpuLimit() {
  // cgroup v2: cpu.max => "<quota> <period>"
  const cpuMaxPath = CGROUP_CPU_MAX[0];
  if (fs.existsSync(cpuMaxPath)) {
    try {
      const [quotaStr, periodStr] = fs.readFileSync(cpuMaxPath, 'utf8').trim().split(/\s+/);
      if (quotaStr === 'max') return null; // no explicit limit
      const quota = Number(quotaStr);
      const period = Number(periodStr);
      if (!Number.isNaN(quota) && !Number.isNaN(period) && period > 0) {
        return quota / period;
      }
    } catch {
      // ignore
    }
  }

  // cgroup v1: cpu.cfs_quota_us / cpu.cfs_period_us
  const quota = readNumberFromFile([CGROUP_CPU_MAX[1]]);
  const period = readNumberFromFile(CGROUP_CPU_PERIOD);
  if (quota !== null && period !== null && quota > 0 && period > 0) {
    return quota / period;
  }
  return null;
}

function readMemoryCurrent() {
  return readNumberFromFile(CGROUP_MEM_CURRENT);
}

function readMemoryPeak() {
  return readNumberFromFile(CGROUP_MEM_PEAK);
}

function startMemorySampler(intervalMs = 250) {
  let peak = 0;
  const samples = [];
  const timer = setInterval(() => {
    const value = readMemoryCurrent();
    if (value !== null) {
      samples.push(value);
      if (value > peak) peak = value;
    }
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(timer);
      const avg = samples.length
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : null;
      const reportedPeak = readMemoryPeak();
      return {
        avgBytes: avg,
        peakBytes: reportedPeak || peak || null,
      };
    },
  };
}

function computeCpuUsage(start, end, elapsedMs, cpuLimit) {
  if (!start || !end || !end.usageUsec || !elapsedMs) return null;
  const deltaUsec = end.usageUsec - (start.usageUsec || 0);
  const denomUsec = elapsedMs * 1000 * (cpuLimit || 1);
  const avgPercent = denomUsec > 0 ? (deltaUsec / denomUsec) * 100 : null;
  return {
    deltaUsec,
    elapsedMs,
    avgPercent,
    cpuLimit: cpuLimit || null,
    start,
    end,
  };
}

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

function runAutocannon(endpoint, overrides = {}) {
  const merged = {
    ...config,
    ...overrides,
    url: `${config.url}${endpoint}`,
  };

  return new Promise((resolve, reject) => {
    const instance = autocannon(merged, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function warmup(endpoint) {
  console.log(`Warming up ${endpoint.name} for ${warmupConfig.duration}s...`);
  try {
    await runAutocannon(endpoint.path, warmupConfig);
  } catch (err) {
    console.warn(`Warmup for ${endpoint.name} failed: ${err.message}`);
  }
}

async function runBenchmark(endpoint) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Benchmarking: ${endpoint.name}`);
  console.log(`Endpoint: ${endpoint.path}`);
  console.log('='.repeat(60));

  await resetMemoryTracking();
  await triggerGC();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  await warmup(endpoint);
  await resetMemoryTracking(); // ウォームアップで溜まったメモリ統計をクリア
  await triggerGC();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const cpuLimit = detectCpuLimit();
  const cpuStart = readCpuStat();
  const memSampler = startMemorySampler();
  const startTime = performance.now();

  const result = await runAutocannon(endpoint.path);

  const elapsedMs = performance.now() - startTime;
  const cpuEnd = readCpuStat();
  const memStats = memSampler.stop();
  const cpuStats = computeCpuUsage(cpuStart, cpuEnd, elapsedMs, cpuLimit);

  // Get memory stats after benchmark (includes per-endpoint peak and avg)
  const memAfter = await getMemoryUsage();
  const endpointStats = memAfter?.endpoints?.[endpoint.path] ?? null;

  return { result, memStats, cpuStats, endpointStats, memAfter };
}

async function main() {
  console.log('Starting benchmark suite...');
  console.log(`Configuration: ${config.connections} connections, ${config.duration}s duration\n`);

  const results = [];

  for (const endpoint of endpoints) {
    try {
      const {
        result,
        memStats,
        cpuStats,
        endpointStats,
        memAfter,
      } = await runBenchmark(endpoint);

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
        cgroup: {
          memAvgMb: memStats?.avgBytes ? memStats.avgBytes / 1024 / 1024 : null,
          memPeakMb: memStats?.peakBytes ? memStats.peakBytes / 1024 / 1024 : null,
          cpuAvgPercent: cpuStats?.avgPercent ?? null,
          cpuLimit: cpuStats?.cpuLimit ?? null,
        },
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
    if (result.cgroup.memPeakMb !== null && result.cgroup.memPeakMb !== undefined) {
      console.log(`  cgroup Memory (peak): ${result.cgroup.memPeakMb.toFixed(2)} MB`);
    }
    if (result.cgroup.memAvgMb !== null && result.cgroup.memAvgMb !== undefined) {
      console.log(`  cgroup Memory (avg): ${result.cgroup.memAvgMb.toFixed(2)} MB`);
    }
    if (result.cgroup.cpuAvgPercent !== null && result.cgroup.cpuAvgPercent !== undefined) {
      console.log(
        `  CPU usage (avg): ${result.cgroup.cpuAvgPercent.toFixed(2)}%` +
          (result.cgroup.cpuLimit ? ` of ${result.cgroup.cpuLimit.toFixed(2)} CPUs` : ''),
      );
    }
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
      const memoryPeakRatio =
        result.cgroup.memPeakMb && baseline.cgroup.memPeakMb
          ? ((result.cgroup.memPeakMb / baseline.cgroup.memPeakMb) * 100).toFixed(2)
          : result.memory.peak && baseline.memory.peak
            ? ((result.memory.peak / baseline.memory.peak) * 100).toFixed(2)
            : null;
      const memoryAvgRatio =
        result.cgroup.memAvgMb && baseline.cgroup.memAvgMb
          ? ((result.cgroup.memAvgMb / baseline.cgroup.memAvgMb) * 100).toFixed(2)
          : result.memory.avg && baseline.memory.avg
            ? ((result.memory.avg / baseline.memory.avg) * 100).toFixed(2)
            : null;
      const cpuRatio =
        result.cgroup.cpuAvgPercent !== null && baseline.cgroup.cpuAvgPercent !== null
          ? ((result.cgroup.cpuAvgPercent / baseline.cgroup.cpuAvgPercent) * 100).toFixed(2)
          : null;

      comparison[result.name] = {
        rpsRatio: parseFloat(rpsRatio),
        latencyRatio: parseFloat(latencyRatio),
        memoryPeakRatio: memoryPeakRatio ? parseFloat(memoryPeakRatio) : null,
        memoryAvgRatio: memoryAvgRatio ? parseFloat(memoryAvgRatio) : null,
        cpuRatio: cpuRatio ? parseFloat(cpuRatio) : null,
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
      if (cpuRatio) {
        console.log(`  CPU usage: ${cpuRatio}% of baseline`);
      }

      if (result.rps < baseline.rps) {
        const degradation = (((baseline.rps - result.rps) / baseline.rps) * 100).toFixed(2);
        console.log(`  Performance degradation: ${degradation}%`);
      }
    });
  }

  // Save results to JSON file
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
      cgroup: {
        memAvgMb:
          r.cgroup.memAvgMb !== null && r.cgroup.memAvgMb !== undefined
            ? parseFloat(r.cgroup.memAvgMb.toFixed(2))
            : null,
        memPeakMb:
          r.cgroup.memPeakMb !== null && r.cgroup.memPeakMb !== undefined
            ? parseFloat(r.cgroup.memPeakMb.toFixed(2))
            : null,
        cpuAvgPercent:
          r.cgroup.cpuAvgPercent !== null && r.cgroup.cpuAvgPercent !== undefined
            ? parseFloat(r.cgroup.cpuAvgPercent.toFixed(2))
            : null,
        cpuLimit:
          r.cgroup.cpuLimit !== null && r.cgroup.cpuLimit !== undefined
            ? parseFloat(r.cgroup.cpuLimit.toFixed(2))
            : null,
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
