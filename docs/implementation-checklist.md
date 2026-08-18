# 実装チェックリスト

実装担当者はこのファイルを上から順に消化する。各タスクには**完了判定基準**があり、それを満たすまで次に進まない。

- 設計の根拠: [design.md](./design.md)
- 決定の理由: [adr/](./adr/)
- API 調査結果: [feasibility-report.md](./feasibility-report.md)

## 全体を通じて守ること

- [ ] `src/core/**` に `import ... from 'vscode'` を**一切書かない**（テストが素の Node で動く前提が壊れる）
- [ ] すべての公開関数に JSDoc を付ける。**What/How ではなく Why を書く**。設計書中の「Why」注記はそのままコメントの原資として使う
- [ ] ドメイン型は `readonly` で定義し、引数を破壊しない
- [ ] ランタイム依存パッケージ（`dependencies`）を追加しない
- [ ] ユーザーに見える文字列は必ず `src/messages.ts` を経由する（英語）

---

## フェーズ 0: 足場

### 0-1. リポジトリ初期化

- [ ] `package.json` を設計書 §11 の内容で作成
- [ ] `tsconfig.json`: `strict: true`, `target: ES2022`, `module: Node16`, `outDir: out`, `rootDir: .`, `noUncheckedIndexedAccess: true`
- [ ] `LICENSE`（MIT、著作権者 `Taigo Nakajima`）
- [ ] `.vscodeignore`（`src/`, `test/`, `out/`, `docs/`, `tsconfig.json`, `eslint.config.js` を除外）
- [ ] `.gitignore`（`node_modules/`, `out/`, `dist/`, `*.vsix`）
- [ ] `eslint.config.js`（**flat config**。ESLint 9 以降は `.eslintrc.json` を読まない）
- [ ] `npm install`

**完了判定**: `npm run compile` がエラーなく通る（まだ何も実装していなくてよい）。

### 0-2. Git 拡張の型定義をベンダリング

- [ ] `microsoft/vscode` の `extensions/git/src/api/git.d.ts` を `src/types/git.d.ts` として取り込む
- [ ] ファイル冒頭に取得元 URL と取得日をコメントで記載する

**完了判定**: `GitExtension`, `API`, `Repository`, `InputBox`, `Change`, `RepositoryState`, `Commit`, `LogOptions` が型として参照できる。

> 検証済み: バンドル版 `vscode.git` は 10.0.0。`Repository.diff(cached?: boolean)`, `Repository.inputBox: InputBox`（`{ value: string }`）, `state.indexChanges`, `log(options?)`, `status()`, `getConfig()` の存在を確認済み。

---

## フェーズ 1: core（純粋関数）

**このフェーズはテストファーストで進める。** 依存関係の都合上、以下の順序が最も楽。

### 1-1. `core/result.ts` / `core/errors.ts` / `core/models.ts`

- [ ] 設計書 §5.1〜§5.3 の型をそのまま実装

**完了判定**: 型のみなのでテスト不要。`npm run compile` が通る。

### 1-2. `core/parse.ts` — `extractCommitMessage`

- [ ] 設計書 §6.7 の 5 段階の規則を実装

**テストケース**（`test/parse.test.ts`）

- [ ] ` ```text\nfeat: add X\n``` ` → `feat: add X`
- [ ] 前後に散文がある ` ```text ` ブロック → ブロック内のみ抽出
- [ ] 言語指定なしの ` ```\nfeat: add X\n``` ` → `feat: add X`（フォールバック規則）
- [ ] ` ```diff ` のような別言語フェンスで全体が囲まれている → 中身を抽出
- [ ] フェンスなしの生テキスト → `trim()` して返す
- [ ] 複数行メッセージ（件名＋空行＋本文）が保たれる
- [ ] 3 行以上の連続空行が 2 行に畳まれる
- [ ] CRLF 入力が LF に正規化される
- [ ] 空文字・空白のみ → 空文字を返す（呼び出し側が `empty-response` にする）

### 1-3. `core/commitLog.ts` — `normalizeCommitMessage(s)`

- [ ] 設計書 §6.2 の 6 段階の規則を実装
- [ ] `TRAILER_PATTERN` をエクスポートし、テストから参照できるようにする

**テストケース**（`test/commitLog.test.ts`）

