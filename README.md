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

## 1. サマリ（5行以内）

1. **パフォーマンス順位**: CLS > Singleton > Request Scope（CLSが最速）
2. **Request Scopeが遅い理由**: 毎リクエストでDIコンテナがインスタンス生成＋依存解決を行うオーバーヘッド
3. **おすすめ**: **CLS（nestjs-cls）** — Singletonより高速かつリクエストコンテキストを安全に扱える
4. CLSはAsyncLocalStorageベースで、インスタンス再生成なしにリクエスト固有データを保持
5. Request Scopeは33%のRPS低下があり、本番環境では避けるべき

---

## 2. 比較表

| パターン | RPS | Latency (mean) | Memory (peak) | 備考 |
|----------|-----|----------------|---------------|------|
| **Singleton** | 5,384 (100%) | 18.19ms (100%) | 26.13MB (100%) | ベースライン |
| **Request Scope** | 3,611 (67.1%) | 27.36ms (150.4%) | 26.63MB (101.9%) | ❌ 33%性能低下 |
| **CLS (nestjs-cls)** | 5,696 (105.8%) | 17.07ms (93.8%) | 27.27MB (104.4%) | ✅ 最速 |

---

## 3. Request Scopeが遅い原因（簡潔に）

### 数値的根拠
- RPS: 3,611 vs Singleton 5,384 → **33%低下**
- Latency: 27.36ms vs Singleton 18.19ms → **50%増加**

### プロファイルで見つかったRequest Scope固有の関数
Request Scopeプロファイルに特有の関数群（Singleton/CLSには存在しない）:

| 関数名 | CPU時間 | 説明 |
|--------|---------|------|
| `loadInstance` | 0.7% | DIコンテナがインスタンス生成 |
| `loadCtorMetadata` | 0.7% | コンストラクタメタデータ読込 |
| `resolveConstructorParams` | 0.7% | 依存関係の解決 |
| `instantiateClass` | 0.6% | クラスのインスタンス化 |
| `OrdinaryGetMetadata` | 1.4% | reflect-metadataでデコレータ情報取得 |
| `resolveProperties` | 0.5% | プロパティ注入の解決 |
| `cloneStaticInstance` | 0.3% | 静的インスタンスのクローン |
| `RequestScopeLoggerService` | 0.3% | サービスのコンストラクタ実行 |

### 根本原因
Request Scopeは**毎リクエスト**で以下を実行:
1. Controller/Serviceのインスタンス生成
2. 全依存関係のreflect-metadataを読み取り
3. コンストラクタインジェクションの解決
4. インスタンスのライフサイクル管理

一方、CLSはAsyncLocalStorage（Node.js標準API）を使用し、**インスタンスは再利用**しつつリクエストコンテキストのみを分離するため、DIオーバーヘッドがゼロ。