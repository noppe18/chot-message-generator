# Commit Message Generator — 設計書

- 最終更新: 2026-08-19
- 前提調査: [feasibility-report.md](./feasibility-report.md)
- 決定記録: [adr/](./adr/)
- 作業手順: [implementation-checklist.md](./implementation-checklist.md)

---

## 1. 目的とスコープ

VS Code 標準の「Generate Commit Message」（GitHub Copilot 提供）が動作しない問題（[microsoft/vscode#327959](https://github.com/microsoft/vscode/issues/327959)）に対する代替を、独立した VS Code 拡張として提供する。

### やること

- ステージ済みの差分を文脈として、Language Model API でコミットメッセージを生成する
- 生成結果を SCM のコミットメッセージ入力欄へ注入する
- VS Code 標準設定 `github.copilot.chat.commitMessageGeneration.instructions` を尊重する

### やらないこと（明示的な非スコープ）

| 項目                                         | 理由                                           |
| -------------------------------------------- | ---------------------------------------------- |
| effort / reasoningEffort の制御              | [ADR-0001](./adr/0001-no-effort-setting.md)    |
| proposed API の利用                          | [ADR-0002](./adr/0002-no-proposed-api.md)      |
| ステージ未実施時のワーキングツリーからの生成 | [ADR-0004](./adr/0004-abort-on-empty-stage.md) |
| コミットの実行そのもの                       | 標準 Git 拡張の責務                            |
| 生成履歴の保持・再生成時の別案提示           | ステートレス設計を優先                         |
| 出力言語の明示制御                           | 直近コミットからの自然な追従に委ねる。§6.6     |
| SCM 入力欄内へのアイコン配置                 | [ADR-0007](./adr/0007-scm-title-menu-placement.md) |
| ステータスバーへのアイコン配置               | [ADR-0007](./adr/0007-scm-title-menu-placement.md) |
| instructions の解決規則の独自拡張            | 純正準拠の原則。§1.1                            |

### 1.1 設計原則: 設定は純正準拠

**本拡張は独自の設定体系を作らず、純正機能の設定をそのまま解釈する。**

参照する設定は `github.copilot.chat.commitMessageGeneration.instructions` ただ 1 つで、独自の instructions 設定は持たない。さらに、その**解釈規則も純正の実装に揃える**。純正が解決しないもの（絶対パス、`~/` 始まりのパス）を本拡張が独自に解決することはしない。

**Why**: この拡張は純正機能が壊れている間の暫定的な代替である。したがって価値は「動くこと」だけでなく、**入るのも出るのも軽いこと**にある。

- **導入時**: 既に `instructions` を設定しているユーザーは、拡張を入れるだけで設定を書き直さずに同じ結果を得られる。
- **離脱時**: 純正が復旧したら本拡張をアンインストールするだけでよい。移行作業も設定の後片付けも発生しない。

独自にパス解決を広げると、その設定を書いたワークスペースは**本拡張なしでは動かなくなる**。便利さと引き換えに離脱コストを作ることになり、暫定ツールとしての性質に反する。ホームディレクトリ配置の共通指示ファイルを使いたいというような要望が出ても、純正が対応するまでは本拡張も対応しない。

> **[ADR-0004](./adr/0004-abort-on-empty-stage.md) との関係**: 「ステージが空なら中断する」は純正と異なる挙動である。矛盾ではない。本原則が対象とするのは**設定の互換性**であり、設定を書き換えずに行き来できることを保証する。一方、生成の**挙動**については、純正の踏襲より正しさを優先する場面がある（ワーキングツリーへのフォールバックは、メッセージとコミット内容の食い違いを生む）。設定は互換に、挙動は正しさ優先、という切り分けである。

---

## 2. 用語

| 用語             | 意味                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| **LM API**       | `vscode.lm` 名前空間。`selectChatModels` / `LanguageModelChat.sendRequest` |
| **Git 拡張 API** | 組み込み拡張 `vscode.git` が `getAPI(1)` で公開する API                    |
| **auto**         | Copilot が提供する擬似モデル。`LanguageModelChat.id === 'auto'`            |
| **instructions** | `github.copilot.chat.commitMessageGeneration.instructions` の各要素        |
| **core**         | `vscode` を import しない純粋関数群                                        |
| **adapter**      | `vscode` API に触れる薄い層                                                |

---

## 3. 全体フロー

```
[コマンドパレット]  [scm/title アイコン]
        \                  /
         v                v
   commitMessageGenerator.generate (extension.ts)
                 |
                 v
   usecase/generateCommitMessage.ts
                 |
   1. リポジトリ決定          <- adapters/gitAdapter
   2. status() で状態更新     <- adapters/gitAdapter
   3. indexChanges 確認 --(空)--> [警告して終了]
   4. diff(true) 取得         <- adapters/gitAdapter
   5. 差分をファイル単位に分割  <- core/diffSplit        (純粋)
   6. 直近コミット取得        <- adapters/gitAdapter   (count が 0 なら呼ばない)
   7. 直近コミット正規化      <- core/commitLog        (純粋)
   8. instructions 参照収集   <- adapters/configAdapter
   9. instructions ファイル読込 <- adapters/configAdapter
  10. モデル候補取得          <- adapters/lmAdapter
  11. モデル解決 --(不可)--> [エラー終了]              (純粋)
  12. 予算計算・切り詰め      <- core/budget           (純粋)
  13. プロンプト組み立て      <- core/prompt           (純粋)
  14. countTokens 検証 --(超過)--> 12 へ戻る (最大2回)
  15. sendRequest + ストリーム結合 <- adapters/lmAdapter
  16. ```text 剥がし         <- core/parse            (純粋)
  17. inputBox.value へ代入   <- adapters/gitAdapter
```

---

## 4. ディレクトリ構成

```
commit-message-generator/
├── package.json
├── tsconfig.json
├── LICENSE                       # MIT
├── README.md
├── .vscodeignore
├── eslint.config.js              # ESLint 9 の flat config
├── docs/
│   ├── feasibility-report.md
│   ├── design.md                 # 本ファイル
│   ├── implementation-checklist.md
│   └── adr/0001..0006-*.md
├── src/
│   ├── extension.ts              # activate/deactivate。配線のみ
│   ├── messages.ts               # ユーザー向け文字列の集約（英語）
│   ├── types/
│   │   └── git.d.ts              # vscode.git の型定義（ベンダリング）
│   ├── core/                     # vscode を import しない
│   │   ├── result.ts
│   │   ├── errors.ts
│   │   ├── models.ts             # ドメイン型
│   │   ├── diffSplit.ts
│   │   ├── commitLog.ts
│   │   ├── instructions.ts
│   │   ├── modelSelection.ts
│   │   ├── budget.ts
│   │   ├── prompt.ts
│   │   └── parse.ts
│   ├── adapters/
│   │   ├── gitAdapter.ts
│   │   ├── lmAdapter.ts
│   │   ├── configAdapter.ts
│   │   └── uiAdapter.ts
│   └── usecase/
│       └── generateCommitMessage.ts
└── test/
    ├── diffSplit.test.ts
    ├── commitLog.test.ts
    ├── instructions.test.ts
    ├── modelSelection.test.ts
    ├── budget.test.ts
    ├── prompt.test.ts
    └── parse.test.ts
```

**制約（レビュー時に必ず確認）**: `src/core/**` は `import ... from 'vscode'` を一切含んではならない。これによりテストが素の Node で動く。

---

## 5. 型定義

### 5.1 `core/result.ts`

```ts
/**
 * 成功か失敗のいずれかを表す値。例外ではなく戻り値でエラーを表現するために使う。
 *
 * Why: エラーの網羅性を型で保証し、ユーザー向けメッセージへの写像を
 * UI 層の 1 箇所に集約するため。throw だと呼び出し側が握り潰しても
 * 型検査を通ってしまい、静かに失敗する経路が生まれる。
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
```

### 5.2 `core/errors.ts`

```ts
/**
 * 生成処理が失敗し得る全パターン。UI 層はこのユニオンを網羅的に
 * switch し、messages.ts の文言へ写像する。新しい失敗要因を足したら
 * 型検査が UI 層の網羅漏れを検出する。
 */
export type GenerationError =
  | { readonly kind: 'git-extension-unavailable' }
  | { readonly kind: 'no-repository' }
  | { readonly kind: 'repository-not-selected' }   // QuickPick でユーザーがキャンセル
  | { readonly kind: 'no-staged-changes' }
  | { readonly kind: 'no-model-available'; readonly requestedId?: string }
  | { readonly kind: 'model-access-denied' }
  | { readonly kind: 'quota-exceeded' }
  | { readonly kind: 'request-failed'; readonly detail: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'empty-response' }
  | { readonly kind: 'diff-too-large' };
```

### 5.3 `core/models.ts`

```ts
/** 1 ファイル分のステージ差分。 */
export interface FileDiff {
  /** リポジトリルート相対のパス。リネーム時は変更後（b 側）のパス。 */
  readonly path: string;
  /** `diff --git` 行から次の `diff --git` 行の直前までの生テキスト。 */
  readonly body: string;
  /** 追加行数（`+` 始まり、`+++` を除く）。 */
  readonly insertions: number;
  /** 削除行数（`-` 始まり、`---` を除く）。 */
  readonly deletions: number;
}

/** 予算超過で本文を落としたファイルの要約。 */
export interface FileSummary {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

/** 正規化済みの過去コミットメッセージ。 */
export interface RecentCommit {
  /** 件名行。 */
  readonly subject: string;
  /** 本文行（トレーラ除去済み、上限適用済み）。空配列あり。 */
  readonly bodyLines: readonly string[];
}

/** LM API から得たモデル候補の、core が必要とする最小限の情報。 */
export interface ModelCandidate {
  readonly id: string;
  readonly vendor: string;
  readonly name: string;
  readonly maxInputTokens: number;
}

/** プロンプト組み立ての入力一式。 */
export interface PromptInput {
  readonly repositoryName: string;
  readonly branchName: string;
  readonly recentCommits: readonly RecentCommit[];
  readonly includedDiffs: readonly FileDiff[];
  readonly omittedFiles: readonly FileSummary[];
  readonly instructions: readonly string[];
}
```

---

## 6. core モジュール仕様

各関数は**同期・純粋・不変**。引数を破壊してはならない。

### 6.1 `core/diffSplit.ts`

```ts
export const splitUnifiedDiff = (raw: string): readonly FileDiff[]
```

**分割規則**

1. 入力の改行を LF に正規化する（`\r\n` → `\n`）。
2. 行頭が `diff --git ` である行を境界としてブロックに切る。最初の境界より前のテキストは捨てる。
3. 境界行が 1 つも無い場合は空配列を返す。

**パス抽出規則**（この順に試す。Why: リネームと削除を同時に正しく扱える唯一の順序）

1. ブロック内に `+++ b/<path>` 行があり、`<path>` が `/dev/null` でなければ `<path>`。
2. 無ければ `--- a/<path>` 行の `<path>`（ファイル削除のケース）。
3. どちらも無ければ `diff --git a/<x> b/<y>` の `<y>`。
4. `"` で始まるパスは git のクォート形式なので、前後の `"` を剥がす。エスケープシーケンスの解釈は行わない（表示用途のみのため）。

**行数カウント規則**

- `insertions`: `+` で始まり `+++` で始まらない行の数
- `deletions`: `-` で始まり `---` で始まらない行の数

**出力順序**: 入力の出現順を保つ。

### 6.2 `core/commitLog.ts`

```ts
export const TRAILER_PATTERN: RegExp;
export const normalizeCommitMessage = (raw: string, maxLines: number): RecentCommit
export const normalizeCommitMessages = (raws: readonly string[], maxLines: number): readonly RecentCommit[]
```

**正規化規則**（`maxLines` の既定は 10）

1. 改行を LF に正規化し、全体を `trim()`。
2. 1 行目を `subject` とする。
3. 2 行目以降のうち、以下の**いずれかに該当する行を除去**する。
   - トレーラ行: `/^(Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Tested-by|Reported-by|Refs|Closes|Fixes|Cc):\s/i` にマッチ
     - **Why**: これらは開発者が後から付けるメタ情報であり、モデルに真似させると生成メッセージに架空の共著者や issue 番号が混入する。件名行（`fix: ...` 等の Conventional Commits プレフィックス）は対象外にするため、2 行目以降のみを見る。
4. 除去後、先頭・末尾の空行を落とす。
5. `subject` を含めて合計 `maxLines` 行を超える場合、`bodyLines` を `maxLines - 1` 行で打ち切る。
6. `bodyLines` 内の連続する空行は 1 行に畳む。

### 6.3 `core/instructions.ts`

設定の読み取りは 2 相に分ける。**Why**: ファイル読み込みだけが非同期なので、その前後を純粋関数に保つとテストが I/O 無しで書ける。

```ts
/** 設定に書ける各要素の生の形。 */
export type RawInstruction = { readonly text: string } | { readonly file: string };

export interface InstructionRefs {
  /** 重複排除済みのファイルパス。設定に現れた順。 */
  readonly files: readonly string[];
  /** 重複排除済みのテキスト。設定に現れた順。 */
  readonly texts: readonly string[];
}

/**
 * @param scopes workspaceFolder → workspace → global の順に並べた設定値。
 *               未設定のスコープは undefined を渡す。
 */
export const collectInstructionRefs = (
  scopes: readonly (readonly RawInstruction[] | undefined)[],
): InstructionRefs

/**
 * @param fileContents collectInstructionRefs が返した files を読んだ結果。
 *                     読めなかったファイルは Map に入れない（無視される）。
 */
export const buildInstructionTexts = (
  refs: InstructionRefs,
  fileContents: ReadonlyMap<string, string>,
): readonly string[]
```

**規則**

- スコープは**実効値ではなく全スコープを連結**する。`inspect()` の `workspaceFolderValue` → `workspaceValue` → `globalValue` の順。
  - **Why**: 純正 Copilot の `customInstructionsService.ts` と同じ挙動。「ユーザー設定に共通ルール、ワークスペース設定に固有ルール」という使い方で、狭いスコープが広いスコープを消してしまうのを防ぐ。
- 配列でない値、`text` も `file` も持たない要素は黙って無視する。
- 重複排除: `file` はパス文字列、`text` は本文文字列で行う。
- `buildInstructionTexts` の出力順: `texts` を設定順に並べ、その後にファイル内容を `files` の順に並べる。各要素は `trim()` 済みで、空文字列は除外する。
- **`files` の各要素はワークスペースフォルダ相対パスとしてのみ扱う。** 絶対パスや `~/` 始まりのパスを特別扱いしてはならない（§1.1 / §7.4）。

### 6.4 `core/modelSelection.ts`

```ts
export type ModelResolution<T> =
  | { readonly kind: 'configured'; readonly model: T }
  | { readonly kind: 'fallback-auto'; readonly model: T; readonly requestedId?: string }
  | { readonly kind: 'unavailable'; readonly requestedId?: string };

/**
 * `T` は `id` を持つ任意の型。adapter 層の ResolvedModel をそのまま渡して
 * 選ばれたオブジェクトを受け取れるようにするためのジェネリック。
 * これにより core は vscode の型を知らないまま、呼び出し側は
 * 「選定に使ったモデル本体」を取り戻せる。
 *
 * @param configuredId 設定 commitMessageGenerator.model の値。空文字は未指定扱い。
 * @param byId         selectById(configuredId) の結果。未指定時は空配列。
 * @param autoModels   selectAuto() の結果。
 */
export const resolveModel = <T extends { readonly id: string }>(
  configuredId: string | undefined,
  byId: readonly T[],
  autoModels: readonly T[],
): ModelResolution<T>
```

**規則**

1. `configuredId` が空でなく `byId` が非空 → `configured`（`byId[0]`）
2. `autoModels` が非空 → `fallback-auto`（`autoModels[0]`。`configuredId` が指定されていたなら `requestedId` に入れる）
3. どちらも空 → `unavailable`

**Why `id` 完全一致なのか / なぜ `family` を見ないのか**: [ADR-0003](./adr/0003-model-resolution-strategy.md)

**呼び出し側の責務**: `kind === 'fallback-auto' && requestedId !== undefined` のとき警告通知を出す（§10）。

### 6.5 `core/budget.ts`

```ts
/** 1 トークンあたりの概算文字数。 */
export const CHARS_PER_TOKEN = 4;

export const approxTokens = (text: string): number  // Math.ceil(text.length / CHARS_PER_TOKEN)

export interface BudgetOutcome {
  readonly included: readonly FileDiff[];   // 元の出現順
  readonly omitted: readonly FileSummary[]; // 元の出現順
}

/**
 * @param diffs         全ファイル差分（出現順）
 * @param budgetTokens  差分に割り当てられる概算トークン数。0 以下なら全件 omitted。
 */
export const selectWithinBudget = (
  diffs: readonly FileDiff[],
  budgetTokens: number,
): BudgetOutcome
```

**規則**

1. `budgetTokens <= 0` なら `included: []`、全件 `omitted`。
2. 差分を `approxTokens(body)` の**昇順**で並べる。同値なら `path` の辞書順（安定性のため）。
   - **Why 昇順**: 小さい変更を多く採用した方が、コミット全体の輪郭をモデルに伝えられる。1 つの巨大ファイルで予算を使い切ると他の変更が全部見えなくなる。
3. 先頭から累積トークンが `budgetTokens` を超えない範囲で採用する。超えたものは `omitted` に回す。
4. **1 件も予算に収まらない場合は、`included` を空にして全件を `omitted` に回す。**
   - **Why 最小 1 件を無理に入れないのか**: `package-lock.json` やビルド成果物のように、単一ファイルだけで上限を超える差分は珍しくない。無理に採用すると、再試行ループで予算をいくら下げても採用内容が変わらず、**必ず `diff-too-large` で終わって機能が使えなくなる**。差分本文がゼロでも、`# OMITTED FILES` のファイル一覧と変更行数だけで「chore: update generated bundle」程度のメッセージは書けるので、エラーで終わるよりはるかに良い。
   - この規則により、`diff-too-large` は「固定部だけで上限を超える」場合にしか発生しなくなる（現実にはほぼ起きない）。
5. `included` / `omitted` はいずれも**元の出現順に復元**して返す（プロンプトの可読性のため）。

### 6.6 `core/prompt.ts`

```ts
export const buildPrompt = (input: PromptInput): string
```

出力テンプレート（値が空のセクションは**見出しごと出力しない**）:

```
You are helping a software developer write a git commit message for their staged changes.

# RULES
1. Analyze the CODE CHANGES to understand what was modified.
2. Identify the purpose of the changes so the message answers *why*, not just *what*.
3. Review RECENT COMMITS to learn this repository's established conventions. Match their format, style, and language. Never copy their content.
4. Do not include meta information such as issue references, tags, trailers, or author names. The developer adds those.
5. Output exactly one ```text markdown code block containing the commit message, and nothing else.

# REPOSITORY
Repository: {repositoryName}
Branch: {branchName}

# RECENT COMMITS (style reference only — do not copy)
{recentCommits}

# CODE CHANGES
{diffBlocks}

# OMITTED FILES (changed, but bodies omitted due to size limits)
{omittedList}

# CUSTOM INSTRUCTIONS
Follow these instructions provided by the user when generating the commit message.
{instructions}

# REMINDER
Now generate the commit message describing the CODE CHANGES above.
Output exactly one ```text code block and nothing else.
```

**各プレースホルダの整形**

| プレースホルダ | 形式 |
|---|---|
| `{repositoryName}` / `{branchName}` | そのまま埋める。ただし `branchName` が空文字（detached HEAD・初回コミット前）の場合は **`Branch:` の行ごと出力しない**。空ラベルはモデルにとって雑音でしかないため |
| `{recentCommits}` | 各コミットを `- {subject}` とし、`bodyLines` があれば続けて `  {line}` でインデント。コミット間は空行 1 つ |
| `{diffBlocks}` | ファイルごとに `## {path}` の見出し、続けて ` ```diff ` フェンスで `body` を囲む |
| `{omittedList}` | `- {path} (+{insertions}/-{deletions})` の羅列 |
| `{diffBlocks}` が空のとき | `# CODE CHANGES` の見出しごと出力しない。全件降格時は `# OMITTED FILES` だけが変更情報になる |
| `{instructions}` | 各要素を `- ` 始まりの箇条書き。複数行の要素はそのままインデントせず出力 |

**Why System ロールを使わないのか**: Stable API の `LanguageModelChatMessageRole` は `User` と `Assistant` のみで、System を渡すと `checkProposedApiEnabled(extension, 'languageModelSystem')` で拒否される。したがって全体を 1 つの User メッセージに畳み込む。

**Why 出力言語を指示しないのか**: RECENT COMMITS がリポジトリの言語慣習を暗黙に伝えるため。明示すると、英語で書かれた OSS リポジトリに日本語 UI のユーザーが日本語コミットを混入させる事故が起きる。言語を固定したいユーザーは `commitMessageGeneration.instructions` に書ける。

### 6.7 `core/parse.ts`

```ts
export const extractCommitMessage = (raw: string): string
```

**規則**（この順に試す）

1. 改行を LF に正規化。
2. `/^```text\s*\n([\s\S]*?)\n```\s*$/m` にマッチすればキャプチャ群を採用。
3. 2 に失敗し、全体が言語指定なし・任意言語のフェンスで囲まれていれば（`/^```[a-z]*\s*\n([\s\S]*?)\n```\s*$/`）そのキャプチャ群を採用。
   - **Why**: 指示に反して ` ``` ` だけで返すモデルが実在する。フェンス記号がそのままコミットメッセージに入るのを防ぐ。
4. どれにも当たらなければ入力全体を採用。
5. 採用した文字列を `trim()` し、3 行以上連続する空行を 2 行に畳んで返す。

**空文字になった場合**: 呼び出し側が `empty-response` エラーとして扱う。

---

## 7. adapter 仕様

adapter は「`vscode` API を呼び、core が食えるプレーンなデータに変換する」だけ。判断ロジックを持たない。

### 7.1 `adapters/gitAdapter.ts`

```ts
export interface GitPort {
  getRepositories(): readonly RepositoryHandle[];
  getRepositoryByUri(uri: vscode.Uri): RepositoryHandle | undefined;
  getSelectedRepositories(): readonly RepositoryHandle[];   // ui.selected === true
}

export interface RepositoryHandle {
  readonly rootUri: vscode.Uri;
  readonly name: string;              // basename(rootUri)
  readonly branchName: string;        // state.HEAD?.name ?? ''
  refresh(): Promise<void>;           // repository.status()
  hasStagedChanges(): boolean;        // state.indexChanges.length > 0
  getStagedDiff(): Promise<string>;   // repository.diff(true)
  getRecentCommitMessages(max: number): Promise<readonly string[]>;  // log({maxEntries:max})
  setCommitMessage(message: string): void;  // inputBox.value = message
}
```

**取得手順**

```ts
const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
if (!ext) return err({ kind: 'git-extension-unavailable' });
const exports = await ext.activate();
// getAPI(1) は enabled === false のとき throw する
if (!exports.enabled) return err({ kind: 'git-extension-unavailable' });
const api = exports.getAPI(1);
```

**`refresh()` を必ず呼ぶ理由（コメントに残すこと）**: SCM ビューの状態は遅延更新のため、ステージ直後に実行されると `indexChanges` が古いままになり「ステージが空」と誤判定する。純正 Copilot も同じ理由で `repository.status()` を先に呼んでいる。

**`getRecentCommitMessages`** は失敗しても投げない。`try/catch` で握り潰して空配列を返す（浅いクローンや初回コミット前で `log` が失敗するため）。

### 7.2 リポジトリ決定連鎖

```ts
export const pickRepository = async (
  git: GitPort,
  commandArg: unknown,
  activeEditorUri: vscode.Uri | undefined,
  quickPick: (candidates: readonly RepositoryHandle[]) => Promise<RepositoryHandle | undefined>,
): Promise<Result<RepositoryHandle, GenerationError>>
```

1. **`commandArg` から `rootUri` を防御的に取り出す。**
   ```ts
   const uri = (commandArg as { rootUri?: unknown })?.rootUri;
   const handle = uri instanceof vscode.Uri ? git.getRepositoryByUri(uri) : undefined;
   ```
   - **引数の実型（確認済み）**: `SCMViewPane.getActionsContext()` は「表示中のリポジトリがちょうど 1 つのときだけ」その `provider` を返し、複数なら `undefined` を返す。これが `MainThreadSCMProvider.toJSON()` で `{ $mid: MarshalledId.ScmProvider, handle }` になり、`ExtHostCommands.processArgument` が拡張向けの `vscode.SourceControl` に戻す。つまり**引数は `SourceControl`（`rootUri` を持つ）か、`undefined`**。
   - **Why それでも防御的に扱うのか**: 複数リポジトリのワークスペースでビュータイトルのアイコンを押すと引数が来ない。個々のリポジトリ行のアイコンからは来る（行のツールバーが `repository.provider` を context に持つため）。つまり引数は**あくまでヒントであって前提にできない**。`rootUri` が取れなければ静かに次の手段へ落ちる形にしておけば、この場合分けを呼び出し側が意識せずに済む。
2. `git.getSelectedRepositories()` がちょうど 1 件ならそれ。
3. `activeEditorUri`（`vscode.window.activeTextEditor?.document.uri`。呼び出し元の `extension.ts` で取得して渡す）から `getRepositoryByUri` で引けたらそれ。
4. `git.getRepositories()` が 1 件ならそれ。
5. 0 件なら `no-repository`。複数なら `quickPick`。キャンセルされたら `repository-not-selected`。

### 7.3 `adapters/lmAdapter.ts`

```ts
/**
 * LM API のモデル本体と、core に渡せる素の情報を束ねたもの。
 *
 * Why 束ねるのか: core はモデルを id で選ぶが、実際に sendRequest を呼ぶには
 * LanguageModelChat オブジェクトそのものが要る。id から引き直すと、その間に
 * 一覧が変化して別のモデルに解決される可能性がある（特に `auto` は毎回
 * 裏側のモデルが変わり得る）。選定に使ったオブジェクトをそのまま送信まで
 * 持ち回ることで、「解決したモデル」と「実際に叩いたモデル」を一致させる。
 */
export interface ResolvedModel extends ModelCandidate {
  // id / vendor / name / maxInputTokens を ModelCandidate から継承する。
  // Why 入れ子にせず継承するのか: resolveModel は `T extends { id: string }` の
  // ジェネリックなので、id がトップレベルに無いと制約を満たせない。
  /** LM API のモデル本体。core からは見えない（core は ModelCandidate としてしか受け取らない）。 */
  readonly chat: vscode.LanguageModelChat;
}

export interface LmPort {
  selectById(id: string): Promise<readonly ResolvedModel[]>;
  selectAuto(): Promise<readonly ResolvedModel[]>;
  countTokens(model: ResolvedModel, text: string): Promise<number>;
  send(model: ResolvedModel, prompt: string, token: vscode.CancellationToken): Promise<Result<string, GenerationError>>;
}
```

- `selectById(id)` → `vscode.lm.selectChatModels({ id })`
- `selectAuto()` → `vscode.lm.selectChatModels({ vendor: 'copilot', id: 'auto' })`
- 各 `LanguageModelChat` から `{ id, vendor, name, maxInputTokens }` を写し、`chat` を添えて `ResolvedModel` として返す。
- **キャッシュの範囲**: モデル一覧は 1 回の実行のたびに引き直す（`onDidChangeChatModels` で変化し、サインアウトで空になる）。ただし **1 回の実行の中では、選定した `ResolvedModel` を送信まで保持して使い回す**。「キャッシュしない」は実行をまたいで持ち越さないという意味であり、実行中に引き直せという意味ではない。
- `send` の実装
  ```ts
  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(prompt)],
    { justification: 'Generate a commit message from the staged changes.' },
    token,
  );
  let text = '';
  for await (const chunk of response.text) { text += chunk; }
  ```
- **エラー写像**
  | 例外                                                 | `GenerationError`                           |
  | ---------------------------------------------------- | ------------------------------------------- |
  | `LanguageModelError` かつ `code === 'NoPermissions'` | `model-access-denied`                       |
  | `LanguageModelError` かつ `code === 'Blocked'`       | `quota-exceeded`                            |
  | `LanguageModelError` かつ `code === 'NotFound'`      | `no-model-available`                        |
  | `CancellationError` / トークンが cancel 済み         | `cancelled`                                 |
  | その他                                               | `request-failed`（`detail` に `String(e)`） |

- **`sendRequest` はユーザー操作起点でのみ呼ぶこと。** 型定義に *"must only be called in response to a user action!"* と明記があり、初回は同意ダイアログが出る。本拡張のトリガーは 2 つともユーザー操作なので条件を満たす。自動生成トリガーを足してはならない。

### 7.4 `adapters/configAdapter.ts`

```ts
export interface ConfigPort {
  getModelId(): string | undefined;              // '' は undefined に正規化
  getRecentCommitCount(): number;                // 0..50 にクランプ
  getInstructionScopes(): readonly (readonly RawInstruction[] | undefined)[];
  readInstructionFiles(paths: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
```

- `getInstructionScopes()`
  ```ts
  const inspected = vscode.workspace
    .getConfiguration()
    .inspect<RawInstruction[]>('github.copilot.chat.commitMessageGeneration.instructions');
  return [inspected?.workspaceFolderValue, inspected?.workspaceValue, inspected?.globalValue];
  ```
- `readInstructionFiles()` は各ワークスペースフォルダに対して `vscode.Uri.joinPath(folder, path)` を試し、最初に読めたものを採用する。読めなければ Map に入れない（純正も失敗を握り潰す）。
  - **絶対パス・`~/` 始まりのパスを特別扱いしない。** `Uri.joinPath` にそのまま渡し、結果として読めなければ無視される。
  - **Why**: 純正 `customInstructionsService.ts` の `_collectInstructionsFromFile` はワークスペースフォルダ相対でしか解決しない（`~/` や絶対パスを解釈する分岐は、skill／instruction ファイル探索という**別経路**にのみ存在し、`commitMessageGeneration` の設定は通らない）。ここで独自に解決範囲を広げると、その設定を書いたワークスペースが本拡張なしでは動かなくなる（§1.1）。

### 7.5 `adapters/uiAdapter.ts`

- `LogOutputChannel` を `vscode.window.createOutputChannel('Commit Message Generator', { log: true })` で生成し、`context.subscriptions` に登録する。
- 進捗は `vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: ..., cancellable: true }, ...)`。
- エラー通知は `showErrorMessage(message, 'Show Details')`。押されたら `channel.show()`。

---

## 8. usecase

```ts
export interface Deps {
  readonly git: GitPort;
  readonly lm: LmPort;
  readonly config: ConfigPort;
  readonly log: Logger;
}