- [ ] 件名のみのメッセージ → `bodyLines` が空配列
- [ ] 件名＋本文 → 両方保持される
- [ ] `Co-authored-by: X <x@example.com>` が本文から除去される
- [ ] `Signed-off-by:` / `Refs:` / `Closes:` / `Fixes:` が除去される（大文字小文字を問わない）
- [ ] **件名行が `fix: ...` の場合、件名は除去されない**（回帰防止。2 行目以降のみを対象とする規則の要）
- [ ] 15 行のメッセージが `maxLines=10` で 10 行に切り詰められる
- [ ] 本文中の連続空行が 1 行に畳まれる
- [ ] 前後の空行が除去される
- [ ] 空文字入力 → `subject` が空文字、`bodyLines` が空配列

### 1-4. `core/diffSplit.ts` — `splitUnifiedDiff`

- [ ] 設計書 §6.1 の分割規則・パス抽出規則・行数カウント規則を実装

**テストケース**（`test/diffSplit.test.ts`）

- [ ] 単一ファイルの差分 → 1 件、`path` が正しい
- [ ] 3 ファイルの差分 → 3 件、**入力の出現順が保たれる**
- [ ] 新規ファイル（`--- /dev/null`）→ `+++ b/<path>` から取得
- [ ] **削除ファイル（`+++ /dev/null`）→ `--- a/<path>` から取得**（パス抽出規則 2 の要）
- [ ] リネーム → `b` 側（変更後）のパスになる
- [ ] パスに空白を含みクォートされている場合、前後の `"` が剥がれる
- [ ] `insertions` が `+++` 行を数えない
- [ ] `deletions` が `---` 行を数えない
- [ ] `diff --git` 行を含まない入力 → 空配列
- [ ] 空文字入力 → 空配列
- [ ] CRLF 入力が正しく分割される
- [ ] バイナリファイルの差分（`Binary files ... differ`）でも落ちず、1 件として返る

### 1-5. `core/budget.ts` — `approxTokens` / `selectWithinBudget`

- [ ] 設計書 §6.5 の 5 段階の規則を実装

**テストケース**（`test/budget.test.ts`）

- [ ] 全件が予算内 → `included` が全件、`omitted` が空
- [ ] 予算 0 → `included` が空、`omitted` が全件
- [ ] 予算不足時、**小さい差分から採用される**
- [ ] **1 件も予算に収まらない場合、`included` が空になり全件が `omitted` に回る**（規則 4 の要。最小 1 件を無理に採用しない）
- [ ] 単一ファイルの差分が予算を大きく超える場合でも、その 1 件が `included` に入らない
- [ ] `included` / `omitted` がいずれも**元の出現順に復元される**（規則 5 の要。昇順のままにしない）
- [ ] 同サイズの差分は `path` の辞書順で安定して並ぶ
- [ ] `omitted` の `FileSummary` に `insertions` / `deletions` が引き継がれる
- [ ] 入力配列が破壊されていない（ソートで元配列を壊さない）

### 1-6. `core/instructions.ts` — `collectInstructionRefs` / `buildInstructionTexts`

- [ ] 設計書 §6.3 の 2 相構成と規則を実装

**テストケース**（`test/instructions.test.ts`）

- [ ] 3 スコープすべてに値がある → **workspaceFolder → workspace → global の順で連結される**
- [ ] 一部スコープが `undefined` → 残りだけが使われる
- [ ] 全スコープが `undefined` → 空
- [ ] 同じ `file` が複数スコープに現れる → 1 回だけ
- [ ] 同じ `text` が複数スコープに現れる → 1 回だけ
- [ ] `text` と `file` が混在 → **`texts` が先、`files` の内容が後**
- [ ] 配列でない値が渡された → 無視される（クラッシュしない）
- [ ] `text` も `file` も持たないオブジェクト → 無視される
- [ ] `fileContents` に無いファイル → 無視される（読み込み失敗の扱い）
- [ ] **絶対パス（`/etc/x.md`）や `~/x.md` が特別扱いされず、他と同じくパス文字列として扱われる**（純正準拠の回帰防止。設計書 §1.1）
- [ ] 空文字・空白のみの要素は出力から除外される

### 1-7. `core/modelSelection.ts` — `resolveModel`

