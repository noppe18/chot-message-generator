import type { FileDiff } from './models';

const FILE_HEADER = /^diff --git /;
const PLUS_PATH = /^\+\+\+ (.*)$/m;
const MINUS_PATH = /^--- (.*)$/m;
const GIT_HEADER_PATHS = /^diff --git (\S+) (\S+)$/m;

/**
 * Turns a raw path token from a diff header into a repository-relative path.
 *
 * The order of operations matters: git writes the quote *outside* the prefix, as in
 * `+++ "b/my file.ts"`, so stripping `b/` before removing the quotes leaves the prefix
 * behind. Unquote first, then drop the prefix.
 *
 * Escape sequences inside a quoted path are deliberately left uninterpreted. These paths
 * are only ever shown to the model as context and never used to open a file, so a literal
 * `\303\251` is harmless whereas a buggy unescaper would not be.
 */
const normalizePath = (raw: string, prefix: 'a/' | 'b/'): string => {
	// Some diff producers append a tab-separated timestamp after the path.
	const token = raw.split('\t')[0]?.trim() ?? '';
	const unquoted =
		token.startsWith('"') && token.endsWith('"') && token.length >= 2
			? token.slice(1, -1)
			: token;
	return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
};

/**
 * Determines the path a diff block refers to.
 *
 * The order matters. `+++ b/<path>` is the post-change path, which is what we want for
 * additions, modifications, and renames. It reads `/dev/null` for deletions, and only
 * then does `--- a/<path>` hold the answer. The `diff --git` header is the last resort
 * because it is the least consistent of the three across git versions and rename modes.
 */
const extractPath = (block: string): string => {
	const plus = PLUS_PATH.exec(block)?.[1];
	if (plus !== undefined) {
		const path = normalizePath(plus, 'b/');
		if (path !== '/dev/null') {
			return path;
		}
	}

	const minus = MINUS_PATH.exec(block)?.[1];
	if (minus !== undefined) {
		const path = normalizePath(minus, 'a/');
		if (path !== '/dev/null') {
			return path;
		}
	}

	// Last resort. Least reliable of the three, because an unquoted path containing a space
	// makes the two-token header genuinely ambiguous — which is exactly why the `+++`/`---`
	// lines are consulted first.
	const header = GIT_HEADER_PATHS.exec(block);
	if (header?.[2] !== undefined) {
		return normalizePath(header[2], 'b/');
	}
	return header?.[1] !== undefined ? normalizePath(header[1], 'a/') : '';
};

const countLines = (block: string): { insertions: number; deletions: number } => {
	let insertions = 0;
	let deletions = 0;
	for (const line of block.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			insertions += 1;
		} else if (line.startsWith('-') && !line.startsWith('---')) {
			deletions += 1;
		}
	}
	return { insertions, deletions };
};

/**
 * Splits a unified diff into per-file blocks.
 *
 * Why split here instead of asking git for each file: `Repository.diff(true)` is a single
 * git invocation for the whole index, whereas per-file diffs spawn one process per changed
 * file. Splitting the string ourselves keeps that at one process while still allowing the
 * budget logic to drop individual files.
 *
 * @returns Blocks in their original order. Empty when the input contains no diff headers.
 */
export const splitUnifiedDiff = (raw: string): readonly FileDiff[] => {
	const lines = raw.replace(/\r\n/g, '\n').split('\n');

	const blocks: string[] = [];
	let current: string[] | undefined;
	for (const line of lines) {
		if (FILE_HEADER.test(line)) {
			if (current) {
				blocks.push(current.join('\n'));
			}
			current = [line];
		} else if (current) {
			current.push(line);
		}
		// Text before the first `diff --git` line is preamble and is discarded.
	}
	if (current) {
		blocks.push(current.join('\n'));
	}

	return blocks.map((body) => ({ path: extractPath(body), body, ...countLines(body) }));
};
