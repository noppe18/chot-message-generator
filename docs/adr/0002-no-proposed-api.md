# ADR-0002: Marketplace 公開のため proposed API を使用しない

- 状態: 採用
- 日付: 2026-08-19
- 関連: [ADR-0001](./0001-no-effort-setting.md)

## 背景

本拡張は VS Code 標準の Generate Commit Message が壊れている（[microsoft/vscode#327959](https://github.com/microsoft/vscode/issues/327959)）ことへの暫定的な代替として着手した。当初は個人利用のローカル運用も選択肢だった。

配布形態は proposed API の可否を直接規定する。

- **ローカル運用のみ**なら `enabledApiProposals` を宣言し、`argv.json` の `enable-proposed-api` で有効化できる。この場合 [ADR-0001](./0001-no-effort-setting.md) の effort は要求どおり完全に実装できる。
- **Marketplace 公開**では、allowlist に登録されていない拡張の proposed API は無効化される。

本拡張で proposed API が有用なのは以下だった。

| proposal | 得られるもの |
|---|---|
| `chatProvider` | `LanguageModelChatRequestOptions.configuration` → `reasoningEffort` の指定 |
| `languageModelSystem` | `LanguageModelChatMessage` の System ロール |

## 決定

**Marketplace 公開を選択し、proposed API は一切使用しない。** `package.json` に `enabledApiProposals` を書かない。

## 帰結

- effort を指定できない（[ADR-0001](./0001-no-effort-setting.md)）。
- System ロールが使えないため、モデルへのルール指示を User メッセージに畳み込む必要がある。プロンプト設計はこの制約を前提に組む（設計書 §6.6）。
- VS Code のバージョン更新で proposed API の形が変わっても本拡張は壊れない。安定性は上がる。
- Marketplace 公開に伴い、MIT ライセンス、英語 UI、`README.md` の整備が必要になる。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| ローカル VSIX のみで運用し proposed API を使う | 要求は全て満たせるが、配布先が自分のみに限られる |
| dev/stable の 2 ビルドを維持する | ビルド経路が 2 系統になり、proposed 側は実質テストされないまま腐る |
