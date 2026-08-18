# 実装チェックリスト

実装担当者はこのファイルを上から順に消化する。各タスクには**完了判定基準**があり、それを満たすまで次に進まない。

- 設計の根拠: [design.md](./design.md)
- 決定の理由: [adr/](./adr/)
- API 調査結果: [feasibility-report.md](./feasibility-report.md)

> ## 進捗（2026-08-19）
>
> **全フェーズ完了。** `npm test` 70 件パス / `npm run lint` クリーン / `npm run build` 成功 / VSIX 生成・実機インストール確認済み（34 KB）。フェーズ 4 の実機確認 30 項目も全て通過。
>
> 任意タスクも未対応項目も解消済み。`repository` / `bugs` / `homepage` を設定し、README の相対リンクが VSIX 内で GitHub URL に書き換わることも確認した。
>
> 実装中に設計へ反映した変更は「実装からのフィードバック」節に記載。

## 全体を通じて守ること

- [x] `src/core/**` に `import ... from 'vscode'` を**一切書かない**（テストが素の Node で動く前提が壊れる）
- [x] すべての公開関数に JSDoc を付ける。**What/How ではなく Why を書く**。設計書中の「Why」注記はそのままコメントの原資として使う
- [x] ドメイン型は `readonly` で定義し、引数を破壊しない
- [x] ランタイム依存パッケージ（`dependencies`）を追加しない
- [x] ユーザーに見える文字列は必ず `src/messages.ts` を経由する（英語）

---

## フェーズ 0: 足場

### 0-1. リポジトリ初期化

- [x] `package.json` を設計書 §11 の内容で作成
- [x] `tsconfig.json`: `strict: true`, `target: ES2022`, `module: Node16`, `outDir: out`, `rootDir: .`, `noUncheckedIndexedAccess: true`
- [x] `LICENSE`（MIT、著作権者 `Taigo Nakajima`）
- [x] `.vscodeignore`（`src/`, `test/`, `out/`, `docs/`, `tsconfig.json`, `eslint.config.js` を除外）
- [x] `.gitignore`（`node_modules/`, `out/`, `dist/`, `*.vsix`）
- [x] `eslint.config.js`（**flat config**。ESLint 9 以降は `.eslintrc.json` を読まない）
- [x] `npm install`

**完了判定**: `npm run compile` がエラーなく通る（まだ何も実装していなくてよい）。

### 0-2. Git 拡張の型定義をベンダリング

- [x] `microsoft/vscode` の `extensions/git/src/api/git.d.ts` を `src/types/git.d.ts` として取り込む
- [x] ファイル冒頭に取得元 URL と取得日をコメントで記載する

**完了判定**: `GitExtension`, `API`, `Repository`, `InputBox`, `Change`, `RepositoryState`, `Commit`, `LogOptions` が型として参照できる。

> 検証済み: バンドル版 `vscode.git` は 10.0.0。`Repository.diff(cached?: boolean)`, `Repository.inputBox: InputBox`（`{ value: string }`）, `state.indexChanges`, `log(options?)`, `status()`, `getConfig()` の存在を確認済み。

---

## フェーズ 1: core（純粋関数）

**このフェーズはテストファーストで進める。** 依存関係の都合上、以下の順序が最も楽。

### 1-1. `core/result.ts` / `core/errors.ts` / `core/models.ts`

- [x] 設計書 §5.1〜§5.3 の型をそのまま実装

**完了判定**: 型のみなのでテスト不要。`npm run compile` が通る。

### 1-2. `core/parse.ts` — `extractCommitMessage`

- [x] 設計書 §6.7 の 5 段階の規則を実装

**テストケース**（`test/parse.test.ts`）

- [x] ` ```text\nfeat: add X\n``` ` → `feat: add X`
- [x] 前後に散文がある ` ```text ` ブロック → ブロック内のみ抽出
- [x] 言語指定なしの ` ```\nfeat: add X\n``` ` → `feat: add X`（フォールバック規則）
- [x] ` ```diff ` のような別言語フェンスで全体が囲まれている → 中身を抽出
- [x] フェンスなしの生テキスト → `trim()` して返す
- [x] 複数行メッセージ（件名＋空行＋本文）が保たれる
- [x] 3 行以上の連続空行が 2 行に畳まれる
- [x] CRLF 入力が LF に正規化される
- [x] 空文字・空白のみ → 空文字を返す（呼び出し側が `empty-response` にする）

