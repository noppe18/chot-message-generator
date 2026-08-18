/*---------------------------------------------------------------------------------------------
 *  Type definitions for the built-in Git extension's API (`vscode.git`).
 *
 *  Derived from:
 *    https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 *    (Copyright (c) Microsoft Corporation, MIT License)
 *  Retrieved: 2026-08-19, against vscode.git 10.0.0 as bundled with VS Code 1.133.0.
 *
 *  Why vendored: Microsoft does not publish these types on npm, so copying the declarations
 *  into the repository is the only way to get type safety against the Git extension API.
 *
 *  Why trimmed rather than copied verbatim: the upstream file imports `SourceControlHistoryItem`
 *  from 'vscode', which does not exist in @types/vscode 1.90 — our declared floor. Copying the
 *  whole file would silently couple our supported VS Code range to whatever the newest API
 *  surface happens to be. Declaring only the members this extension actually calls keeps the
 *  dependency surface explicit and reviewable: if something new is needed, it has to be added
 *  here first, which is the moment to ask whether it exists in the oldest supported version.
 *--------------------------------------------------------------------------------------------*/

import type { Uri, Event } from 'vscode';

export const enum RefType {
	Head,
	RemoteHead,
	Tag,
}

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}

export interface Branch extends Ref {
	readonly ahead?: number;
	readonly behind?: number;
}

export interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
}

export interface LogOptions {
	/** Max number of log entries to retrieve. If not specified, the default is 32. */
	readonly maxEntries?: number;
	readonly path?: string;
	readonly author?: string;
}

export const enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,

	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,

	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED,
}

export interface Change {
	readonly uri: Uri;
	readonly originalUri: Uri;
	readonly renameUri: Uri | undefined;
	readonly status: Status;
}

export interface InputBox {
	value: string;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];
	readonly onDidChange: Event<void>;
}

export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;
	readonly state: RepositoryState;
	readonly ui: RepositoryUIState;

	/** Refreshes the repository state. Resolves once `state` reflects the working tree. */
	status(): Promise<void>;

	/** `cached: true` yields the staged diff (`git diff --cached`) as a unified diff string. */
	diff(cached?: boolean): Promise<string>;

	log(options?: LogOptions): Promise<Commit[]>;
}

export interface API {
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;

	getRepository(uri: Uri): Repository | null;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;

	/**
	 * Returns a specific API version.
	 *
	 * Throws an error if the Git extension is disabled — check {@link GitExtension.enabled}
	 * before calling.
	 */
	getAPI(version: 1): API;
}
