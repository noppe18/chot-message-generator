/** One file's worth of staged diff. */
export interface FileDiff {
	/** Repository-relative path. For renames this is the post-rename (b-side) path. */
	readonly path: string;
	/** Raw text from the `diff --git` header up to (not including) the next one. */
	readonly body: string;
	/** Added lines: those starting with `+` but not `+++`. */
	readonly insertions: number;
	/** Removed lines: those starting with `-` but not `---`. */
	readonly deletions: number;
}

/** A file whose diff body was dropped to stay within the token budget. */
export interface FileSummary {
	readonly path: string;
	readonly insertions: number;
	readonly deletions: number;
}

/** A past commit message, normalized for use as a style reference. */
export interface RecentCommit {
	/** The subject line. */
	readonly subject: string;
	/** Body lines with trailers removed and the line cap applied. May be empty. */
	readonly bodyLines: readonly string[];
}

/** The subset of a language model's metadata that the pure core needs. */
export interface ModelCandidate {
	readonly id: string;
	readonly vendor: string;
	readonly name: string;
	readonly maxInputTokens: number;
}

/** Everything needed to assemble the prompt. */
export interface PromptInput {
	readonly repositoryName: string;
	readonly branchName: string;
	readonly recentCommits: readonly RecentCommit[];
	readonly includedDiffs: readonly FileDiff[];
	readonly omittedFiles: readonly FileSummary[];
	readonly instructions: readonly string[];
}
