# Chot Message Generator

Generates a git commit message from your **staged** changes using the VS Code Language Model API, and writes it into the Source Control commit message box.

## Why this exists

VS Code's built-in "Generate Commit Message" (provided by GitHub Copilot) is currently broken — see [microsoft/vscode#327959](https://github.com/microsoft/vscode/issues/327959). This extension is a stand-in until that is fixed.

It is designed so that **leaving is as easy as arriving**: it adds no settings of its own for custom instructions and reads the same `github.copilot.chat.commitMessageGeneration.instructions` the built-in feature reads, with the same resolution rules. When the built-in feature works again, uninstall this extension and everything keeps working.

## Usage

Stage your changes, then either:

- Run **Generate Commit Message** from the Command Palette, or
- Click the ✨ icon in the **Source Control view title bar**

The generated message replaces whatever is in the commit message box. Run it again to regenerate.

## Requirements

- VS Code 1.90.0 or later
- Access to a language model — in practice a GitHub Copilot subscription, or another extension that contributes a language model provider

The first run shows a consent prompt for language model access.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `commitMessageGenerator.model` | `""` | Model `id` to use, matched exactly (for example `gpt-5.1`). When empty or unavailable, `auto` is used. |
| `commitMessageGenerator.recentCommitCount` | `5` | How many recent commit messages to include as a style reference. `0` disables it. |

### Custom instructions

The standard VS Code setting is used as-is:

```jsonc
"github.copilot.chat.commitMessageGeneration.instructions": [
  { "file": ".copilot-commit-message-instructions.md" },
  { "text": "Use conventional commit message format." }
]
```

Entries from **all** configuration scopes are combined (workspace folder, workspace, then user), so shared rules in your user settings are not discarded by a project that defines its own. File paths are resolved relative to workspace folders — the same as the built-in feature, which means absolute and `~/` paths are not resolved.

## Differences from the built-in feature

| | Built-in | This extension |
| --- | --- | --- |
| Icon location | Inside the commit message box | Source Control view **title bar** |
| No staged changes | Falls back to the working tree | **Stops with a warning** |
| Reasoning effort | Configurable per model | Follows your model picker setting; not configurable here |

**Why the icon is elsewhere**: the commit message box menu (`scm/inputBox`) is gated behind a proposed API that published extensions cannot use.

**Why it stops instead of using the working tree**: the message is about to describe a commit that will contain the index and nothing else. Generating from unstaged work produces a message that does not match what actually gets committed.

**Why reasoning effort is not a setting**: the stable Language Model API gives extensions no way to set it. Copilot filters `modelOptions` down to a fixed allow-list that excludes it, and the real path (`configuration`) is a proposed API. Set **Thinking Effort** in VS Code's model picker instead; that value is applied to requests from this extension too.

## Privacy

The staged diff, recent commit messages, your branch and repository name, and the contents of any instruction files are sent to the language model you selected. Nothing else leaves your machine, and the extension keeps no history between runs.

The extension is disabled in [Restricted Mode](https://code.visualstudio.com/docs/editor/workspace-trust), because opening an untrusted repository would otherwise let its committed workspace settings feed arbitrary files into the prompt.

## Development

```bash
npm install
npm test        # pure-core unit tests, no VS Code needed
npm run lint
npm run build   # type-check + bundle
```

Press <kbd>F5</kbd> to launch an Extension Development Host.

Design notes, and an architecture decision record for each non-obvious choice, live in [`docs/`](./docs).

## License

MIT