### 1-3. `core/commitLog.ts` — `normalizeCommitMessage(s)`

- [x] 設計書 §6.2 の 6 段階の規則を実装
- [x] `TRAILER_PATTERN` をエクスポートし、テストから参照できるようにする

**テストケース**（`test/commitLog.test.ts`）

- [x] 件名のみのメッセージ → `bodyLines` が空配列
- [x] 件名＋本文 → 両方保持される
- [x] `Co-authored-by: X <x@example.com>` が本文から除去される
- [x] `Signed-off-by:` / `Refs:` / `Closes:` / `Fixes:` が除去される（大文字小文字を問わない）
- [x] **件名行が `fix: ...` の場合、件名は除去されない**（回帰防止。2 行目以降のみを対象とする規則の要）
- [x] 15 行のメッセージが `maxLines=10` で 10 行に切り詰められる
- [x] 本文中の連続空行が 1 行に畳まれる
- [x] 前後の空行が除去される
- [x] 空文字入力 → `subject` が空文字、`bodyLines` が空配列

### 1-4. `core/diffSplit.ts` — `splitUnifiedDiff`

- [x] 設計書 §6.1 の分割規則・パス抽出規則・行数カウント規則を実装

**テストケース**（`test/diffSplit.test.ts`）

- [x] 単一ファイルの差分 → 1 件、`path` が正しい
- [x] 3 ファイルの差分 → 3 件、**入力の出現順が保たれる**
- [x] 新規ファイル（`--- /dev/null`）→ `+++ b/<path>` から取得
- [x] **削除ファイル（`+++ /dev/null`）→ `--- a/<path>` から取得**（パス抽出規則 2 の要）
- [x] リネーム → `b` 側（変更後）のパスになる
- [x] パスに空白を含みクォートされている場合、前後の `"` が剥がれる
- [x] `insertions` が `+++` 行を数えない
- [x] `deletions` が `---` 行を数えない
- [x] `diff --git` 行を含まない入力 → 空配列
- [x] 空文字入力 → 空配列
- [x] CRLF 入力が正しく分割される
- [x] バイナリファイルの差分（`Binary files ... differ`）でも落ちず、1 件として返る

### 1-5. `core/budget.ts` — `approxTokens` / `selectWithinBudget`

- [x] 設計書 §6.5 の 5 段階の規則を実装

**テストケース**（`test/budget.test.ts`）

- [x] 全件が予算内 → `included` が全件、`omitted` が空
- [x] 予算 0 → `included` が空、`omitted` が全件
- [x] 予算不足時、**小さい差分から採用される**
- [x] **1 件も予算に収まらない場合、`included` が空になり全件が `omitted` に回る**（規則 4 の要。最小 1 件を無理に採用しない）
- [x] 単一ファイルの差分が予算を大きく超える場合でも、その 1 件が `included` に入らない
- [x] `included` / `omitted` がいずれも**元の出現順に復元される**（規則 5 の要。昇順のままにしない）
- [x] 同サイズの差分は `path` の辞書順で安定して並ぶ
- [x] `omitted` の `FileSummary` に `insertions` / `deletions` が引き継がれる
- [x] 入力配列が破壊されていない（ソートで元配列を壊さない）

### 1-6. `core/instructions.ts` — `collectInstructionRefs` / `buildInstructionTexts`

- [x] 設計書 §6.3 の 2 相構成と規則を実装

**テストケース**（`test/instructions.test.ts`）

