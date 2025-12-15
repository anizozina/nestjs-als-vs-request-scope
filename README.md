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
docker-compose build
```

### 計測の実行

```bash
# コンテナを起動
docker-compose up -d

# ベンチマーク実行（RPS、レイテンシ、メモリを計測）
docker-compose exec app pnpm run benchmark:all

# プロファイリング実行（CPU負荷の内訳を分析）
docker-compose run --rm app pnpm run profile:all
```

### 計測結果の出力先

計測結果は `reports/` ディレクトリに出力される：

| ファイル | 内容 |
|----------|------|
| `benchmark-results.json` | RPS、レイテンシ、メモリ使用量 |
| `singleton-profile.txt` | Singleton の CPU プロファイル |
| `request-scope-profile.txt` | Request Scope の CPU プロファイル |
| `cls-profile.txt` | CLS の CPU プロファイル |

### AIに分析させる

計測結果をAIに読み込ませてサマリを生成できる。以下のプロンプトを使用：

```md
あなたはNode.jsパフォーマンスチューニングの専門家です。

## タスク
`reports/` ディレクトリにある計測結果を分析し、サマリを作成してください。

## 読み込むファイル
- `benchmark-results.json` - RPS、レイテンシ、メモリ使用量
- `singleton-profile.txt` - Singleton の CPU プロファイル
- `request-scope-profile.txt` - Request Scope の CPU プロファイル（大きい場合は先頭150行）
- `cls-profile.txt` - CLS の CPU プロファイル

## 出力形式

### 1. サマリ（5行以内）
- 3パターンのパフォーマンス順位
- Request Scopeが遅い理由を一言で
- おすすめのパターン

### 2. 比較表
| パターン | RPS | Latency | Memory | 備考 |
※ Singletonを基準(100%)として相対値を表示

### 3. Request Scopeが遅い原因（簡潔に）
benchmark-results.jsonの数値と、プロファイルで見つかった
Request Scope固有の関数を根拠として説明。
```

## 実測結果

---

# NestJS ALS vs Request Scope ベンチマーク分析サマリ

## 1. サマリ（5行以内）

- **パフォーマンス順位**: Singleton > CLS (nestjs-cls) > Request Scope
- **Request Scopeが遅い理由**: リクエスト毎にDI（依存性注入）とクラスのインスタンス生成が発生
- **おすすめ**: **CLS (nestjs-cls)** - Singleton同等の高速性を維持しつつ、リクエストスコープのデータ共有が可能

---

## 2. 比較表

| パターン | RPS | Latency (mean) | Memory (avg) | 備考 |
|----------|-----|----------------|--------------|------|
| **Singleton** | 4,639 (100%) | 21.12ms (100%) | 19.89MB (100%) | ベースライン |
| **CLS (nestjs-cls)** | 4,253 (92%) | 23.08ms (109%) | 20.50MB (103%) | AsyncLocalStorage使用、軽量なオーバーヘッド |
| **Request Scope** | 3,718 (80%) | 26.42ms (125%) | 20.83MB (105%) | DI再構築コストが顕著 |

**ポイント**:
- Request ScopeはSingletonと比べて **RPS 約20%低下**、レイテンシ **約25%増加**
- CLSはSingletonと比べて **RPS 約8%低下** のみで、実用上許容範囲

---

## 3. Request Scopeが遅い原因（簡潔に）

### 数値的根拠（benchmark-results.jsonより）
- RPS: 3,718 vs Singleton 4,639 → **約20%の性能劣化**
- レイテンシ: 26.42ms vs 21.12ms → **5.3ms増加**

### プロファイルで発見されたRequest Scope固有の関数

Request Scopeプロファイルにのみ頻出する、**Injector（DI）関連の関数**:

| 関数 | ticks | 説明 |
|------|-------|------|
| `loadInstance` (injector.js) | 27 | インスタンス生成 |
| `resolveProperties` (injector.js) | 24 | プロパティ解決 |
| `instantiateClass` (injector.js) | 24 | クラスのnew |
| `resolveConstructorParams` (injector.js) | 21 | コンストラクタ引数解決 |
| `loadCtorMetadata` (injector.js) | 19 | メタデータ読み込み |
| `createContext` (context-creator.js) | 35 | コンテキスト生成 |
| `OrdinaryGetMetadata` (reflect-metadata) | 59 (2.0%) | リフレクション処理 |
| `getByRequest` (context-id-factory.js) | 12 | リクエストID取得 |
| `getInstanceByContextId` (instance-wrapper.js) | 11 | コンテキスト別インスタンス管理 |

**結論**: Request Scopeでは、リクエストごとに以下の処理が繰り返される：
1. **クラスのインスタンス化** (`instantiateClass`, `loadInstance`)
2. **依存関係の解決** (`resolveConstructorParams`, `resolveProperties`)
3. **メタデータのリフレクション** (`OrdinaryGetMetadata`, `loadCtorMetadata`)

Singletonではこれらが起動時に1回だけ実行されるため、Request Scopeと比較して大幅に高速です。CLSはSingletonインスタンスを維持しつつAsyncLocalStorageでリクエストデータを管理するため、DIオーバーヘッドなく高速に動作します。