import type { FileDiff, FileSummary, PromptInput, RecentCommit } from './models';

const PREAMBLE =
	'You are helping a software developer write a git commit message for their staged changes.';

const REMINDER_TAIL = 'Output exactly one ```text code block and nothing else.';

/**
 * Builds the rule list, including only the rules whose subject matter is actually present.
 *
 * Why the rules are dynamic: a rule that points at a section the prompt does not contain
 * ("Review RECENT COMMITS…" with no such heading) asks the model to reason about missing
 * input. Numbering stays sequential so the list never reads as if a rule were censored.
 */
const formatRules = (input: PromptInput): string => {
	const rules: string[] = [];

	rules.push(
		input.includedDiffs.length > 0
			? 'Analyze the CODE CHANGES to understand what was modified.'
			: 'Use the CHANGED FILES list to understand which parts of the project were touched. The diff bodies were too large to include.',
	);
	rules.push('Identify the purpose of the changes so the message answers *why*, not just *what*.');

	if (input.recentCommits.length > 0) {
		rules.push(
			"Review RECENT COMMITS to learn this repository's established conventions. Match their format, style, and language. Never copy their content.",
		);
	}

	rules.push(
		'Do not include meta information such as issue references, tags, trailers, or author names. The developer adds those.',
	);
	rules.push(
		'Output exactly one ```text markdown code block containing the commit message, and nothing else.',
	);

	return `# RULES\n${rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`;
};

const formatRepository = (repositoryName: string, branchName: string): string => {
	const lines = ['# REPOSITORY', `Repository: ${repositoryName}`];
	// A detached HEAD, or a repository before its first commit, has no branch name. An empty
	// `Branch:` label is noise the model has to reason about, so the line is dropped entirely.
	if (branchName !== '') {
		lines.push(`Branch: ${branchName}`);
	}
	return lines.join('\n');
};

const formatCommit = (commit: RecentCommit): string =>
	[`- ${commit.subject}`, ...commit.bodyLines.map((line) => `  ${line}`)].join('\n');

const formatDiff = (diff: FileDiff): string => `## ${diff.path}\n\`\`\`diff\n${diff.body}\n\`\`\``;

const formatSummary = (file: FileSummary): string =>
	`- ${file.path} (+${file.insertions}/-${file.deletions})`;

/**
 * Assembles the single user message sent to the model.
 *
 * Everything lands in one user message because the stable Language Model API only exposes
 * the User and Assistant roles — sending a System message requires the `languageModelSystem`
 * proposal, which a published extension cannot enable.
 *
 * No instruction pins the output language. RECENT COMMITS already conveys the repository's
 * convention, and stating a language explicitly is how a Japanese-locale user ends up
 * committing Japanese messages to an English codebase. Users who want a fixed language say
 * so in their commit message instructions.
 *
 * Sections with nothing to show are omitted along with their headings.
 */
export const buildPrompt = (input: PromptInput): string => {
	const sections: string[] = [
		PREAMBLE,
		formatRules(input),
		formatRepository(input.repositoryName, input.branchName),
	];

	if (input.recentCommits.length > 0) {
		sections.push(
			`# RECENT COMMITS (style reference only — do not copy)\n${input.recentCommits
				.map(formatCommit)
				.join('\n\n')}`,
		);
	}

	if (input.includedDiffs.length > 0) {
		sections.push(`# CODE CHANGES\n${input.includedDiffs.map(formatDiff).join('\n\n')}`);
	}

	if (input.omittedFiles.length > 0) {
		// The heading differs depending on whether any diff bodies survived: with none, this
		// list is the only evidence of what changed and should not read as an afterthought.
		const heading =
			input.includedDiffs.length > 0
				? '# OMITTED FILES (changed, but bodies omitted due to size limits)'
				: '# CHANGED FILES (diff bodies omitted due to size limits)';
		sections.push(`${heading}\n${input.omittedFiles.map(formatSummary).join('\n')}`);
	}

	if (input.instructions.length > 0) {
		sections.push(
			`# CUSTOM INSTRUCTIONS\nFollow these instructions provided by the user when generating the commit message.\n${input.instructions
				.map((instruction) => `- ${instruction}`)
				.join('\n')}`,
		);
	}

	const subject = input.includedDiffs.length > 0 ? 'the CODE CHANGES above' : 'the CHANGED FILES above';
	sections.push(`# REMINDER\nNow generate the commit message describing ${subject}.\n${REMINDER_TAIL}`);

	return sections.join('\n\n');
};
