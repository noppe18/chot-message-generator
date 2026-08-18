# ADR-0003: モデル解決は `id` 完全一致 → `auto` → エラー

- 状態: 採用
- 日付: 2026-08-19

## 背景

`commitMessageGenerator.model` に書かれた値から、実際に使う `LanguageModelChat` を決める規則が必要である。

`vscode.lm.selectChatModels(selector)` のセレクタは `vendor` / `family` / `version` / `id` を取り、マッチングは**すべて完全一致の AND**である。

```ts
// vs/workbench/contrib/chat/common/languageModels.ts — selectLanguageModels
if ((selector.vendor  === undefined || model.vendor  === selector.vendor)
 && (selector.family  === undefined || model.family  === selector.family)
 && (selector.version === undefined || model.version === selector.version)
 && (selector.id      === undefined || model.id      === selector.id)) { ... }
```

### `auto` の実体

`auto` は UI 上の飾りではなく、実在するモデルとして LM API に露出している。

```ts
// vscode-copilot-chat/src/platform/endpoint/node/autoChatEndpoint.ts
export class AutoChatEndpoint extends CopilotChatEndpoint {
	public static readonly pseudoModelId = 'auto';
```

```ts
// languageModelAccess.ts — _provideLanguageModelChatInfo
id:     endpoint instanceof AutoChatEndpoint ? AutoChatEndpoint.pseudoModelId : endpoint.model,
name:   endpoint instanceof AutoChatEndpoint ? 'Auto' : endpoint.name,
family: endpoint.family,   // ← auto でも「裏で選ばれた実モデルの family」が入る
```

**`family` は `'auto'` にならない。** したがって `auto` は `id` でしか選べない。

また、拡張が受け取る `LanguageModelChat.id` は vendor プレフィックスなしの生 ID である（`extHostLanguageModels.ts` で `id: model.info.id`）。内部識別子は `copilot/auto` 形式だが、API 越しには `'auto'`。

### `family` も見るべきか

ユーザーがモデルピッカーで見た名前をそのまま設定に書く可能性を考えると、`id` で外れたら `family` でも探す方が親切に見える。しかしその場合、`id` と `family` のどちらで当たったかによって選ばれるモデルが変わり、**同じ設定値が環境によって別のモデルを指す**。エイリアス（`copilot-fast` など、`ModelAliasRegistry` により `family` にエイリアス名が入った複製エントリ）も混ざるため、何が選ばれるか予測しづらい。

## 決定

**`id` の完全一致のみで解決する。** フォールバック連鎖は以下で終端する。

1. `commitMessageGenerator.model` が非空 → `selectChatModels({ id })` の先頭
2. → `selectChatModels({ vendor: 'copilot', id: 'auto' })` の先頭
3. → `no-model-available` エラーで終了

2 が発動し、かつ 1 が指定されていた場合は **毎回 warning 通知**を出す（`Model "{id}" is not available. Used "auto" instead.`）。

## 帰結

- 設定値の意味が一意になる。ユーザーは `id` を書けばそのモデルが使われ、書かなければ `auto` が使われる。
- ユーザーが `family` 名を書くと `auto` に落ちる。黙って落ちると「指定したのに効かない」体験になるため、必ず通知する。通知が毎回出るのは意図的で、設定ミスは放置されるべきではないという判断。
- Copilot に未サインインで他プロバイダ（`openai.chatgpt` など）のみを使っているユーザーは、`model` を明示しない限り使えない。「全件の先頭」へさらにフォールバックする案は、`selectChatModels()` が全ベンダーの解決を走らせるコストがあるうえ、**返る順序に保証がなくエイリアスも混ざる**ため、何が選ばれるか不確定になるので採らない。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| `id` → `family` の順で探す | 同じ設定値が環境によって別モデルを指す。エイリアスが混入する |
| オブジェクト形式で `LanguageModelChatSelector` をそのまま公開 | 典型ケースで冗長 |
| `vendor:id` 記法を許容 | 独自記法のパーサとテストが増える割に、`id` 衝突は実際には稀 |
| 最終段で「全件の先頭」を使う | 順序保証がなく、選ばれるモデルが不確定 |