- [x] 3 スコープすべてに値がある → **workspaceFolder → workspace → global の順で連結される**
- [x] 一部スコープが `undefined` → 残りだけが使われる
- [x] 全スコープが `undefined` → 空
- [x] 同じ `file` が複数スコープに現れる → 1 回だけ
- [x] 同じ `text` が複数スコープに現れる → 1 回だけ
- [x] `text` と `file` が混在 → **`texts` が先、`files` の内容が後**
- [x] 配列でない値が渡された → 無視される（クラッシュしない）
- [x] `text` も `file` も持たないオブジェクト → 無視される
- [x] `fileContents` に無いファイル → 無視される（読み込み失敗の扱い）
- [x] **絶対パス（`/etc/x.md`）や `~/x.md` が特別扱いされず、他と同じくパス文字列として扱われる**（純正準拠の回帰防止。設計書 §1.1）
- [x] 空文字・空白のみの要素は出力から除外される

### 1-7. `core/modelSelection.ts` — `resolveModel`

- [x] 設計書 §6.4 の 3 段階の規則を実装

**テストケース**（`test/modelSelection.test.ts`）

- [x] 指定 id が見つかる → `configured`
- [x] 指定 id が見つからず auto がある → `fallback-auto` で `requestedId` に指定値が入る
- [x] **未指定で auto がある → `fallback-auto` で `requestedId` が `undefined`**（警告を出さない分岐の要）
- [x] 指定 id も auto も無い → `unavailable`
- [x] 空文字の指定 → 未指定として扱われる
- [x] 候補が複数ある場合、先頭が選ばれる

### 1-8. `core/prompt.ts` — `buildPrompt`

- [x] 設計書 §6.6 のテンプレートと整形規則を実装

**テストケース**（`test/prompt.test.ts`）

- [x] 全セクションが揃った入力 → 期待どおりの文字列（スナップショット的に固定文字列で比較）
- [x] `recentCommits` が空 → **`# RECENT COMMITS` の見出しごと出力されない**
- [x] `omittedFiles` が空 → `# OMITTED FILES` の見出しごと出力されない
- [x] `instructions` が空 → `# CUSTOM INSTRUCTIONS` の見出しごと出力されない
- [x] `includedDiffs` が空 → `# CODE CHANGES` の見出しごと出力されない
- [x] `branchName` が空 → `Branch:` の行が出力されない
- [x] `bodyLines` を持つコミットが 2 段インデントで出力される
- [x] 差分が ` ```diff ` フェンスで囲まれ、`## {path}` 見出しが付く
- [x] `omittedFiles` が `- {path} (+{n}/-{m})` 形式になる
- [x] `# RULES` と `# REMINDER` は常に出力される
- [x] **出力言語に関する指示が含まれていない**（ADR の意図を守る回帰テスト）

**フェーズ 1 完了判定**: `npm test` が全件パスし、`src/core/**` を `grep -r "from 'vscode'"` しても何もヒットしない。

---

## フェーズ 2: adapters

このフェーズは実機でしか検証できないため、テストは書かない（フェーズ 4 の手動確認で担保する）。

### 2-1. `src/messages.ts`

- [x] 設計書 §10 の対応表を `Record<GenerationError['kind'], ...>` として実装
- [x] `fallback-auto` の警告文言（`{id}` プレースホルダ付き）も含める

**完了判定**: `GenerationError` に新しい `kind` を仮に足すと型エラーになる（網羅性が型で保証されている）。

### 2-2. `adapters/gitAdapter.ts`

- [x] `GitPort` / `RepositoryHandle` を設計書 §7.1 のとおり実装
- [x] `getAPI(1)` は `exports.enabled === false` のとき throw するため、**先に `enabled` を確認する**
- [x] `refresh()` は `repository.status()` を呼ぶ。**なぜ必要かをコメントに残す**（SCM の状態は遅延更新で、ステージ直後に古い値を読むと誤判定する）
- [x] `getRecentCommitMessages()` は `try/catch` で失敗を握り潰し空配列を返す（浅いクローン・初回コミット前）
- [x] `pickRepository` を設計書 §7.2 の 5 段階で実装
- [x] **`commandArg` は防御的に扱う**。`rootUri` が `vscode.Uri` として取り出せたときだけ使い、駄目なら次の手段へ落ちる。**理由をコメントに残す**（`scm/title` から渡される引数の実型は未検証で、バージョン間で変わり得る）

