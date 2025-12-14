# これは何

NestJSにおける Request Scope と Async Local Storage を比較するやーつ

前提として、Request Scopeを使うとリクエストごとに依存するクラスが再生成される
無駄にオーバーヘッドがかかることを計測し、ALSでどの程度抑制されるのかを見る

## 計測対象

- `/bench/singleton` - 普通のSingleton
- `/bench/request-scope` - Request Scopeのサービスに依存。Controller自体もRequest Scopeになる
- `/bench/cls` - nestjs-clsでリクエストコンテキストを管理

環境差分が出ないように、Dockerでリソース制限をかけて、CPU 1コア・メモリ512MBの環境で動かす

## 使い方

### 準備

```bash
pnpm install
docker-compose build
```

### 起動

```bash
docker-compose up -d
```

http://localhost:3000 で起動するはず

### ベンチマーク実行

```bash
docker-compose exec app pnpm run benchmark:all
```

30秒間、100コネクションで負荷をかけてRPSを計測する。

### プロファイリング実行

Node.js組み込みプロファイラ（`--prof`）でCPU使用率を分析する。

```bash
# 全エンドポイントを一括プロファイル（所要時間: 約90秒）
docker-compose run --rm app pnpm run profile:all

# または個別に実行
docker-compose run --rm app pnpm run profile:singleton
docker-compose run --rm app pnpm run profile:request-scope
docker-compose run --rm app pnpm run profile:cls
```

レポートは `reports/` ディレクトリに生成される

```bash
cat reports/singleton-profile.txt | head -100
cat reports/request-scope-profile.txt | head -100
cat reports/cls-profile.txt | head -100
```

## 実測結果

### パフォーマンス比較

| エンドポイント | Req/s | 対 Singleton | レイテンシ (avg) | レイテンシ (p99) |
|--------------|-------|-------------|----------------|----------------|
| **Singleton** | 11,116 | 100% (baseline) | 8.5ms | 47ms |
| **Request Scope** | 7,694 | **69.2%** (-30.8%) | 12.5ms | 51ms |
| **CLS** | 10,439 | **93.9%** (-6.1%) | 9.1ms | 48ms |

**結論**: Request Scopeは約30%のパフォーマンス劣化が発生するが、CLSは約6%の劣化に抑えられる

### プロファイル分析

**Request Scope 固有のオーバーヘッド**（CPU プロファイルに出現）:

- `OrdinaryGetMetadata` (2.6%) - リフレクションメタデータ取得
- `resolveConstructorParams` (1.1%) - DIコンストラクタ解決
- `resolveProperties` (1.0%) - プロパティインジェクション
- `loadInstance` (1.0%) - インスタンス生成
- `createContext` (1.0%) - リクエストコンテキスト作成

これらの関数は **Singleton と CLS には出現せず**、リクエスト毎のDI処理によるオーバーヘッドがパフォーマンス劣化の直接的な原因となっている。

## 技術スタック

- NestJS 11 (Fastify adapter)
- nestjs-cls (Async Local Storage)
- autocannon (負荷テスト)
- Node.js --prof (CPUプロファイラ)