export const generateCommitMessage = async (
  deps: Deps,
  ctx: { readonly commandArg: unknown; readonly activeEditorUri: vscode.Uri | undefined },
  token: vscode.CancellationToken,
): Promise<Result<GenerateOutcome, GenerationError>>

export interface GenerateOutcome {
  readonly message: string;
  readonly resolution: ModelResolution<ResolvedModel>;   // 警告通知の要否判定に使う
  readonly omittedCount: number;
}
```

**依存はコンストラクタではなく引数で注入する。** テストでは plain object のフェイクを渡すだけで済む。

### 8.1 トークン検証ループ

**「固定部」の定義**: 差分ブロックと降格一覧を空にして組み立てたプロンプト。つまり RULES / REPOSITORY / RECENT COMMITS / CUSTOM INSTRUCTIONS / REMINDER の合計である。

```ts
const fixedPart = buildPrompt({ ...input, includedDiffs: [], omittedFiles: [] });
let budgetTokens = Math.floor(model.maxInputTokens * 0.8) - approxTokens(fixedPart);
```

降格一覧（`# OMITTED FILES`）は降格件数に応じて伸びるため固定部には含まれないが、その分は 0.8 の余裕と下の再試行ループが吸収する。**先に固定部だけで `countTokens` を呼ぶ必要はない**（呼び出し回数を増やさないため、ここは概算で足りる）。

