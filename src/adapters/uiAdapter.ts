import * as vscode from 'vscode';
import type { GenerationError } from '../core/errors';
import { ERROR_MESSAGES, MESSAGES } from '../messages';
import type { RepositoryHandle } from './gitAdapter';

/** The subset of `LogOutputChannel` the extension writes to. */
export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface UiPort extends Logger {
	/** Runs `task` behind a cancellable progress notification. */
	withProgress<T>(task: (token: vscode.CancellationToken) => Promise<T>): Thenable<T>;
	pickRepository(candidates: readonly RepositoryHandle[]): Promise<RepositoryHandle | undefined>;
	reportError(error: GenerationError): void;
	warnModelFallback(requestedId: string): void;
}

export const createUiPort = (channel: vscode.LogOutputChannel): UiPort => ({
	info: (message) => channel.info(message),
	warn: (message) => channel.warn(message),
	error: (message) => channel.error(message),

	/**
	 * A notification rather than the quieter Source Control spinner, because
	 * `ProgressLocation.SourceControl` cannot show a cancel button. A model request can hang
	 * for a long time, and leaving the user no way out of it is worse than a transient toast.
	 */
	withProgress(task) {
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: MESSAGES.progressTitle,
				cancellable: true,
			},
			(_progress, token) => task(token),
		);
	},

	async pickRepository(candidates) {
		const picked = await vscode.window.showQuickPick(
			candidates.map((repository) => ({
				label: repository.name,
				description: repository.rootUri.fsPath,
				repository,
			})),
			{ placeHolder: MESSAGES.pickRepositoryPlaceholder },
		);
		return picked?.repository;
	},

	reportError(error) {
		const { severity, text } = ERROR_MESSAGES[error.kind];
		const detail = 'detail' in error ? ` ${error.detail}` : '';
		channel.error(`[${error.kind}] ${text}${detail}`);

		if (severity === 'silent') {
			return;
		}

		const show =
			severity === 'error'
				? vscode.window.showErrorMessage
				: vscode.window.showWarningMessage;

		void show(text, MESSAGES.showDetails).then((choice) => {
			if (choice === MESSAGES.showDetails) {
				channel.show();
			}
		});
	},

	warnModelFallback(requestedId) {
		const text = MESSAGES.modelFallback(requestedId);
		channel.warn(text);
		// Deliberately shown every time rather than once per session: this is a settings
		// mistake, and a warning the user stops seeing is a warning they stop fixing.
		void vscode.window.showWarningMessage(text);
	},
});
