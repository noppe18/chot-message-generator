# ADR-0001: effort（推論深度）設定を提供しない

- 状態: 採用
- 日付: 2026-08-19
- 関連: [ADR-0002](./0002-no-proposed-api.md)

## 背景

当初要件では「effort も settings.json で指定可能。未指定時や指定された effort が利用できない場合はフォールバックで必ず指定できる値を指定」とされていた。

実装可否を確認するため、VS Code 1.133.0 に同梱される Copilot Chat 0.61.0 および `microsoft/vscode` / `microsoft/vscode-copilot-chat` のソースを読んだ結果、**Stable API の範囲では第三者拡張から effort を指定する手段が存在しない**ことが判明した。

### 壁 1 — Copilot が `modelOptions` をホワイトリストで濾している

`vscode-copilot-chat/src/extension/conversation/vscode-node/languageModelAccess.ts`:

```ts
class LanguageModelOptions {
	private static _defaultDesc: Record<string, (value: unknown) => boolean> = {
		stop:              or(isStringArray, isString),
		temperature:       isNumber,
		max_tokens:        isNumber,
		frequency_penalty: isNumber,
		presence_penalty:  isNumber,
	};
	// convert() は _description に載っているキーだけを通す
}
```

`sendRequest(..., { modelOptions: { reasoningEffort: 'high' } })` と書いても、`reasoningEffort` はここで**エラーにもならず黙って破棄される**。

### 壁 2 — 正規の経路は proposed API

effort が実際に読まれているのは `modelOptions` ではなく `modelConfiguration` である。

```ts
// languageModelAccess.ts
reasoningEffort: typeof _options.modelConfiguration?.reasoningEffort === 'string'
  ? _options.modelConfiguration.reasoningEffort : undefined,
```

その値は VS Code 本体が合成する。

```ts
// vs/workbench/contrib/chat/common/languageModels.ts — sendChatRequest
const configuration = this.getModelConfiguration(modelId);
const mergedOptions = configuration
  ? { ...options, configuration: { ...configuration, ...options.configuration } }
  : options;
```

拡張が指定する側の `options.configuration` は `vscode.proposed.chatProvider.d.ts` の定義であり、Stable の `LanguageModelChatRequestOptions` には存在しない（`vscode.d.ts` 全文検索で `LanguageModelConfiguration` / `modelConfiguration` のヒットなしを確認）。

### 壁 3 — auto には effort の概念がそもそも無い

```ts
// Auto model delegates to different backends, so don't expose effort picker
if (endpoint instanceof AutoChatEndpoint) { return {}; }
```

要件の「モデルは auto にフォールバック」と「effort も指定」は、フォールバックが発動した時点で原理的に両立しない。

## 決定

**`commitMessageGenerator.effort` 設定を実装しない。**

`modelOptions.reasoningEffort` として送る案（Copilot では破棄されるが他プロバイダでは効く可能性がある）も検討したが、採らない。効くかどうかがプロバイダ実装に依存し、ユーザーには区別できないため、「設定したのに効かない」という体験を生むより、最初から提供しない方が誠実である。

README に「推論深度は VS Code のモデルピッカーの Thinking Effort 設定に従う」と記載する。

## 帰結

- ユーザーは effort を制御できる。ただし本拡張の設定ではなく、VS Code のモデルピッカー（歯車 → モデル設定ファイル）で行う。そこで設定した値は `sendChatRequest` が自動的にマージするため、**本拡張からのリクエストにも適用される**。
- 設定項目が 1 つ減り、`commitMessageGenerator.*` は `model` と `recentCommitCount` の 2 つになる。
- 将来 `LanguageModelChatRequestOptions.configuration` が Stable 化した場合、`lmAdapter.send` の 1 箇所に `configuration: { reasoningEffort }` を足すだけで有効化できる。その時点で本 ADR を「置換」して再判断する。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| 設定を作り `modelOptions.reasoningEffort` で送る | Copilot では確実に破棄される。効くかどうかがユーザーから見て不透明 |
| proposed API `chatProvider` を使う | Marketplace 公開では無効化される。[ADR-0002](./0002-no-proposed-api.md) |
| effort の代わりに `temperature` を公開 | ホワイトリストを通るので実際に効くが、要求されたものと異なる概念。必要になった時点で別途検討する |
| VS Code のモデル設定ファイルを拡張が書き換える | ユーザーのグローバル設定への副作用が大きすぎる |
