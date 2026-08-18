import * as vscode from 'vscode';
import type { GenerationError } from '../core/errors';
import { err, ok, type Result } from '../core/result';
import type { GitExtension, Repository } from '../types/git';

/** A repository, reduced to the operations this extension performs. */
export interface RepositoryHandle {
	readonly rootUri: vscode.Uri;
	/** Directory name of the repository root, used as context in the prompt. */
	readonly name: string;
	/** Current branch, or `''` for a detached HEAD or a repository with no commits yet. */
	readonly branchName: string;
	/** Re-reads repository state. See {@link GitPort} for why this is not optional. */
	refresh(): Promise<void>;
	hasStagedChanges(): boolean;
	getStagedDiff(): Promise<string>;
	getRecentCommitMessages(max: number): Promise<readonly string[]>;
	setCommitMessage(message: string): void;
}

export interface GitPort {
	getRepositories(): readonly RepositoryHandle[];
	getRepositoryByUri(uri: vscode.Uri): RepositoryHandle | undefined;
	/** Repositories currently selected in the Source Control view. */
	getSelectedRepositories(): readonly RepositoryHandle[];
}

const basename = (uri: vscode.Uri): string => {
	const parts = uri.path.split('/').filter((p) => p.length > 0);
	return parts[parts.length - 1] ?? uri.path;
};

const wrap = (repository: Repository): RepositoryHandle => ({
	rootUri: repository.rootUri,
	name: basename(repository.rootUri),
	get branchName(): string {
		return repository.state.HEAD?.name ?? '';
	},

	/**
	 * The Source Control view updates its state lazily, so immediately after the user stages
	 * something `state.indexChanges` can still be empty. Without this refresh the extension
	 * reports "no staged changes" for changes that are plainly staged in the UI — the exact
	 * failure the built-in Copilot avoids by calling `status()` first.
	 */
	async refresh() {
		await repository.status();
	},

	hasStagedChanges: () => repository.state.indexChanges.length > 0,

	getStagedDiff: () => repository.diff(true),

	async getRecentCommitMessages(max) {
		if (max <= 0) {
			return [];
		}
		try {
			const commits = await repository.log({ maxEntries: max });
			return commits.map((commit) => commit.message);
		} catch {
			// `git log` fails in a repository with no commits yet, and can fail on shallow
			// clones. Style hints are a nicety; losing them must not fail the whole request.
			return [];
		}
	},

	setCommitMessage(message) {
		repository.inputBox.value = message;
	},
});

/** Acquires the built-in Git extension's API. */
export const createGitPort = async (): Promise<Result<GitPort, GenerationError>> => {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return err({ kind: 'git-extension-unavailable' });
	}

	const exports = await extension.activate();
	// `getAPI` throws when the Git extension is disabled, so check before calling it.
	if (!exports.enabled) {
		return err({ kind: 'git-extension-unavailable' });
	}

	const api = exports.getAPI(1);

	return ok({
		getRepositories: () => api.repositories.map(wrap),
		getRepositoryByUri: (uri) => {
			const repository = api.getRepository(uri);
			return repository ? wrap(repository) : undefined;
		},
		getSelectedRepositories: () => api.repositories.filter((r) => r.ui.selected).map(wrap),
	});
};

/**
 * Reads a repository root out of whatever the SCM menu passed as a command argument.
 *
 * VS Code hands a `scm/title` contribution the `SourceControl` of the repository, but only
 * sometimes: `SCMViewPane.getActionsContext()` returns the provider when exactly one
 * repository is visible and `undefined` otherwise, so clicking the view-title icon in a
 * multi-repository workspace supplies no argument at all. Clicking the icon on an
 * individual repository row does supply one, because the row's toolbar carries that
 * repository as its context.
 *
 * The argument is therefore treated as a hint, never a requirement. Anything other than a
 * usable `rootUri` falls through to the next strategy, which also insulates this from the
 * marshalling that turns the internal provider into the public `SourceControl` object.
 */
const rootUriOf = (commandArg: unknown): vscode.Uri | undefined => {
	const candidate = (commandArg as { rootUri?: unknown } | null | undefined)?.rootUri;
	return candidate instanceof vscode.Uri ? candidate : undefined;
};

/**
 * Decides which repository to act on, asking the user only when the intent is genuinely
 * ambiguous.
 */
export const pickRepository = async (
	git: GitPort,
	commandArg: unknown,
	activeEditorUri: vscode.Uri | undefined,
	quickPick: (candidates: readonly RepositoryHandle[]) => Promise<RepositoryHandle | undefined>,
): Promise<Result<RepositoryHandle, GenerationError>> => {
	const fromMenu = rootUriOf(commandArg);
	if (fromMenu) {
		const handle = git.getRepositoryByUri(fromMenu);
		if (handle) {
			return ok(handle);
		}
	}

	const selected = git.getSelectedRepositories();
	if (selected.length === 1 && selected[0]) {
		return ok(selected[0]);
	}

	if (activeEditorUri) {
		const handle = git.getRepositoryByUri(activeEditorUri);
		if (handle) {
			return ok(handle);
		}
	}

	const all = git.getRepositories();
	if (all.length === 0) {
		return err({ kind: 'no-repository' });
	}
	if (all.length === 1 && all[0]) {
		return ok(all[0]);
	}

	const chosen = await quickPick(all);
    return chosen ? ok(chosen) : err({ kind: 'repository-not-selected' });
};
