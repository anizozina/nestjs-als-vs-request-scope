# これは何

NestJSにおける Request Scope と Async Local Storage (CLS) を比較するベンチマーク

## 背景

Request Scopeを使うとリクエストごとにServiceのインスタンスが再生成され、DIのオーバーヘッドが発生する。
CLSを使えばSingletonのパフォーマンスを維持しつつ、リクエストスコープのようにリクエストIDを自動管理できる。

## 3パターンの実装比較

| パターン | エンドポイント | Serviceスコープ | Request ID管理 | DIコスト |
|----------|----------------|-----------------|----------------|----------|
| **Singleton** | `/bench/singleton` | Singleton | 引数で渡す | なし |
| **Request Scope** | `/bench/request-scope` | Request | コンストラクタで取得・保持 | 毎リクエスト |
| **CLS** | `/bench/cls` | **Singleton** | CLSから取得 | なし |

### Singleton パターン
```typescript
@Injectable()
export class SingletonLoggerService {
  processRequest(requestId: string) { // ← 引数で渡す必要がある
    // ...
  }
}
```
- Request IDを呼び出し側で管理する必要がある
- 深いコールスタックではバケツリレーが発生

### Request Scope パターン
```typescript
@Injectable({ scope: Scope.REQUEST })
export class RequestScopeLoggerService {
  private readonly requestId: string;
  
  constructor(@Inject(REQUEST) request: Request) {
    this.requestId = request.headers['x-request-id']; // ← インスタンスに保持
  }
  
  processRequest() { // ← 引数不要
    // this.requestId で参照可能
  }
}
```
- Request IDをインスタンスに保持できて便利
- ただし毎リクエストでインスタンス生成 + DI解決が発生

### CLS パターン（推奨）
```typescript
@Injectable() // ← Singletonスコープ
export class ClsLoggerService {
  constructor(private readonly cls: ClsService) {}
  
  processRequest() { // ← 引数不要
    const requestId = this.cls.getId(); // ← CLSから取得
  }
}
```
- Singletonなので起動時に1回だけインスタンス生成
- AsyncLocalStorageでリクエストコンテキストが自動伝播
- **Request Scopeの利便性 + Singletonのパフォーマンス**

## 計測環境

環境差分が出ないように、Dockerでリソース制限をかけて実行：
- CPU: 1コア
- メモリ: 512MB

## 使い方

### 準備

```bash
docker-compose build
```

### 計測の実行（Dockerコンテナ内で行う）

```bash
# コンテナを起動（Nodeは --expose-gc で立ち上がる）
docker-compose up -d

# ベンチマーク実行（RPS/レイテンシ + cgroup CPU/メモリを取得）
docker-compose exec app pnpm run benchmark:all

# プロファイリング実行（CPU負荷の内訳を分析）
docker-compose run --rm app pnpm run profile:all
```

計測フロー（benchmark:all 内部）
- 各エンドポイントごとに 5s/20conn のウォームアップを実施（計測外）
- ウォームアップ後にメモリ統計をリセットし、GC を1回呼び出し
- 本計測: 30s / 100 connections / pipelining 1（autocannon）
- 計測中は cgroup から CPU 使用率とメモリ（avg/peak）をサンプリングし JSON に保存
- 追加でアプリ側のメモリトラッキング（/bench/memory）も従来どおり取得

メモ
- Docker の cgroup v2 を優先し、v1 もフォールバックで読み取ります。
- Node をローカルで直接動かす場合は `node --expose-gc dist/main` などで GC を有効にしてください（GC が無効だと初期化 GC だけスキップされます）。

### 計測結果の出力先

計測結果は `reports/` ディレクトリに出力される：

| ファイル | 内容 |
|----------|------|
| `benchmark-results.json` | RPS、レイテンシ、メモリ使用量 |
| `singleton-profile.txt` | Singleton の CPU プロファイル |
| `request-scope-profile.txt` | Request Scope の CPU プロファイル |
| `cls-profile.txt` | CLS の CPU プロファイル |

`benchmark-results.json` の主な項目
- `results[].rps`, `results[].latency.mean/p95/p99`
- `results[].cgroup.memAvgMb`, `results[].cgroup.memPeakMb`（コンテナ視点の平均/ピーク）
- `results[].cgroup.cpuAvgPercent`, `results[].cgroup.cpuLimit`（コンテナ割当CPUに対する平均使用率）
- `results[].memory.peak/avg/sampleCount`（アプリ内メモリトラッキング: /bench/memory ベース）

### AIに分析させる

