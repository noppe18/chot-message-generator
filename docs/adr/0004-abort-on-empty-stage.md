# ADR-0004: ステージ済み変更が無い場合は生成せずに中断する

- 状態: 採用
- 日付: 2026-08-19

## 背景

純正 Copilot の実装（`vscode-copilot-chat/src/extension/prompt/vscode-node/gitCommitMessageServiceImpl.ts`）は、インデックスが空のときワーキングツリーと未追跡ファイルにフォールバックする。

```ts
const resources = repository.state.indexChanges.length > 0
  ? repository.state.indexChanges
  : [
      ...repository.state.workingTreeChanges,
      ...repository.state.untrackedChanges ?? []
    ];
```

本拡張は純正の代替として作るため、挙動を揃えるべきかが論点になる。

## 決定

**フォールバックしない。** `state.indexChanges` が空なら警告を出して終了する。

```
No staged changes to describe. Stage the changes you want to commit and try again.
```

## 根拠

- 生成したメッセージは `inputBox.value` に書き込まれ、そのまま `git commit` される。**コミットされるのはインデックスの内容だけ**である。ワーキングツリーの変更を根拠にメッセージを書くと、`git commit -a` を使わない限り**メッセージと実際のコミット内容が食い違う**。これはコミット履歴に恒久的に残る誤りであり、便利さと引き換えにして良い種類の不整合ではない。
- 要件で明示的に「Stage 差分情報を取得してコンテキストとする」と指定されている。
- 空振りの LLM 呼び出しを避けられる（クォータの節約）。
- 「なぜ何も起きないのか」がユーザーに伝わる。黙ってワーキングツリーを使うより、警告 1 行の方が理解しやすい。

## 帰結

- ステージせずにアイコンを押したユーザーは警告を受け取る。純正から乗り換えた場合、この点だけ挙動が変わる。README に明記する。
- `settings` で切り替えられるようにする案は採らない。設定項目を増やす価値より、挙動が一意である価値を採る。
- `state.indexChanges` を見る直前に必ず `repository.status()` を呼ぶこと。SCM の状態は遅延更新のため、ステージ直後は古い値が残っており、これを怠ると**正しくステージされているのに警告が出る**（設計書 §7.1）。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| 純正と同じくワーキングツリーへフォールバック | メッセージとコミット内容が食い違う |
| `commitMessageGenerator.fallbackToWorkingTree` 設定を用意 | 設定を増やす割に、既定値以外を選ぶ動機が薄い |
| ステージが空なら自動で全部ステージする | ユーザーの意図しない `git add` は破壊的すぎる |
