import * as vscode from 'vscode';
import { createConfigPort } from './adapters/configAdapter';
import { createGitPort } from './adapters/gitAdapter';
import { createLmPort } from './adapters/lmAdapter';
import { createUiPort } from './adapters/uiAdapter';
import { MESSAGES } from './messages';
import { generateCommitMessage } from './usecase/generateCommitMessage';

const COMMAND_ID = 'commitMessageGenerator.generate';

export function activate(context: vscode.ExtensionContext): void {
	const channel = vscode.window.createOutputChannel(MESSAGES.outputChannelName, { log: true });
	context.subscriptions.push(channel);

	const ui = createUiPort(channel);
	const lm = createLmPort();
	const config = createConfigPort();

	/**
	 * `commandArg` is whatever the `scm/title` menu passed, and is forwarded untouched for
	 * the adapter to interpret defensively. The active editor is read here rather than deeper
	 * in the call stack so that the use case stays free of ambient VS Code state.
	 */
	const run = async (commandArg?: unknown): Promise<void> => {
		const gitPort = await createGitPort();
		if (!gitPort.ok) {
			ui.reportError(gitPort.error);
			return;
		}

		const result = await ui.withProgress((token) =>
			generateCommitMessage(
				{
					git: gitPort.value,
					lm,
					config,
					log: ui,
					pickRepository: (candidates) => ui.pickRepository(candidates),
				},
				{ commandArg, activeEditorUri: vscode.window.activeTextEditor?.document.uri },
				token,
			),
		);

		if (!result.ok) {
			ui.reportError(result.error);
			return;
		}

		const { message, repository, resolution, omittedCount } = result.value;
		repository.setCommitMessage(message);
		ui.info(`Wrote commit message to ${repository.name} (${omittedCount} file(s) omitted).`);

		if (resolution.kind === 'fallback-auto' && resolution.requestedId !== undefined) {
			ui.warnModelFallback(resolution.requestedId);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_ID, (commandArg?: unknown) => void run(commandArg)),
	);
}

export function deactivate(): void {
	// Nothing to do: every disposable is owned by the extension context.
}