```
for attempt in 0..2:
    outcome = selectWithinBudget(diffs, budgetTokens)
    prompt  = buildPrompt({ ...input, includedDiffs: outcome.included, omittedFiles: outcome.omitted })
    actual  = await lm.countTokens(model, prompt)
    if actual <= model.maxInputTokens * 0.8: break
    budgetTokens = floor(budgetTokens * 0.8)
if actual > model.maxInputTokens: return err({ kind: 'diff-too-large' })
```

**Why 0.8 なのか**: 概算（4 文字/トークン）は CJK やミニファイ済みファイルで大きく外れる。実測との差を吸収する余裕として 2 割を確保する。最終判定だけは `maxInputTokens` そのもので行い、0.8 を割っただけで諦めない。

**`budgetTokens` が負になる場合**: 固定部だけで予算を食い尽くしている状態。`selectWithinBudget` は規則 1 により全件を降格するため、そのまま進めて最終判定に委ねる。特別扱いは不要。

**ループが収束しない場合**: 全件降格まで進んでもなお `countTokens` が上限を超えるなら、固定部（RECENT COMMITS や CUSTOM INSTRUCTIONS）が肥大しているということ。この場合のみ `diff-too-large` を返す。

---

## 9. 設定

### 9.1 スキーマ

```jsonc
"commitMessageGenerator.model": {
  "type": "string",
  "default": "",
  "markdownDescription": "Identifier of the language model to use, matched exactly against the model `id` (for example `gpt-5.1`). When empty, or when the specified model is not available, `auto` is used instead."
},
"commitMessageGenerator.recentCommitCount": {
  "type": "number",
  "default": 5,
  "minimum": 0,
  "maximum": 50,
  "markdownDescription": "Number of recent commit messages to include as a style reference. Set to `0` to disable."
}
```