- [ ] 設計書 §6.4 の 3 段階の規則を実装

**テストケース**（`test/modelSelection.test.ts`）

- [ ] 指定 id が見つかる → `configured`
- [ ] 指定 id が見つからず auto がある → `fallback-auto` で `requestedId` に指定値が入る
- [ ] **未指定で auto がある → `fallback-auto` で `requestedId` が `undefined`**（警告を出さない分岐の要）
- [ ] 指定 id も auto も無い → `unavailable`
- [ ] 空文字の指定 → 未指定として扱われる
- [ ] 候補が複数ある場合、先頭が選ばれる

### 1-8. `core/prompt.ts` — `buildPrompt`

- [ ] 設計書 §6.6 のテンプレートと整形規則を実装

**テストケース**（`test/prompt.test.ts`）

- [ ] 全セクションが揃った入力 → 期待どおりの文字列（スナップショット的に固定文字列で比較）
- [ ] `recentCommits` が空 → **`# RECENT COMMITS` の見出しごと出力されない**
- [ ] `omittedFiles` が空 → `# OMITTED FILES` の見出しごと出力されない
- [ ] `instructions` が空 → `# CUSTOM INSTRUCTIONS` の見出しごと出力されない
- [ ] `includedDiffs` が空 → `# CODE CHANGES` の見出しごと出力されない
- [ ] `branchName` が空 → `Branch:` の行が出力されない
- [ ] `bodyLines` を持つコミットが 2 段インデントで出力される
- [ ] 差分が ` ```diff ` フェンスで囲まれ、`## {path}` 見出しが付く
- [ ] `omittedFiles` が `- {path} (+{n}/-{m})` 形式になる
- [ ] `# RULES` と `# REMINDER` は常に出力される
- [ ] **出力言語に関する指示が含まれていない**（ADR の意図を守る回帰テスト）

**フェーズ 1 完了判定**: `npm test` が全件パスし、`src/core/**` を `grep -r "from 'vscode'"` しても何もヒットしない。

---

## フェーズ 2: adapters

このフェーズは実機でしか検証できないため、テストは書かない（フェーズ 4 の手動確認で担保する）。

### 2-1. `src/messages.ts`

- [ ] 設計書 §10 の対応表を `Record<GenerationError['kind'], ...>` として実装
- [ ] `fallback-auto` の警告文言（`{id}` プレースホルダ付き）も含める

**完了判定**: `GenerationError` に新しい `kind` を仮に足すと型エラーになる（網羅性が型で保証されている）。

### 2-2. `adapters/gitAdapter.ts`

- [ ] `GitPort` / `RepositoryHandle` を設計書 §7.1 のとおり実装
- [ ] `getAPI(1)` は `exports.enabled === false` のとき throw するため、**先に `enabled` を確認する**
- [ ] `refresh()` は `repository.status()` を呼ぶ。**なぜ必要かをコメントに残す**（SCM の状態は遅延更新で、ステージ直後に古い値を読むと誤判定する）
- [ ] `getRecentCommitMessages()` は `try/catch` で失敗を握り潰し空配列を返す（浅いクローン・初回コミット前）
- [ ] `pickRepository` を設計書 §7.2 の 5 段階で実装
- [ ] **`commandArg` は防御的に扱う**。`rootUri` が `vscode.Uri` として取り出せたときだけ使い、駄目なら次の手段へ落ちる。**理由をコメントに残す**（`scm/title` から渡される引数の実型は未検証で、バージョン間で変わり得る）

### 2-3. `adapters/lmAdapter.ts`

- [ ] `LmPort` を設計書 §7.3 のとおり実装
- [ ] `selectById` → `selectChatModels({ id })`、`selectAuto` → `selectChatModels({ vendor: 'copilot', id: 'auto' })`
- [ ] **モデルオブジェクトをキャッシュしない**（一覧は動的に変わり、サインアウトで空になる）
- [ ] `sendRequest` に `justification` を渡す
- [ ] `LanguageModelError.code` による分岐を設計書 §7.3 の表のとおり実装
- [ ] キャンセル時は `cancelled` を返す

### 2-4. `adapters/configAdapter.ts`