### 2-3. `adapters/lmAdapter.ts`

- [x] `LmPort` を設計書 §7.3 のとおり実装
- [x] `selectById` → `selectChatModels({ id })`、`selectAuto` → `selectChatModels({ vendor: 'copilot', id: 'auto' })`
- [x] **モデルオブジェクトをキャッシュしない**（一覧は動的に変わり、サインアウトで空になる）
- [x] `sendRequest` に `justification` を渡す
- [x] `LanguageModelError.code` による分岐を設計書 §7.3 の表のとおり実装
- [x] キャンセル時は `cancelled` を返す

### 2-4. `adapters/configAdapter.ts`

- [x] `getModelId()`: 空文字を `undefined` に正規化
- [x] `getRecentCommitCount()`: 0〜50 にクランプ
- [x] `getInstructionScopes()`: **`inspect()` で 3 スコープを配列にして返す**（`get()` の実効値ではない）
- [x] `readInstructionFiles()`: 各ワークスペースフォルダに対し `Uri.joinPath` を試し、最初に読めたものを採用。読めなければ Map に入れない

### 2-5. `adapters/uiAdapter.ts`

- [x] `createOutputChannel(name, { log: true })` で `LogOutputChannel` を生成し `context.subscriptions` に登録
- [x] `withProgress({ location: ProgressLocation.Notification, cancellable: true })`
- [x] エラー通知に `Show Details` ボタンを付け、押されたら `channel.show()`
- [x] `cancelled` / `repository-not-selected` は通知を出さず Output にのみ記録

---

## フェーズ 3: usecase と配線

### 3-1. `usecase/generateCommitMessage.ts`

- [x] 設計書 §3 のフロー順で実装
- [x] 依存は `Deps` を**第 1 引数**で受け取る（コンストラクタ注入にしない）
- [x] 設計書 §8.1 のトークン検証ループを実装（最大 2 回リトライ、最終判定は `maxInputTokens` そのもの）
- [x] Output に記録する項目を設計書 §10 のとおり出す。**プロンプト全文は出さない**
- [x] 各ステップの前でキャンセル済みかを確認し、`cancelled` を返す

### 3-2. `extension.ts`

- [x] `activate` で adapter を生成し、コマンドを登録し、すべて `context.subscriptions` に積む
- [x] コマンドハンドラは `(commandArg?: unknown) => ...` の形（`scm/title` からの引数を受け取れるように）
- [x] 生成成功時に `handle.setCommitMessage(message)` を呼ぶ
- [x] `resolution.kind === 'fallback-auto' && requestedId !== undefined` のとき警告通知を出す
- [x] `deactivate` は空でよい（Disposable は `subscriptions` 任せ）

**完了判定**: `npm run build` が通り、F5 で拡張開発ホストが起動する。

---

## フェーズ 4: 実機確認

F5（拡張開発ホスト）で確認する。**すべてに ✅ が付くまで完了としない。**

### 基本動作

- [x] コマンドパレットに `Commit Message Generator: Generate Commit Message` が出る
- [x] ソース管理ビューのタイトルバーに `$(sparkle)` アイコンが出る
- [x] `scm/title` のアイコンから実行すると生成され、コミットメッセージ入力欄に書き込まれる
- [x] コマンドパレットから実行しても同じ結果になる
- [x] 生成中に Notification の進捗が出る
- [x] 進捗のキャンセルボタンを押すと中断され、入力欄が書き換わらない
- [x] 入力欄に既存テキストがある状態で実行すると上書きされる
- [x] 生成結果に ` ``` ` などのフェンス記号が混入していない

### 境界条件

- [x] **ステージ済み変更なし** → 警告が出て LLM が呼ばれない（Output で確認）
- [x] **Git リポジトリなしのフォルダ** → `no-repository` の警告
- [x] **複数リポジトリのワークスペース**: `scm/title` アイコンから実行 → そのリポジトリが対象になる
- [x] 複数リポジトリでコマンドパレットから実行 → QuickPick が出る。キャンセルしても通知が出ない
- [x] **巨大な差分**（500 ファイル以上、または 1MB 超）→ 切り詰められ、`# OMITTED FILES` が出て、生成が成功する
- [x] **単一の巨大ファイル**（`package-lock.json` の全面更新など）だけをステージ → `diff-too-large` にならず、ファイル一覧のみで生成が成功する
- [x] **ステージ直後に即実行** → 「ステージが空」と誤判定されない（`status()` 呼び出しの回帰確認）
- [x] 新規ファイルのみをステージ → 正しいパスで生成される
- [x] ファイル削除のみをステージ → 正しいパスで生成される
- [x] リネームのみをステージ → 変更後のパスで生成される