### 9.2 参照する外部設定

| キー                                                       | 用途                                       |
| ---------------------------------------------------------- | ------------------------------------------ |
| `github.copilot.chat.commitMessageGeneration.instructions` | カスタム指示。全スコープを連結して参照する |

**この設定を読むために GitHub Copilot 拡張への依存は不要**。`workspace.getConfiguration().inspect()` は未インストール拡張の設定キーでも値を返す。`package.json` の `extensionDependencies` に Copilot を書いてはならない。

### 9.3 提供しない設定

- **effort / reasoningEffort**: [ADR-0001](./adr/0001-no-effort-setting.md)
- **temperature / max_tokens**: スコープ外。必要になった時点で追加を検討する
- **独自の instructions**: 標準設定と役割が重複し、優先順位規則が必要になるため

---

## 10. ユーザー向けメッセージ

すべて `src/messages.ts` に集約する（英語）。`GenerationError['kind']` を網羅する `Record` として定義すれば、エラー追加時に型検査が漏れを検出する。

| 契機                                    | 種別         | 文言                                                                                                 |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `no-staged-changes`                     | warning      | `No staged changes to describe. Stage the changes you want to commit and try again.`                 |
| `no-repository`                         | warning      | `No Git repository found in this workspace.`                                                         |
| `git-extension-unavailable`             | error        | `The built-in Git extension is not available. Enable it and try again.`                              |
| `no-model-available`                    | error        | `No language model is available. Sign in to GitHub Copilot, or configure a language model provider.` |
| `model-access-denied`                   | error        | `Access to the language model was denied. Grant permission and try again.`                           |
| `quota-exceeded`                        | error        | `The language model quota has been exceeded. Try again later.`                                       |
| `request-failed`                        | error        | `Failed to generate a commit message. See the output for details.`                                   |
| `empty-response`                        | error        | `The language model returned an empty response.`                                                     |
| `diff-too-large`                        | error        | `The staged changes are too large for the selected model, even after truncation.`                    |
| `cancelled`                             | （通知なし） | Output にのみ記録                                                                                    |
| `repository-not-selected`               | （通知なし） | Output にのみ記録                                                                                    |
| `fallback-auto` かつ `requestedId` あり | warning      | `Model "{id}" is not available. Used "auto" instead.`                                                |