計測結果をAIに読み込ませてサマリを生成できる。以下のプロンプトを使用（cgroupベースのCPU/メモリを優先して分析させる）：

```md
あなたはNode.jsパフォーマンスチューニングの専門家です。

## タスク
`reports/` ディレクトリにある計測結果を分析し、サマリを作成してください。
RPS/レイテンシに加え、cgroupベースの CPU 使用率 と メモリ (avg/peak) を重視してください。

## 読み込むファイル
- `benchmark-results.json`
  - `results[].rps`, `results[].latency.*`
  - `results[].cgroup.cpuAvgPercent`, `results[].cgroup.cpuLimit`
  - `results[].cgroup.memAvgMb`, `results[].cgroup.memPeakMb`
  - （参考）`results[].memory.*` はアプリ内メモリトラッキング
- `singleton-profile.txt` - Singleton の CPU プロファイル
- `request-scope-profile.txt` - Request Scope の CPU プロファイル（大きい場合は先頭150行）
- `cls-profile.txt` - CLS の CPU プロファイル

## 出力形式

### 1. サマリ（5行以内）
- 3パターンのパフォーマンス順位
- Request Scopeが遅い理由を一言で
- おすすめのパターン（CPU/メモリとRPSを総合判断）

### 2. 比較表
| パターン | RPS | Latency | CPU(avg%) | Memory(peak) | 備考 |
※ Singletonを基準(100%)として相対値を表示。Memoryは cgroup の peak を優先。

### 3. Request Scopeが遅い原因（簡潔に）
benchmark-results.json の RPS/Latency/CPU/Memory の差と、プロファイルで見つかった
Request Scope固有の関数を根拠として説明。
```

## 実測結果

---

### サマリ（5行以内）
- パフォーマンス順位: CLS > Singleton > Request Scope（RPS/レイテンシ総合）
- Request Scopeが遅い理由: リクエストごとのDI解決・リフレクション/async_hooks処理が多く、実行時間を消費
- 推奨: CLS（RPS最高、レイテンシ最良、CPU同等、メモリavgも最小）
- CPUはいずれも1 vCPUを張り付き（約100%）でスループット差はオーバーヘッド差
- メモリpeakは全パターン同値（cgroup上限 236MB）；avgはCLSが最小

### 比較表（Singleton=100%基準, 括弧内は絶対値）

| パターン | RPS | Latency | CPU(avg%) | Memory(peak) | 備考 |
| --- | --- | --- | --- | --- | --- |
| Singleton | 100% (5661/s) | 100% (17.21ms) | 100% (99.9%) | 100% (236MB) | ベースライン |
| Request Scope | 77.6% (4395/s) | 129.6% (22.31ms) | 100.1% (100.0%) | 100% (236MB) | memAvg 88.5% (172MB) と低いがRPS低下 |
| CLS | 105.1% (5951/s) | 94.8% (16.32ms) | 100.0% (99.9%) | 100% (236MB) | memAvg 78.0% (152MB) と最小 |

### Request Scopeが遅い原因（簡潔に）

- 指標差: RPSが-22%（77.6%）、平均レイテンシ+30%（129.6%）、CPUは同程度（~100%）なのでオーバーヘッド由来。メモリpeakは同じ（cgroup上限）でボトルネックではない。
- プロファイル根拠: Request Scopeのみで依存解決・リフレクション/インジェクタ関連のスタックが上位に多数出現（例: `injector.js`の`loadInstance`/`resolveConstructorParams`/`loadPerContext`や`instance-wrapper.js`の`getByRequest`など）でCPUを占有している。

```28:55:reports/request-scope-profile.txt
28:     28    0.2%    0.9%  JS: *createContext /app/.../helpers/context-creator.js:6:18
32:     25    0.1%    0.8%  JS: *loadInstance /app/.../injector.js:42:23
50:     16    0.1%    0.5%  JS: *resolveConstructorParams /app/.../injector.js:113:35
51:     16    0.1%    0.5%  JS: *loadPerContext /app/.../injector.js:431:25
84:     11    0.1%    0.4%  JS: *getByRequest /app/.../context-id-factory.js:29:24
101:      9    0.1%    0.3%  JS: *RequestScopeLoggerService /app/dist/services/request-scope-logger.service.js:22:16
```  

- 対照: Singleton/CLSではこれらDI関連のヒットが少なく、代わりに通常のリクエスト処理・async_hooksが中心。CLSはスコープを再利用するため、DI生成コストを抑えたままRPS/レイテンシを改善。