### 設定

- [x] `commitMessageGenerator.model` に**存在するモデル id** を設定 → そのモデルが使われる（Output で確認）
- [x] **存在しない id** を設定 → 警告が出て `auto` が使われる
- [x] 未設定 → `auto` が使われ、**警告は出ない**
- [x] `recentCommitCount: 0` → 直近コミットがプロンプトに載らない（Output のファイル数・トークン数で間接確認）
- [x] `github.copilot.chat.commitMessageGeneration.instructions` に `{"text": "Use conventional commit format."}` → 生成結果が従う
- [x] 同設定に `{"file": ".copilot-commit-message-instructions.md"}` → ファイル内容が反映される
- [x] 存在しないファイルを指定 → クラッシュせず無視される
- [x] **`{"file": "~/shared-instructions.md"}` を指定 → 解決されず無視される**（純正と同じ挙動であることの確認）
- [x] ユーザー設定とワークスペース設定の両方に instructions → **両方が効く**（全スコープ連結の確認）

### エラー系

- [x] Copilot からサインアウト → `no-model-available` のエラーが出る
- [x] エラー通知の `Show Details` を押すと Output チャンネルが開く
- [x] Output に「解決されたモデル」「ファイル数」「トークン数」が記録されている
- [x] Output に**プロンプト全文や差分本文が出ていない**

### 環境

- [x] Restricted Mode（ワークスペースを信頼しない）ではコマンドもアイコンも出ない
- [x] **`scm/title` のアイコンが実際に表示される**（proposed でブロックされていないことの確認。表示されない場合は「拡張機能」ビューの問題タブに `proposedAPI.invalid` が出ていないか確認する）
- [x] WSL リモートのワークスペースで動作する

---

## フェーズ 5: 公開準備