エラー通知には `Show Details` ボタンを添え、押されたら Output チャンネルを開く。

**Output に記録する内容**（`logPrompt` 設定は設けないため、プロンプト全文は出さない）

- 解決されたモデル（`id` / `vendor` / `name` / `maxInputTokens`）と解決経路
- 変更ファイル数、採用件数、降格件数
- 概算トークン数と `countTokens` の実測値、検証ループの試行回数
- 失敗時は `kind` と `detail`

---

## 11. `package.json`

```jsonc
{
  "name": "commit-message-generator",
  "displayName": "Commit Message Generator",
  "description": "Generate a git commit message from your staged changes using the VS Code Language Model API.",
  "version": "0.1.0",
  "publisher": "noppe18",
  "author": { "name": "Taigo Nakajima" },
  "license": "MIT",
  "preview": true,
  "pricing": "Free",
  "keywords": ["git", "scm", "commit", "commit-message", "ai", "language-model"],
  "categories": ["SCM Providers", "Other"],
  "engines": { "vscode": "^1.90.0" },
  "main": "./dist/extension.js",
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": false,
      "description": "Staged diffs and custom instruction files are sent to a language model, so the workspace contents must be trusted."
    },
    "virtualWorkspaces": {
      "supported": false,
      "description": "Requires a local Git repository through the built-in Git extension."
    }
  },
  "contributes": {
    "commands": [{
      "command": "commitMessageGenerator.generate",
      "title": "Generate Commit Message",
      "category": "Commit Message Generator",
      "icon": "$(sparkle)"
    }],
    "menus": {
      "scm/title": [{
        "command": "commitMessageGenerator.generate",
        "group": "navigation",
        "when": "scmProvider == git"
      }]
    },
    "configuration": {
      "title": "Commit Message Generator",
      "properties": { /* §9.1 */ }
    }
  },
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -p . --watch",
    "bundle": "esbuild src/extension.ts --bundle --platform=node --format=cjs --target=node20 --external:vscode --outfile=dist/extension.js --minify --sourcemap",
    "build": "npm run compile && npm run bundle",
    "test": "npm run compile && node --test \"out/test/**/*.test.js\"",
    "lint": "eslint src test --ext .ts",
    "vscode:prepublish": "npm run build",
    "package:vsix": "npx --yes @vscode/vsce package"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/vscode": "~1.90.0",
    "esbuild": "^0.28.1",
    "typescript": "^5.7.2"
  }
}
```

