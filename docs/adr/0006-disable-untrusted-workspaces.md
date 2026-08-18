# ADR-0006: 未信頼ワークスペースと仮想ワークスペースでは拡張を無効にする

- 状態: 採用
- 日付: 2026-08-19

## 背景

本拡張は以下の 2 種類のワークスペース由来のテキストを、そのまま言語モデルへ送信する。

1. **ステージ済み差分の本文** — リポジトリ内のコードそのもの
2. **カスタム指示ファイルの中身** — `github.copilot.chat.commitMessageGeneration.instructions` の `{ "file": "..." }` で指定されたファイル。パスはワークスペースフォルダ相対で解決される

2 が特に問題になる。ワークスペース設定（`.vscode/settings.json`）は**リポジトリにコミットできる**ため、他人のリポジトリをクローンして開いた時点で、そのリポジトリが指定した任意のファイルの中身がプロンプトに混入する経路が成立する。指示ファイルの内容はモデルへの命令として扱われるので、これはプロンプトインジェクションの成立条件そのものである。

VS Code の Workspace Trust は、まさにこの種のリスクに対する既定の防御機構である。

また、Git 拡張の `Repository.diff()` はローカルの git プロセス実行を前提とするため、仮想ファイルシステム上のワークスペースでは機能しない。

## 決定

`package.json` の `capabilities` で両方を無効と宣言する。

```jsonc
"capabilities": {
  "untrustedWorkspaces": {
    "supported": false,
    "description": "Staged diffs and custom instruction files are sent to a language model, so the workspace contents must be trusted."
  },
  "virtualWorkspaces": {
    "supported": false,
    "description": "Requires a local Git repository through the built-in Git extension."
  }
}
```

## 帰結

- Restricted Mode では拡張ごと有効化されず、コマンドも SCM のアイコンも現れない。ユーザーはワークスペースを信頼すれば使える。
- 「未信頼のときは指示ファイルの読み込みだけ無効化する」という部分制限（`limited`）は採らない。差分本文自体がモデルへ渡る点は変わらず、検証すべき経路が 2 つに増えるだけで、得られる安全性が中途半端になる。
- `description` に理由を書くことで、Restricted Mode の一覧でユーザーが判断できる。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| `untrustedWorkspaces: limited` | 差分本文は依然としてモデルへ渡る。分岐が増える割に安全性が中途半端 |
| `untrustedWorkspaces: true` | クローン直後のリポジトリの指示ファイルがそのままプロンプトに入る |
| 仮想ワークスペースを `limited` で許可 | Git 拡張の `diff()` が動かないため、そもそも機能しない |
