# ADR-0007: アイコンは `scm/title` に置き、SCM 入力欄とステータスバーには置かない

- 状態: 採用
- 日付: 2026-08-19
- 関連: [ADR-0002](./0002-no-proposed-api.md)

## 背景

当初要件では起動トリガーを「コマンドパレット」と「ステータスバーに追加するアイコン」の 2 つとしていた。

初期調査で、純正 Copilot がコミットメッセージ入力欄の中にアイコンを出していることを確認し、`scm/inputBox` メニューへ寄与すれば同じ位置を再現できると報告した。これを受けて「入力欄内に置けるならステータスバーは不要」という判断がなされた。

**この報告は誤りだった。**

VS Code 本体の寄与ポイント定義を確認したところ、`scm/inputBox` は proposed API でゲートされている。

```ts
// vs/workbench/services/actions/common/menusExtensionPoint.ts
{
	key: 'scm/inputBox',
	id: MenuId.SCMInputBox,
	description: localize('menus.input', "The Source Control input box menu"),
	proposed: 'contribSourceControlInputBoxMenu'
},
```

登録処理では警告ではなくハードブロックが行われ、寄与そのものが捨てられる。

```ts
if (menu.proposed && !isProposedApiEnabled(extension.description, menu.proposed)) {
	collector.error(/* proposedAPI.invalid */);
	continue;
}
```

純正 Copilot Chat がここに寄与できるのは、63 個の proposed API を宣言する組み込み拡張だからであり、その特権は Marketplace 公開拡張には及ばない（[ADR-0002](./0002-no-proposed-api.md)）。

### SCM 寄与ポイントの Stable / Proposed

| 寄与ポイント | 公開拡張で使えるか |
|---|---|
| `scm/title` | ✅ Stable |
| `scm/sourceControl` | ✅ Stable |
| `scm/repository` | ✅ Stable |
| `scm/resourceState/context` / `scm/resourceFolder/context` / `scm/resourceGroup/context` | ✅ Stable |
| `scm/change/title` | ✅ Stable |
| `scm/inputBox` | ❌ `contribSourceControlInputBoxMenu` |
| `scm/repositories/title` | ❌ `contribSourceControlTitleMenu` |
| `scm/history/*` | ❌ `contribSourceControlHistoryItemMenu` ほか |
| `scm/artifact*` | ❌ `contribSourceControlArtifact*Menu` |

## 決定

**`scm/title` に `group: "navigation"` でアイコンを寄与する。** ステータスバーアイテムは実装しない。

```jsonc
"scm/title": [{
  "command": "commitMessageGenerator.generate",
  "group": "navigation",
  "when": "scmProvider == git"
}]
```

トリガーはコマンドパレットと `scm/title` アイコンの 2 つになる。

## 根拠

- `scm/title` はソース管理ビューのタイトルバーで、コミットメッセージ入力欄の直上にある。入力欄の中に置けない制約下では、**「SCM の中に置く」という意図に最も近い**。
- 純正 Copilot の `github.copilot.chat.review.changes` も `scm/title` に出ており、SCM 関連の操作をここに置くのは VS Code 内で確立した慣習である。
- ステータスバーを併用しない理由は、同一機能の入口が 3 つ（コマンドパレット／`scm/title`／ステータスバー）になり、常時表示されるステータスバーの領域を消費する割に、追加の導線価値が小さいため。この拡張を使う瞬間、ユーザーはほぼ確実にソース管理ビューを開いている。

## 帰結

- ソース管理ビューを開いていないときはコマンドパレットからのみ起動できる。ステータスバーのように常時見えてはいない。
- 純正機能が復旧しても、純正は入力欄内、本拡張は `scm/title` と位置が異なるため、アイコンが並んで紛らわしくなることはない。表示切替設定は不要。
- `scm/title` から渡されるコマンド引数の実型は未検証のため、`pickRepository` は引数を防御的に扱う（設計書 §7.2）。引数の型がどうであれ動作は変わらない。

## 検討した代替案

| 案 | 却下理由 |
|---|---|
| `scm/inputBox` に寄与 | proposed でハードブロックされ、公開拡張では表示されない |
| ローカル VSIX 配布に切り替えて proposed を使う | 入力欄アイコンと effort 設定の両方が復活するが、Marketplace 公開を諦めることになる（[ADR-0002](./0002-no-proposed-api.md) の再判断が必要）。今回は公開を優先した |
| ステータスバーに戻す | 当初要件どおりだが、常時表示の領域を消費する。SCM 内配置の方が意図に近い |
| `scm/title` とステータスバーの両方 | 同一機能の入口が 3 つになり冗長 |
| `scm/sourceControl`（リポジトリの「…」メニュー） | Stable だが 2 階層潜るため、1 クリックで起動できない |
