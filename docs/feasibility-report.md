# コミットメッセージ生成 VS Code 拡張 — 実現可能性調査レポート

- 作成日: 2026-08-19
- 対象リポジトリ: `commit-message-generator`（現状: 空のリポジトリ、コミット無し）
- 背景: [microsoft/vscode#327959](https://github.com/microsoft/vscode/issues/327959)（Generate Commit Message が動作しない / 2026-07-22 build 1.130.0 で報告、**Open・`info-needed` ラベル**、担当 lszomoru、根本原因・回避策の記載なし）

> **この文書は調査時点の記録である。確定した仕様は [design.md](./design.md) と [adr/](./adr/) が正となる。**
>
> **訂正（2026-08-19）**: 初版では `scm/inputBox` メニューへの寄与が可能と記述したが、**誤りだった**。`scm/inputBox` は proposed API `contribSourceControlInputBoxMenu` でゲートされており、Marketplace 公開拡張では寄与そのものが登録されない（§2.3 に訂正内容と根拠を記載）。この誤りは §0 のサマリ表・§8 の R9・§9 の設定スキーマ案・§10 にも波及している。
>
> また §9 の設定スキーマ案と §10 のビルド構成は検討段階の案であり、その後の設計で以下が変わっている。
> - `effort` / `showInScmInputBox` / `includeRecentCommits` 設定は提供しない → 設定は `model` と `recentCommitCount` の 2 つのみ
> - テストランナーは vitest ではなく `node --test`
> - `engines.vscode` は `^1.130.0` ではなく **`^1.90.0`**（§10 に検証結果を追記）

---

## 0. 結論（サマリ）

**要求 7 項目のうち 6 項目は Stable API のみで実装可能。残る 1 項目（effort の指定）だけが Stable API では実現できない。**

| #   | 要求                                                              | 可否                         | 補足                                                                                                    |
| --- | ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | コマンドパレットから起動                                          | ✅                           | `contributes.commands` + `commandPalette`                                                               |
| 2   | ステータスバーのアイコンから起動                                  | ✅                           | `window.createStatusBarItem`。ただし採用したのは **`scm/title` へのアイコン寄与**（`scm/inputBox` は proposed のため公開拡張では不可。§2.3 訂正） |
| 3   | Language Model API で生成                                         | ✅                           | `vscode.lm.selectChatModels` / `LanguageModelChat.sendRequest`                                          |
| 4   | Git 拡張経由でステージ差分を取得                                  | ✅                           | `vscode.git` の `getAPI(1)` → `Repository.diff(true)` ほか                                              |
| 5   | モデルを settings.json で指定 + `auto` フォールバック             | ✅                           | `auto` は `LanguageModelChat.id === 'auto'` として実在する                                              |
| 6   | **effort を settings.json で指定 + フォールバック**               | ⚠️ **Stable API では不可** | 詳細は §4。回避案 3 つを提示                                                                            |
| 7   | `github.copilot.chat.commitMessageGeneration.instructions` を参照 | ✅                           | 単なる設定値の読み取り。Copilot 拡張への依存不要                                                        |
| 8   | 生成結果をコミットメッセージ欄へ注入                              | ✅                           | `Repository.inputBox.value` への代入                                                                    |

**総合判断: 開発を進めて良い。** ただし effort については仕様上の判断が 1 つ必要（§4.4 の A/B/C）。

---

## 1. 調査環境と一次情報源

推測を排し、実際にインストールされているバイナリと OSS ソースを直接読んで確認した。

| 対象                                     | バージョン / 参照先                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code（Windows 側 / WSL からマウント） | **1.133.0** (`resources/app/package.json`)                                                                                                                                             |
| バンドル版 Copilot Chat                  | **GitHub.copilot-chat 0.61.0**（`resources/app/extensions/copilot`、63 個の proposed API を利用）                                                                                      |
| バンドル版 Git 拡張                      | **vscode.git 10.0.0**                                                                                                                                                                  |
| API 型定義                               | `microsoft/vscode` `main` の `src/vscode-dts/vscode.d.ts`（21,235 行）                                                                                                                 |
| Git 拡張 API 型定義                      | `microsoft/vscode` `extensions/git/src/api/git.d.ts`（514 行）                                                                                                                         |
| Copilot 実装                             | `microsoft/vscode-copilot-chat`（OSS）の `languageModelAccess.ts`, `gitCommitMessageGenerator.ts`, `gitCommitMessagePrompt.tsx`, `customInstructionsService.ts`, `autoChatEndpoint.ts` |
| VS Code 内部実装                         | `extHostLanguageModels.ts`, `chat/common/languageModels.ts`                                                                                                                            |

> なぜ一次情報を読んだか: 公式ドキュメント（code.visualstudio.com の Language Model API ガイド）は記述が古く、モデル一覧が「GPT-4o / o1 / Claude 3.5 Sonnet」のままで `auto` にも `reasoningEffort` にも言及がない。ドキュメントだけを根拠にすると effort の実現可否を誤判定する。

---

## 2. トリガー（要求 1・2）

### 2.1 コマンドパレット

```jsonc
// package.json
"contributes": {
  "commands": [{
    "command": "commitMessageGenerator.generate",
    "title": "Generate Commit Message",
    "category": "Commit Message Generator",
    "icon": "$(sparkle)"
  }]
}
```

`activationEvents` は不要（VS Code 1.74+ は `contributes.commands` から自動生成）。

### 2.2 ステータスバー

`vscode.window.createStatusBarItem(StatusBarAlignment.Left, priority)` に `command` / `text: '$(sparkle)'` / `tooltip` を設定するだけ。**Git リポジトリが開かれているときだけ `show()`** する制御を入れると邪魔にならない。

### 2.3 SCM メニューへのアイコン配置 — 【訂正あり】

**初版の誤り**: 「`scm/inputBox` に寄与すれば純正と同じ位置にアイコンを出せる」と書いたが、これは成立しない。

確かにバンドル版 Copilot 拡張の `package.json` には以下の定義が実在する。

```jsonc
"scm/inputBox": [{
  "command": "github.copilot.git.generateCommitMessage",
  "when": "scmProvider == git && chatSetupCompleted"
}]
```

しかし Copilot Chat は 63 個の proposed API を宣言している組み込み拡張であり、この寄与もその特権に依存している。VS Code 本体の寄与ポイント定義を見ると `scm/inputBox` は proposed 扱いである。

```ts
// vs/workbench/services/actions/common/menusExtensionPoint.ts
{
	key: 'scm/inputBox',
	id: MenuId.SCMInputBox,
	description: localize('menus.input', "The Source Control input box menu"),
	proposed: 'contribSourceControlInputBoxMenu'
},
```

そして登録処理でハードブロックされる。警告ではなく、寄与が丸ごと捨てられる。

```ts
if (menu.proposed && !isProposedApiEnabled(extension.description, menu.proposed)) {
	collector.error(/* proposedAPI.invalid */);
	continue;
}
```

#### SCM メニュー寄与ポイントの Stable / Proposed 一覧（`menusExtensionPoint.ts` より）

| 寄与ポイント | 公開拡張で使えるか |
|---|---|
| `scm/title` | ✅ Stable |
| `scm/sourceControl` | ✅ Stable |
| `scm/repository` | ✅ Stable |
| `scm/resourceState/context` | ✅ Stable |
| `scm/resourceFolder/context` | ✅ Stable |
| `scm/resourceGroup/context` | ✅ Stable |
| `scm/change/title` | ✅ Stable |
| `scm/inputBox` | ❌ `contribSourceControlInputBoxMenu` |
| `scm/repositories/title` | ❌ `contribSourceControlTitleMenu` |
| `scm/history/title` | ❌ `contribSourceControlHistoryTitleMenu` |
| `scm/historyItem/context` / `scm/historyItemRef/context` | ❌ `contribSourceControlHistoryItemMenu` |
| `scm/artifactGroup/context` / `scm/artifact/context` | ❌ `contribSourceControlArtifact*Menu` |

#### 採用する配置

`scm/title`（ソース管理ビューのタイトルバー）は Stable であり、`group: "navigation"` を指定すればアイコンとして表示される。純正 Copilot の `github.copilot.chat.review.changes` も同じ場所に出ている。

```jsonc
"scm/title": [{
  "command": "commitMessageGenerator.generate",
  "group": "navigation",
  "when": "scmProvider == git"
}]
```

コミットメッセージ入力欄の直上に位置するため、入力欄内に置けない制約下では意図に最も近い。決定と理由は [ADR-0007](./adr/0007-scm-title-menu-placement.md) を参照。

---

## 3. Language Model API（要求 3）

### 3.1 基本形

```ts
const models = await vscode.lm.selectChatModels({ vendor: 'copilot', id: 'auto' });
const [model] = models;                       // 空配列があり得る点に注意
const response = await model.sendRequest(
  [vscode.LanguageModelChatMessage.User(prompt)],
  { justification: 'ステージ済みの変更からコミットメッセージを生成します' },
  token
);
for await (const chunk of response.text) { /* 逐次結合 */ }
```

### 3.2 実装上、必ず踏まえるべき制約（`vscode.d.ts` より）

| 制約                        | 内容                                                                                                                                                                                                                  | 影響                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **ユーザー操作起点必須**    | `sendRequest` の JSDoc に *"must only be called in response to a user action!"* と明記。初回呼び出しで同意ダイアログが出る                                                                                            | 今回のトリガーは 2 つともユーザー操作なので問題なし。ただし「保存時に自動生成」等の拡張はしない             |
| **System ロールが使えない** | Stable の `LanguageModelChatMessageRole` は `User = 1` / `Assistant = 2` のみ。System を渡すと `extHostLanguageModels.ts` の `_convertMessages` が `checkProposedApiEnabled(extension, 'languageModelSystem')` で弾く | **Copilot 純正の `<SystemMessage>` 相当は User メッセージ内に畳み込む**必要がある。プロンプト設計に直接影響 |
| **モデル一覧は動的**        | `lm.onDidChangeChatModels` で変化する。サインアウト時は空になり得る                                                                                                                                                   | 毎回 `selectChatModels` し直す（キャッシュしない）                                                          |
| **エラー型**                | `LanguageModelError`（`NoPermissions` / `NotFound` / `Blocked`＝クォータ超過）                                                                                                                                        | `err.code` で分岐し、ユーザーに意味のあるメッセージを出す                                                   |
| **入力トークン上限**        | `model.maxInputTokens` / `model.countTokens()`                                                                                                                                                                        | 巨大な差分の切り詰めに使う（§5.3）                                                                          |

---

## 4. モデルと effort の指定（要求 5・6）— 本調査の核心

### 4.1 `auto` は「実在するモデル」である

`vscode-copilot-chat/src/platform/endpoint/node/autoChatEndpoint.ts`:

```ts
export class AutoChatEndpoint extends CopilotChatEndpoint {
	public static readonly pseudoModelId = 'auto';
```

`languageModelAccess.ts` の `_provideLanguageModelChatInfo` で、この endpoint は以下のように公開される:

```ts
id:     endpoint instanceof AutoChatEndpoint ? AutoChatEndpoint.pseudoModelId : endpoint.model, // 'auto'
name:   endpoint instanceof AutoChatEndpoint ? 'Auto' : endpoint.name,
family: endpoint.family,   // ← auto でも「裏で選ばれたモデルの family」がそのまま入る
```

**重要な帰結:**

- **`auto` の選択は `id` で行う。`family: 'auto'` では取れない**（family は裏側の実モデルの値になる）。
- 拡張が受け取る `LanguageModelChat.id` は vendor プレフィックス無しの生 ID（`extHostLanguageModels.ts` で `id: model.info.id`）。内部識別子は `copilot/auto` 形式だが、**API 越しには `'auto'`**。
- セレクタのマッチングは完全一致（`languageModels.ts` `selectLanguageModels`）:
  ```ts
  (selector.vendor  === undefined || model.vendor  === selector.vendor)
  && (selector.family === undefined || model.family === selector.family)
  && (selector.version=== undefined || model.version=== selector.version)
  && (selector.id     === undefined || model.id     === selector.id)
  ```
- `auto` は **Copilot ベンダー固有**の概念。ユーザーが `openai.chatgpt` 等の別プロバイダのモデルを指定した場合、フォールバック先の `auto` は `vendor: 'copilot'` を要する。Copilot 未サインインだと `auto` すら存在しないため、**最終フォールバックとして「利用可能な任意のモデルの先頭」も用意する**のが安全。

推奨するフォールバック連鎖:

```
settings の model 指定（id 一致 → family 一致の順で探索）
  ↓ 見つからない
{ vendor: 'copilot', id: 'auto' }
  ↓ 見つからない（Copilot 未サインイン等）
selectChatModels()（全件）の先頭
  ↓ 空
エラー表示（「利用可能な言語モデルがありません」）
```

### 4.2 effort の正体は `reasoningEffort`

`languageModelAccess.ts` の `buildConfigurationSchema`:

```ts
reasoningEffort: {
  type: 'string',
  title: vscode.l10n.t('Thinking Effort'),
  enum: effortLevels,          // endpoint.supportsReasoningEffort 由来
  ...
}
```

`enumDescriptions` から読み取れる **取り得る値は `'none' | 'low' | 'medium' | 'high' | 'xhigh'`**（どれが有効かはモデル依存）。同関数から分かる追加事実:

- **`auto` モデルには effort ピッカーが出ない**
  ```ts
  // Auto model delegates to different backends, so don't expose effort picker
  if (endpoint instanceof AutoChatEndpoint) { return {}; }
  ```
  → **「モデルは auto にフォールバック、effort も指定」という組み合わせは原理的に成立しない。**
- 対象は `claude*` / `gpt-*` family のみ。既定値は Claude=`high`、GPT=`medium`。

### 4.3 なぜ Stable API から effort を渡せないのか（二重の壁）

**壁 1: Copilot 側が `modelOptions` をホワイトリストで濾している。**
`languageModelAccess.ts` 末尾:

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

`sendRequest(..., { modelOptions: { reasoningEffort: 'high' } })` と書いても、**`reasoningEffort` はここで無言のうちに捨てられる**（エラーにすらならない）。渡せるのは上記 5 キーのみ。

**壁 2: 正規の経路は proposed API である。**
effort が実際に読まれているのは `modelOptions` ではなく `modelConfiguration`:

```ts
// languageModelAccess.ts
reasoningEffort: typeof _options.modelConfiguration?.reasoningEffort === 'string'
  ? _options.modelConfiguration.reasoningEffort : undefined,
```

この値の出所は VS Code 本体で合成される:

```ts
// vs/workbench/contrib/chat/common/languageModels.ts — sendChatRequest
const configuration  = this.getModelConfiguration(modelId);   // ユーザーの language models 設定ファイル
const mergedOptions  = configuration
  ? { ...options, configuration: { ...configuration, ...options.configuration } }
  : options;
```

`options.configuration`（＝拡張が指定する側）は **`vscode.proposed.chatProvider.d.ts` に定義された proposed API** で、Stable の `LanguageModelChatRequestOptions` には存在しない（`vscode.d.ts` を全文検索して `configuration` / `LanguageModelConfiguration` のヒット無しを確認済み）。

補足: `getModelConfiguration` が読むのは settings.json ではなく **VS Code 管理の「language models 設定ファイル」**（モデルピッカーの歯車から `configureModel` で開く）。したがってユーザーがモデルピッカー UI で Thinking Effort を設定していれば、**その値は我々の拡張からのリクエストにも自動的にマージされて適用される**。

### 4.4 effort に対する 3 つの選択肢（要判断）

| 案            | 内容                                                                                                                                                                                                                                                                            | 長所                                                                | 短所                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **A（推奨）** | `commitMessageGenerator.effort` 設定は**受け付けるが、Stable API では適用できないことを明示**。実際の effort は VS Code のモデルピッカー設定に従う旨を README と設定 description に書き、Output チャンネルに「effort=high を指定されましたが現行 API では適用できません」と記録 | Marketplace 公開可能／将来 API が Stable 化したら数行で有効化できる | 設定が実質的に効かない                                                                                                   |
| **B**         | `enabledApiProposals: ["chatProvider"]` を宣言し、`options.configuration.reasoningEffort` を渡す。ローカルビルドの VSIX を自分で入れて `argv.json` に `enable-proposed-api` を追加して運用                                                                                      | **要求どおり完全に動く**                                            | Marketplace 公開不可、VS Code 更新で proposed API が壊れ得る。本件は「暫定運用の個人用ツール」なので許容範囲かもしれない |
| **C**         | effort の代わりに、通る 5 キー（特に `temperature`, `max_tokens`）を設定で公開する                                                                                                                                                                                              | Stable のみで完結し、実際に効く                                     | 要求そのものではない                                                                                                     |

> **推奨は A を基本形にし、B を feature flag 的に同居させる設計**。`buildRequestOptions()` を純粋関数として切り出し、「proposed API が有効なら `configuration` を積む／そうでなければ積まずに警告を返す」という分岐だけにしておけば、A→B の切り替えは 1 箇所で済む。フォールバック要件「必ず指定できる値」は、`selectChatModels` からは effort の候補値を取得できない（`configurationSchema` は拡張側に公開されていない）ため、**`'medium'` を既定・未知の値は無視、という固定表で実装**するしかない。

---

## 5. ステージ差分の取得（要求 4）

### 5.1 Git 拡張 API の取得

```ts
const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
const api = (await ext?.activate())?.getAPI(1);   // getAPI(1) は enabled=false のとき throw する
```

型は `microsoft/vscode` の `extensions/git/src/api/git.d.ts` を `src/types/git.d.ts` としてベンダリングするのが定石（npm パッケージは存在しない）。**バンドル版 git 拡張は 10.0.0**、`API`/`Repository` の形は上記 d.ts と一致することを確認済み。

### 5.2 使える口

```ts
interface API {
  readonly repositories: Repository[];
  getRepository(uri: Uri): Repository | null;
  readonly onDidOpenRepository: Event<Repository>;
}
interface Repository {
  readonly rootUri: Uri;
  readonly inputBox: InputBox;              // { value: string } — 読み書き可
  readonly state: RepositoryState;          // indexChanges / workingTreeChanges / untrackedChanges / HEAD
  status(): Promise<void>;                  // 状態の明示リフレッシュ
  diff(cached?: boolean): Promise<string>;  // ★ diff(true) = ステージ済み差分（unified diff 文字列）
  diffIndexWithHEAD(): Promise<Change[]>;
  diffIndexWithHEAD(path: string): Promise<string>;  // ファイル単位のステージ差分
  log(options?: LogOptions): Promise<Commit[]>;
  getConfig(key: string): Promise<string>;
}
```

Copilot 純正 (`gitCommitMessageServiceImpl.ts`) の手順もこれと同じで、参考になる:

1. `await repository.status()` で状態を明示リフレッシュ（*"best effort ... make sure that the repository state is up-to-date"* とコメント）
2. `state.indexChanges.length > 0` なら **indexChanges を対象**、0 なら working tree + untracked にフォールバック
3. ファイルごとに差分を取り、`repository.log({ maxEntries: 5 })` で直近コミットメッセージも文脈に加える

**今回の要求は「Stage 差分」なので `indexChanges` が空なら「ステージされた変更がありません」と警告して終了する**のが素直（純正のフォールバック挙動は真似しない、という判断を明示的にする）。

### 5.3 サイズ対策

`diff(true)` は巨大になり得る。`model.maxInputTokens` と `model.countTokens()` を使って、

1. ファイル単位に分割（`indexChanges` の各 `uri` に対し `diffIndexWithHEAD(path)`）
2. 予算内に収まるファイルから順に採用、溢れたファイルは「パス＋変更行数のみ」に降格

という切り詰めを **純粋関数（差分配列＋予算 → 採用/降格済み配列）** として実装する。トークン計測だけが非同期なので、計測結果を引数で受け取る形にすれば純粋性を保てる。

---

## 6. 生成結果の注入（要求 8）

```ts
repository.inputBox.value = message;   // InputBox は { value: string } のみ
```

`vscode.scm` の `SourceControlInputBox` は自前で作った SourceControl のものなので使えない。**Git 拡張の `Repository.inputBox` が唯一の正解**。

対象リポジトリの決定順（多リポジトリ対応）:

1. SCM メニュー経由なら渡された引数から `rootUri` を防御的に取り出し → `api.getRepository(uri)`
2. アクティブエディタの URI → `api.getRepository(uri)`
3. `api.repositories.length === 1` ならそれ
4. 複数なら `window.showQuickPick` で選択

### レスポンスの整形

Copilot 純正は「```text コードブロックで返せ」と指示し、以下で剥がしている（`gitCommitMessageGenerator.ts`）:

```ts
const textCodeBlockRegex = /^```text\s*([\s\S]+?)\s*```$/m;
```

同じ規約を採用するのが堅い。**コードブロックが無い場合は生テキストをそのまま採用**（純正も `'noTextCodeBlock'` として値は返す）。この関数は副作用ゼロなので、単体テストの主戦場になる。

---

## 7. カスタム指示の参照（要求 7）

### 7.1 設定は実在する（1.133.0 / copilot-chat 0.61.0 で確認）

`github.copilot.chat.commitMessageGeneration.instructions` の JSON Schema（実物から抽出）:

```jsonc
{
  "type": "array",
  "items": { "oneOf": [
    { "type": "object", "required": ["file"], "properties": { "file": { "type": "string" } } },
    { "type": "object", "required": ["text"], "properties": { "text": { "type": "string" } } }
  ]},
  "default": [],
  "tags": ["experimental"]
}
```

例:
```jsonc
"github.copilot.chat.commitMessageGeneration.instructions": [
  { "file": ".copilot-commit-message-instructions.md" },
  { "text": "Use conventional commit message format." }
]
```

> 注: `codeGeneration.instructions` / `reviewSelection.instructions` には `language` プロパティがあるが、**commitMessageGeneration には無い**。`experimental` タグ付き・非推奨マークは無し。**この設定を読むだけなら Copilot 拡張への依存は一切不要**（`workspace.getConfiguration` は未インストールの設定キーでも値を返す）。

### 7.2 解決ルール（`customInstructionsService.ts` の実装に合わせる）

- **スコープを個別に読む**: 純正は `inspectConfig` で `workspaceFolderValue` → `workspaceValue` → `globalValue` を**この順で全部集めて連結**する（実効値 1 つだけを見るのではない）。拡張側では `getConfiguration().inspect()` で同じことができる。
- **`file` はワークスペースフォルダ相対**: `Uri.joinPath(folderUri, customInstructionsFile)` を各ワークスペースフォルダに対して試し、読めたものを採用。
- **重複排除**: `file` はパス、`text` は文字列で `Set` による重複排除。
- 読み込み失敗は無視（純正も try/catch で握りつぶす）。

### 7.3 プロンプトへの入れ方

純正は `<custom-instructions>` タグ + 前置き文で囲んでいる:

> "When generating the commit message, please use the following custom instructions provided by the user."

§3.2 のとおり **System ロールが使えない**ため、我々は「ルール・文脈・指示・カスタム指示」をすべて 1 つの User メッセージに構造化して入れる。純正 `gitCommitMessagePrompt.tsx` のタグ構成（`repository-context` / `recent-commits` / `changes` / `reminder` / `custom-instructions`）は、そのままテキスト版として移植できる良い雛形。

---

## 8. 制約・リスク一覧

| # | 事項 | 影響度 | 対応 |
|---|---|---|---|
| R1 | effort が Stable API で渡せない | 高 | §4.4 の A/B/C を判断。A なら設定 description に明記 |
| R2 | System ロールが使えない | 中 | プロンプトを User 一本に再設計（設計時に織り込み済みなら実質ゼロ） |
| R3 | `sendRequest` はユーザー操作起点必須 | 低 | 自動生成トリガーを作らない |
| R4 | Copilot 未サインイン時はモデル 0 件 | 中 | `selectChatModels()` 空を正常系として扱いガイドを出す |
| R5 | クォータ超過 (`LanguageModelError.Blocked`) | 中 | エラーコード分岐でメッセージを出し分け |
| R6 | 巨大差分でトークン超過 | 中 | §5.3 の切り詰め |
| R7 | Git 拡張が無効化されている（`getAPI` が throw） | 低 | try/catch + `onDidChangeEnablement` |
| R8 | WSL リモート環境 | 低 | 拡張は WSL 側（workspace 拡張）で動き、`vscode.lm` は本体側へプロキシされる。`main` を Node 実行にし、`extensionKind` は既定のままで良い |
| R9 | 純正の不具合が修正されアイコンが二重になる | 低 | 純正は入力欄内、本拡張は `scm/title` と位置が異なるため並んで見えることはない |
| R10 | copilot-chat の内部実装（ホワイトリスト等）は非公開契約 | 中 | 依存しているのは「Stable API の範囲＋挙動の観測」に留め、内部 API は呼ばない |

---

## 9. 推奨アーキテクチャ（関数型指向）

「純粋なコア」と「VS Code に触れる薄い殻」を分離し、テストは 100% コア側に寄せる。

```
src/
├── extension.ts              # activate/deactivate のみ。配線とDisposable管理
├── core/                     # ★ 純粋関数のみ。vscode を import しない
│   ├── config.ts             #   生の設定値 → 検証済み Settings（フォールバック解決を含む）
│   ├── modelSelection.ts     #   (候補モデル[], Settings) → 選択結果 | 失敗理由
│   ├── instructions.ts       #   inspect結果 + 読み込み済みファイル内容 → 指示テキスト[]
│   ├── diffBudget.ts         #   (ファイル差分[], トークン予算) → 採用/降格済み差分[]
│   ├── prompt.ts             #   PromptInput → メッセージ本文（文字列）
│   ├── parse.ts              #   LLM生テキスト → コミットメッセージ（```text 剥がし）
│   └── result.ts             #   Result<T, E> 型と補助関数
├── adapters/                 # ★ 副作用の局在。core を呼ぶだけの薄い層
│   ├── gitAdapter.ts         #   vscode.git API → core が食えるプレーンなデータ
│   ├── lmAdapter.ts          #   vscode.lm API 呼び出しとストリーム結合
│   ├── configAdapter.ts      #   workspace.getConfiguration().inspect()
│   └── uiAdapter.ts          #   StatusBar / Progress / 通知 / QuickPick
├── usecase/
│   └── generateCommitMessage.ts  # 純粋コアを順に適用するオーケストレーション
└── types/git.d.ts            # vscode.git の型定義をベンダリング
```

設計方針:

- **不変性**: 設定・差分・プロンプトはすべて `readonly` な値オブジェクト。`Object.freeze` ではなく型で縛る。
- **エラーを値で扱う**: `Result<T, E>` を導入し、`E` は `'no-staged-changes' | 'no-model' | 'quota-exceeded' | ...` の判別可能ユニオン。UI 層で **1 箇所だけ** メッセージへ写像する（i18n も一元化される）。
- **副作用の局在**: `core/` は `vscode` を import しない。これによりテストは `@vscode/test-electron` 不要の素の Node（`node --test`）で回る。
- **テスト容易性**: `usecase` は「アダプタのインタフェース群」を引数で受け取る（コンストラクタ注入ではなく関数引数注入）。フェイク実装は plain object で足りる。
- **JSDoc**: 公開関数には必ず付ける。とくに **Why** を書く（例: 「`status()` を明示的に呼ぶのは、SCM ビューの状態が遅延更新でステージ直後の差分を取りこぼすため」「`family` ではなく `id` で auto を選ぶのは、auto の family が裏側モデルの値になるため」）。**本レポートで判明した非自明な事実は、そのままコード中の Why コメントの原資になる**。

### 設定スキーマ案 — 【破棄】

> この案は採用されなかった。確定した設定は `commitMessageGenerator.model` と `commitMessageGenerator.recentCommitCount` の 2 つのみである（[design.md §9](./design.md)）。`effort` は [ADR-0001](./adr/0001-no-effort-setting.md)、`showInScmInputBox` は [ADR-0007](./adr/0007-scm-title-menu-placement.md) により不要となった。以下は検討の記録として残す。

```jsonc
"commitMessageGenerator.model": {
  "type": "string",
  "default": "",
  "markdownDescription": "使用するモデルの ID（例: `gpt-5.1`, `claude-sonnet-4.5`）。空、または指定モデルが利用不可の場合は `auto` にフォールバックします。"
},
"commitMessageGenerator.effort": {
  "type": "string",
  "enum": ["none", "low", "medium", "high", "xhigh"],
  "default": "medium",
  "markdownDescription": "推論の深さ。**注意: 現行の VS Code Stable API では拡張から effort を指定できません**（§実装メモ）。実際の値はモデルピッカーの Thinking Effort 設定に従います。"
},
"commitMessageGenerator.useCopilotInstructions": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "`#github.copilot.chat.commitMessageGeneration.instructions#` を参照します。"
},
"commitMessageGenerator.includeRecentCommits": {
  "type": "boolean",
  "default": true,
  "description": "直近のコミットメッセージをスタイル参考として文脈に含めます。"
},
"commitMessageGenerator.showInScmInputBox": {
  "type": "boolean",
  "default": true,
  "description": "SCM のコミットメッセージ入力欄にアイコンを表示します。"
}
```

### ビルド構成（提案）

TypeScript + esbuild（バンドル）+ `node --test`（core のテスト）+ `@vscode/vsce`（VSIX）。依存ランタイムパッケージはゼロで実装できる。

`engines.vscode` は **`^1.90.0`**。`@types/vscode` の 1.88 / 1.89 / 1.90 を突き合わせて確認した結果、`lm` 名前空間・`selectChatModels`・`LanguageModelChat.id`・`LanguageModelChatSelector.id` はいずれも **1.90.0 で初めて登場**し、1.89 には存在しない。本拡張が使う残りの API（`maxInputTokens` / `countTokens` / `justification` / `LanguageModelError` / `LogOutputChannel` / `ProgressLocation.SourceControl` / `LanguageModelChatMessageRole.Assistant` / `onDidChangeChatModels`）も 1.90.0 に揃っていることを確認済み。

---

## 10. 次タスクへの提案 — 【完了】

> 以下は調査時点の提案である。1 は決着済み（[ADR-0001](./adr/0001-no-effort-setting.md)）、実作業手順は [implementation-checklist.md](./implementation-checklist.md) が正となる。

1. ~~**判断待ち**: effort の扱い~~ → **設定を提供しない**で決着（[ADR-0001](./adr/0001-no-effort-setting.md)）。
2. スキャフォールド作成（package.json / tsconfig / esbuild / `node --test` / `types/git.d.ts` ベンダリング）。
3. `core/` の純粋関数を **テストファースト**で実装（parse → config → modelSelection → instructions → prompt → diffBudget の順が依存的に楽）。
4. `adapters/` + `usecase/` を実装し、コマンドパレットと `scm/title` アイコンの 2 導線を配線。
5. F5 デバッグ実行で実機確認（Copilot サインイン有・無、ステージ無し、巨大差分、複数リポジトリ の 5 ケース）。
6. README に「純正機能が復旧したらアンインストールしてよい」まで書いて完了。

---

## 付録: 参考にした Copilot 純正のプロンプト骨子

`gitCommitMessagePrompt.tsx` のシステムルール（要約）。**System ロールが使えない我々は、これを User メッセージ内の「ルール」節として再現する。**

1. CODE CHANGES を解析して何が変わったか理解する
2. ORIGINAL CODE を文脈として使う
3. 変更の目的（*why*）を特定する
4. RECENT REPOSITORY COMMITS から既存の記法・スタイルを読み取る（内容はコピーしない）
5. 簡潔で的確なメッセージを生成し、既存の記法に従う
6. issue 参照・タグ・著者名などのメタ情報は除去する（開発者が後で付ける）
7. 単一の ```text コードブロックのみを出力し、説明は書かない
