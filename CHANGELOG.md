# Changelog

## 0.1.0

Initial release.

- Generate a commit message from the staged diff using the VS Code Language Model API
- Trigger from the Command Palette or the Source Control view title bar
- Model selectable via `commitMessageGenerator.model`, falling back to `auto`
- Honours `github.copilot.chat.commitMessageGeneration.instructions`
