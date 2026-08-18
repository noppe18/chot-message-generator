import type { FileDiff, FileSummary } from './models';

/**
 * Rough characters-per-token ratio used to size the diff before spending a real
 * `countTokens` round-trip. Deliberately crude; the caller verifies the assembled prompt
 * against the model's own tokenizer and shrinks the budget if this estimate was optimistic.
 */
export const CHARS_PER_TOKEN = 4;

export const approxTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export interface BudgetOutcome {
	/** Diffs whose bodies fit, in their original order. */
	readonly included: readonly FileDiff[];
	/** Diffs reduced to a path and a line count, in their original order. */
	readonly omitted: readonly FileSummary[];
}

const toSummary = (diff: FileDiff): FileSummary => ({
	path: diff.path,
	insertions: diff.insertions,
	deletions: diff.deletions,
});

/**
 * Chooses which diff bodies to send within an approximate token budget.
 *
 * Smallest-first, because a commit's shape is better conveyed by many small diffs than by
 * one large one: letting a single generated file consume the whole budget would hide every
 * other change from the model.
 *
 * When nothing fits, everything is demoted rather than force-including the smallest file.
 * A single `package-lock.json` can exceed the context window on its own; forcing it in
 * would make the retry loop unable to shrink anything and guarantee a `diff-too-large`
 * failure. The file list alone is still enough for the model to write something honest
 * like "chore: update generated bundle".
 */
export const selectWithinBudget = (
	diffs: readonly FileDiff[],
	budgetTokens: number,
): BudgetOutcome => {
	if (budgetTokens <= 0) {
		return { included: [], omitted: diffs.map(toSummary) };
	}

	const bySize = [...diffs].sort((a, b) => {
		const diff = approxTokens(a.body) - approxTokens(b.body);
		return diff !== 0 ? diff : a.path.localeCompare(b.path);
	});

	const chosen = new Set<FileDiff>();
	let spent = 0;
	for (const diff of bySize) {
		const cost = approxTokens(diff.body);
		if (spent + cost > budgetTokens) {
			break;
		}
		spent += cost;
		chosen.add(diff);
	}

	// Restore the caller's ordering so the prompt reads like the diff the user staged.
	return {
		included: diffs.filter((d) => chosen.has(d)),
		omitted: diffs.filter((d) => !chosen.has(d)).map(toSummary),
	};
};
