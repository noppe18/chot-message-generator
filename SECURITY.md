# Security Policy

## Supported versions

Only the latest published version receives fixes. This extension exists as a stand-in while
VS Code's built-in "Generate Commit Message" is broken, so older versions are not backported.

## Reporting a vulnerability

Please report privately through GitHub's
[private vulnerability reporting](https://github.com/noppe18/commit-message-generator/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and what you expected. A minimal reproduction —
a repository state plus the settings in effect — helps more than anything else.

This is a personal project maintained by one person, so please allow a few days for a first
response. If a report is confirmed, the fix and the advisory are published together.

## What is in scope

- Executing code or reading files outside what the extension needs to build a prompt
- Sending repository content to a model when the user did not invoke the command
- Anything that lets a repository's own contents change what the extension does to a user
  who merely opened it
- Leaking the contents of the commit message box, the diff, or instruction files anywhere
  other than the selected language model

## What is not a vulnerability

**Sending the staged diff to a language model.** That is the entire purpose of the extension
and it is documented in the README. The diff, recent commit messages, the repository and
branch name, and the contents of any configured instruction files are all sent to the model
you selected. Choosing which model receives them is the user's decision.

**Instruction files influencing the generated message.** `github.copilot.chat.commitMessageGeneration.instructions`
is a user setting whose purpose is to steer the output.

There is a real hazard nearby, and it is handled deliberately: a repository can commit
workspace settings that point at instruction files, so opening someone else's repository
could otherwise feed their text into your prompt. The extension declares
`untrustedWorkspaces: false`, so it does not activate at all until you trust the workspace.
**A way to make it act on an untrusted workspace's contents would be in scope.**

## What this extension can reach

Useful context when judging impact:

- It has **no runtime dependencies**. Everything shipped in the VSIX is first-party code plus
  an icon.
- It reads the staged diff and recent commit messages through the built-in Git extension's
  API. It never runs `git` itself.
- It writes to exactly one place: the Source Control commit message box.
- It keeps no state between invocations and stores nothing on disk.