- [ ] `getModelId()`: 空文字を `undefined` に正規化
- [ ] `getRecentCommitCount()`: 0〜50 にクランプ
- [ ] `getInstructionScopes()`: **`inspect()` で 3 スコープを配列にして返す**（`get()` の実効値ではない）
- [ ] `readInstructionFiles()`: 各ワークスペースフォルダに対し `Uri.joinPath` を試し、最初に読めたものを採用。読めなければ Map に入れない

### 2-5. `adapters/uiAdapter.ts`

- [ ] `createOutputChannel(name, { log: true })` で `LogOutputChannel` を生成し `context.subscriptions` に登録
- [ ] `withProgress({ location: ProgressLocation.Notification, cancellable: true })`
- [ ] エラー通知に `Show Details` ボタンを付け、押されたら `channel.show()`
- [ ] `cancelled` / `repository-not-selected` は通知を出さず Output にのみ記録

---

## フェーズ 3: usecase と配線

### 3-1. `usecase/generateCommitMessage.ts`

- [ ] 設計書 §3 のフロー順で実装
- [ ] 依存は `Deps` を**第 1 引数**で受け取る（コンストラクタ注入にしない）
- [ ] 設計書 §8.1 のトークン検証ループを実装（最大 2 回リトライ、最終判定は `maxInputTokens` そのもの）
- [ ] Output に記録する項目を設計書 §10 のとおり出す。**プロンプト全文は出さない**
- [ ] 各ステップの前でキャンセル済みかを確認し、`cancelled` を返す

### 3-2. `extension.ts`

- [ ] `activate` で adapter を生成し、コマンドを登録し、すべて `context.subscriptions` に積む
- [ ] コマンドハンドラは `(commandArg?: unknown) => ...` の形（`scm/title` からの引数を受け取れるように）
- [ ] 生成成功時に `handle.setCommitMessage(message)` を呼ぶ
- [ ] `resolution.kind === 'fallback-auto' && requestedId !== undefined` のとき警告通知を出す
- [ ] `deactivate` は空でよい（Disposable は `subscriptions` 任せ）

**完了判定**: `npm run build` が通り、F5 で拡張開発ホストが起動する。

---

## フェーズ 4: 実機確認

F5（拡張開発ホスト）で確認する。**すべてに ✅ が付くまで完了としない。**

### 基本動作

- [ ] コマンドパレットに `Commit Message Generator: Generate Commit Message` が出る
- [ ] ソース管理ビューのタイトルバーに `$(sparkle)` アイコンが出る
- [ ] `scm/title` のアイコンから実行すると生成され、コミットメッセージ入力欄に書き込まれる
- [ ] コマンドパレットから実行しても同じ結果になる
- [ ] 生成中に Notification の進捗が出る
- [ ] 進捗のキャンセルボタンを押すと中断され、入力欄が書き換わらない
- [ ] 入力欄に既存テキストがある状態で実行すると上書きされる
- [ ] 生成結果に ` ``` ` などのフェンス記号が混入していない

### 境界条件

- [ ] **ステージ済み変更なし** → 警告が出て LLM が呼ばれない（Output で確認）
- [ ] **Git リポジトリなしのフォルダ** → `no-repository` の警告
- [ ] **複数リポジトリのワークスペース**: `scm/title` アイコンから実行 → そのリポジトリが対象になる
- [ ] 複数リポジトリでコマンドパレットから実行 → QuickPick が出る。キャンセルしても通知が出ない
- [ ] **巨大な差分**（500 ファイル以上、または 1MB 超）→ 切り詰められ、`# OMITTED FILES` が出て、生成が成功する
- [ ] **単一の巨大ファイル**（`package-lock.json` の全面更新など）だけをステージ → `diff-too-large` にならず、ファイル一覧のみで生成が成功する
- [ ] **ステージ直後に即実行** → 「ステージが空」と誤判定されない（`status()` 呼び出しの回帰確認）
- [ ] 新規ファイルのみをステージ → 正しいパスで生成される
- [ ] ファイル削除のみをステージ → 正しいパスで生成される
- [ ] リネームのみをステージ → 変更後のパスで生成される

### 設定

