import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt } from '../src/core/prompt';
import type { PromptInput } from '../src/core/models';

const base: PromptInput = {
	repositoryName: 'repo',
	branchName: 'main',
	recentCommits: [],
	includedDiffs: [],
	omittedFiles: [],
	instructions: [],
};

const diff = { path: 'a.ts', body: '@@ -1 +1 @@\n-a\n+b', insertions: 1, deletions: 1 };

test('renders every section when all inputs are present', () => {
	const p = buildPrompt({
		...base,
		recentCommits: [{ subject: 'feat: x', bodyLines: ['why'] }],
		includedDiffs: [diff],
		omittedFiles: [{ path: 'big.json', insertions: 9, deletions: 8 }],
		instructions: ['Use conventional commits.'],
	});
	assert.match(p, /# RULES/);
	assert.match(p, /Repository: repo\nBranch: main/);
	assert.match(p, /# RECENT COMMITS/);
	assert.match(p, /# CODE CHANGES/);
	assert.match(p, /# OMITTED FILES \(changed, but bodies omitted/);
	assert.match(p, /# CUSTOM INSTRUCTIONS/);
	assert.match(p, /# REMINDER/);
});

test('omits the RECENT COMMITS heading and its rule when there are none', () => {
	const p = buildPrompt(base);
	assert.doesNotMatch(p, /# RECENT COMMITS/);
	// The rule must go too: pointing at a section that is not there asks the model to
	// reason about missing input.
	assert.doesNotMatch(p, /Review RECENT COMMITS/);
});

test('omits the OMITTED FILES heading when nothing was demoted', () => {
	assert.doesNotMatch(buildPrompt(base), /OMITTED FILES/);
});

test('omits the CUSTOM INSTRUCTIONS heading when there are none', () => {
	assert.doesNotMatch(buildPrompt(base), /CUSTOM INSTRUCTIONS/);
});

test('renames the section and retargets the rules when every diff was demoted', () => {
	const p = buildPrompt({ ...base, omittedFiles: [{ path: 'x', insertions: 1, deletions: 1 }] });
	assert.doesNotMatch(p, /# CODE CHANGES/);
	assert.match(p, /# CHANGED FILES \(diff bodies omitted/);
	assert.match(p, /Use the CHANGED FILES list/);
	assert.match(p, /describing the CHANGED FILES above/);
});

test('rule numbering stays sequential when rules are dropped', () => {
	const p = buildPrompt(base);
	const numbers = [...p.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
	assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1));
});

test('omits the Branch line when the branch name is empty', () => {
	const p = buildPrompt({ ...base, branchName: '' });
	assert.match(p, /Repository: repo/);
	assert.doesNotMatch(p, /Branch:/);
});

test('indents commit body lines under the subject', () => {
	const p = buildPrompt({ ...base, recentCommits: [{ subject: 's', bodyLines: ['b1', 'b2'] }] });
	assert.match(p, /- s\n {2}b1\n {2}b2/);
});

test('wraps each diff in a fenced block under its path heading', () => {
	const p = buildPrompt({ ...base, includedDiffs: [diff] });
	assert.match(p, /## a\.ts\n```diff\n@@ -1 \+1 @@/);
});

test('formats omitted files with their line counts', () => {
	const p = buildPrompt({ ...base, omittedFiles: [{ path: 'x.ts', insertions: 3, deletions: 4 }] });
	assert.match(p, /- x\.ts \(\+3\/-4\)/);
});

test('RULES and REMINDER are always present', () => {
	const p = buildPrompt(base);
	assert.match(p, /# RULES/);
	assert.match(p, /# REMINDER/);
});

test('never pins the output language to a specific one', () => {
	// Guards ADR intent. Telling the model to match RECENT COMMITS' language is the whole
	// point; what must never appear is a fixed language or anything derived from the
	// editor locale, which is how a Japanese-locale user ends up committing Japanese
	// messages to an English codebase.
	const p = buildPrompt({ ...base, recentCommits: [{ subject: 's', bodyLines: [] }] });
	assert.doesNotMatch(p, /\b(English|Japanese|Chinese|Korean|French|German|Spanish)\b/i);
	assert.doesNotMatch(p, /\b(locale|display language|UI language|respond in)\b/i);
	// And it must actively delegate the choice to the repository's own history.
	assert.match(p, /Match their format, style, and language/);
});