**ランタイム依存パッケージは持たない**（`dependencies` なし）。

`engines.vscode` の `^1.90.0` は `@types/vscode` の 1.88 / 1.89 / 1.90 を突き合わせて確定した。`lm` 名前空間・`selectChatModels`・`LanguageModelChat.id`・`LanguageModelChatSelector.id` はいずれも **1.90.0 で初出**であり 1.89 には無い。本拡張が使う残りの API（`maxInputTokens` / `countTokens` / `justification` / `LanguageModelError` / `LogOutputChannel` / `ProgressLocation.SourceControl` / `LanguageModelChatMessageRole.Assistant` / `onDidChangeChatModels`）も 1.90.0 に揃っている。`scm/title` は proposed 指定を持たない Stable な寄与ポイント。

`@types/vscode` を `~1.90.0` に固定するのは、下限より新しい API を誤って使うのを型検査で防ぐため。

---

## 12. 既知の制約

| 制約                              | 影響                                          | 対応                                                           |
| --------------------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| effort を指定できない             | 推論深度は VS Code のモデルピッカー設定に従う | README に明記。[ADR-0001](./adr/0001-no-effort-setting.md)     |
| System ロールを使えない           | ルールを User メッセージに畳み込む            | §6.6                                                           |
| モデル一覧は動的                  | サインアウトで 0 件になる                     | 毎回引き直す。§7.3                                             |
| `scm/title` 引数の実型が未検証 | なし（防御的実装で回避済み）                  | §7.2                                                           |
| 概算トークンは CJK で外れる       | 検証ループで吸収                              | §8.1                                                           |
| SCM 入力欄にアイコンを出せない | `scm/title` で代替 | [ADR-0007](./adr/0007-scm-title-menu-placement.md) |
| Restricted Mode では拡張ごと無効  | 未信頼ワークスペースでは使えない              | 意図的。[ADR-0006](./adr/0006-disable-untrusted-workspaces.md) |
