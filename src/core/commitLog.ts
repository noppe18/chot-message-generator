import type { RecentCommit } from './models';

/**
 * Git trailer lines, which carry metadata rather than prose.
 *
 * Why they are stripped: the prompt asks the model to imitate the *style* of recent
 * commits. Left in, these lines get imitated too, and the generated message arrives with
 * a fabricated co-author or an issue number copied from an unrelated commit. The user
 * adds their own trailers after the fact, so the model never needs to see them.
 */
export const TRAILER_PATTERN =
	/^(Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Tested-by|Reported-by|Refs|Closes|Fixes|Cc):\s/i;

/** Default cap on how many lines of a single past commit message to keep. */
export const DEFAULT_MAX_LINES = 10;

/**
 * Normalizes one raw commit message into a style reference.
 *
 * Trailers are only stripped from line 2 onwards. The subject line is always kept as-is,
 * because a Conventional Commits subject such as `fix: ...` would otherwise be matched by
 * the trailer pattern and thrown away.
 *
 * @param maxLines Total line budget including the subject.
 */
export const normalizeCommitMessage = (
	raw: string,
	maxLines: number = DEFAULT_MAX_LINES,
): RecentCommit => {
	const lines = raw.replace(/\r\n/g, '\n').trim().split('\n');
	const subject = lines[0] ?? '';

	const kept = lines.slice(1).filter((line) => !TRAILER_PATTERN.test(line));

	// Collapse runs of blank lines, then drop leading/trailing blanks.
	const collapsed: string[] = [];
	for (const line of kept) {
		const isBlank = line.trim() === '';
		if (isBlank && collapsed[collapsed.length - 1]?.trim() === '') {
			continue;
		}
		collapsed.push(line);
	}
	while (collapsed.length > 0 && collapsed[0]?.trim() === '') {
		collapsed.shift();
	}
	while (collapsed.length > 0 && collapsed[collapsed.length - 1]?.trim() === '') {
		collapsed.pop();
	}

	const bodyBudget = Math.max(0, maxLines - 1);
	return { subject, bodyLines: collapsed.slice(0, bodyBudget) };
};

export const normalizeCommitMessages = (
	raws: readonly string[],
	maxLines: number = DEFAULT_MAX_LINES,
): readonly RecentCommit[] => raws.map((raw) => normalizeCommitMessage(raw, maxLines));