- [ ] `commitMessageGenerator.model` に**存在するモデル id** を設定 → そのモデルが使われる（Output で確認）
- [ ] **存在しない id** を設定 → 警告が出て `auto` が使われる
- [ ] 未設定 → `auto` が使われ、**警告は出ない**
- [ ] `recentCommitCount: 0` → 直近コミットがプロンプトに載らない（Output のファイル数・トークン数で間接確認）
- [ ] `github.copilot.chat.commitMessageGeneration.instructions` に `{"text": "Use conventional commit format."}` → 生成結果が従う
- [ ] 同設定に `{"file": ".copilot-commit-message-instructions.md"}` → ファイル内容が反映される
- [ ] 存在しないファイルを指定 → クラッシュせず無視される
- [ ] **`{"file": "~/shared-instructions.md"}` を指定 → 解決されず無視される**（純正と同じ挙動であることの確認）
- [ ] ユーザー設定とワークスペース設定の両方に instructions → **両方が効く**（全スコープ連結の確認）

### エラー系

- [ ] Copilot からサインアウト → `no-model-available` のエラーが出る
- [ ] エラー通知の `Show Details` を押すと Output チャンネルが開く
- [ ] Output に「解決されたモデル」「ファイル数」「トークン数」が記録されている
- [ ] Output に**プロンプト全文や差分本文が出ていない**

### 環境

- [ ] Restricted Mode（ワークスペースを信頼しない）ではコマンドもアイコンも出ない
- [ ] **`scm/title` のアイコンが実際に表示される**（proposed でブロックされていないことの確認。表示されない場合は「拡張機能」ビューの問題タブに `proposedAPI.invalid` が出ていないか確認する）
- [ ] WSL リモートのワークスペースで動作する

---

## フェーズ 5: 公開準備

- [ ] `README.md` を書く。以下を必ず含める:
  - [ ] 何をする拡張か、なぜ存在するか（[microsoft/vscode#327959](https://github.com/microsoft/vscode/issues/327959) へのリンク）
  - [ ] **effort は設定できず、VS Code のモデルピッカーの Thinking Effort 設定に従う**こと（[ADR-0001](./adr/0001-no-effort-setting.md)）
  - [ ] **ステージ済み変更が無いと生成しない**こと（純正と異なる点。[ADR-0004](./adr/0004-abort-on-empty-stage.md)）
  - [ ] アイコンはソース管理ビューのタイトルバーに出ること（純正と位置が異なる。[ADR-0007](./adr/0007-scm-title-menu-placement.md)）
  - [ ] `github.copilot.chat.commitMessageGeneration.instructions` を参照すること。**独自の設定は追加せず、純正と同じ設定・同じ解決規則で動く**こと（純正が復旧したらアンインストールするだけで戻れる）
  - [ ] 純正機能が復旧したらアンインストールしてよいこと
- [ ] `CHANGELOG.md` を作る
- [ ] アイコン画像（128x128 PNG）を用意し `package.json` の `icon` に設定
- [ ] `npm run package:vsix` で VSIX が生成できる
- [ ] 生成した VSIX を `code --install-extension` で入れ、フェーズ 4 の基本動作だけ再確認する

---

## 任意タスク（本体完了後に着手可）

- [ ] **`scm/title` 引数の実型確認**
  防御的実装により動作には影響しないが、実型が判明したら `gitAdapter.pickRepository` のコメントを事実で置き換える。

### 解決済み（着手不要）

以下は設計フェーズで決着した。参考のために残す。

- ~~`engines.vscode` の下限引き下げ検証~~ → **`^1.90.0` で確定**。`@types/vscode` の 1.88 / 1.89 / 1.90 を比較し、`lm` 名前空間・`selectChatModels`・`LanguageModelChat.id`・`LanguageModelChatSelector.id` がいずれも 1.90.0 で初出（1.89 には無い）ことを確認済み。他の使用 API も 1.90.0 に揃っている。
- ~~`customInstructions.tsx` の全文確認~~ → **汎用指示は含まれないことを確認済み**。`.github/copilot-instructions.md` を集める `getAgentInstructions()` は `if (includeCodeGenerationInstructions !== false)` の内側にあり、コミットメッセージ生成は `includeCodeGenerationInstructions={false}` を渡すため実行されない。設計どおりで差異なし。
- ~~`scm/inputBox` への寄与~~ → **不可能と判明**。proposed API `contribSourceControlInputBoxMenu` でハードブロックされる。`scm/title` を採用（[ADR-0007](./adr/0007-scm-title-menu-placement.md)）。