- [x] `README.md` を書く。以下を必ず含める:
  - [x] 何をする拡張か、なぜ存在するか（[microsoft/vscode#327959](https://github.com/microsoft/vscode/issues/327959) へのリンク）
  - [x] **effort は設定できず、VS Code のモデルピッカーの Thinking Effort 設定に従う**こと（[ADR-0001](./adr/0001-no-effort-setting.md)）
  - [x] **ステージ済み変更が無いと生成しない**こと（純正と異なる点。[ADR-0004](./adr/0004-abort-on-empty-stage.md)）
  - [x] アイコンはソース管理ビューのタイトルバーに出ること（純正と位置が異なる。[ADR-0007](./adr/0007-scm-title-menu-placement.md)）
  - [x] `github.copilot.chat.commitMessageGeneration.instructions` を参照すること。**独自の設定は追加せず、純正と同じ設定・同じ解決規則で動く**こと（純正が復旧したらアンインストールするだけで戻れる）
  - [x] 純正機能が復旧したらアンインストールしてよいこと
- [x] `CHANGELOG.md` を作る
- [x] アイコン画像（128x128 PNG）を用意し `package.json` の `icon` に設定 — `scripts/generate-icon.py` で生成（標準ライブラリのみ、再実行可能）
- [x] `npm run package:vsix` で VSIX が生成できる
- [x] 生成した VSIX を `code --install-extension` で入れ、フェーズ 4 の基本動作だけ再確認する

---

## 任意タスク（本体完了後に着手可）

- [x] **`scm/title` 引数の実型確認** — 判明したのでコメントを事実に差し替え済み（`gitAdapter.ts` / 設計書 §7.2）。
  `SCMViewPane.getActionsContext()` は**表示中リポジトリがちょうど 1 つのときだけ** `provider` を返し、複数なら `undefined`。それが `MainThreadSCMProvider.toJSON()` で `{ $mid: MarshalledId.ScmProvider, handle }` になり、`ExtHostCommands.processArgument` が拡張向けの `vscode.SourceControl` に復元する。個々のリポジトリ行のアイコンからは常に渡る（行のツールバーが `repository.provider` を context に持つため）。
  **結論: 引数は `SourceControl` か `undefined`。防御的実装がそのまま正解だったので、コード変更は不要。**

### 未対応

なし。

### 解決済み（着手不要）

以下は設計フェーズで決着した。参考のために残す。

- ~~`engines.vscode` の下限引き下げ検証~~ → **`^1.90.0` で確定**。`@types/vscode` の 1.88 / 1.89 / 1.90 を比較し、`lm` 名前空間・`selectChatModels`・`LanguageModelChat.id`・`LanguageModelChatSelector.id` がいずれも 1.90.0 で初出（1.89 には無い）ことを確認済み。他の使用 API も 1.90.0 に揃っている。
- ~~`customInstructions.tsx` の全文確認~~ → **汎用指示は含まれないことを確認済み**。`.github/copilot-instructions.md` を集める `getAgentInstructions()` は `if (includeCodeGenerationInstructions !== false)` の内側にあり、コミットメッセージ生成は `includeCodeGenerationInstructions={false}` を渡すため実行されない。設計どおりで差異なし。
- ~~`scm/inputBox` への寄与~~ → **不可能と判明**。proposed API `contribSourceControlInputBoxMenu` でハードブロックされる。`scm/title` を採用（[ADR-0007](./adr/0007-scm-title-menu-placement.md)）。

---

## 実装からのフィードバック

実装とテストの過程で判明し、設計に反映した事項。

- **`src/types/git.d.ts` は全文コピーではなく必要な API 面だけを宣言した。** 上流の `git.d.ts` は `SourceControlHistoryItem` を `vscode` から import しており、これは `@types/vscode` 1.90 に存在しないためコンパイルが通らない。全文を貼ると対応 VS Code 範囲が暗黙に最新へ引き上がるので、実際に呼ぶメンバーだけを宣言した。新しい API が必要になったらまずここに足すことになり、それが「最古の対応版に存在するか」を問う契機になる。
- **`splitUnifiedDiff` のパス抽出順を修正した。** git はクォートを接頭辞の外側に書く（`+++ "b/my file.ts"`）ため、`b/` 除去を先にやるとクォート剥がし後に接頭辞が残る。クォート除去 → 接頭辞除去の順に修正。テストで検出。
- **プロンプトの RULES と REMINDER を入力に応じて可変にした。** 固定文だと `# RECENT COMMITS` が無いのに「Review RECENT COMMITS」と指示し、全件降格時に `# CODE CHANGES` が無いのに「describing the CODE CHANGES above」と言う。存在しないセクションを参照する指示はモデルを混乱させる。ルール番号は常に連番を保つ。
- **全件降格時は見出しを `# CHANGED FILES` に変えた。** 差分本文が 1 つも無いとき、その一覧が唯一の変更情報になるため、`OMITTED`（おまけ）という語感が実態に合わない。
- **`no-restricted-imports` で `src/core` からの `vscode` 参照を lint で禁止した。** 「core は vscode を import しない」はレビュー任せにせず機械的に強制する。`src/core` から `../adapters` / `../usecase` への依存も同時に禁止。
- **`no-param-reassign` は `src/core` 限定にした。** 当初は全体に掛けたが、adapter の `inputBox.value` 代入という**唯一の意図的な副作用**を誤検出した。このルールが守るのは core の純粋性なので、適用範囲を core に限るのが正しい。
- **README から `./docs` への相対リンクを外した。** `docs/` は `.vscodeignore` で VSIX から除外されるため、公開版 README ではリンクが必ず壊れる。
