import type * as vscode from 'vscode';
import type { ConfigPort } from '../adapters/configAdapter';
import type { GitPort, RepositoryHandle } from '../adapters/gitAdapter';
import { pickRepository } from '../adapters/gitAdapter';
import type { LmPort, ResolvedModel } from '../adapters/lmAdapter';
import type { Logger } from '../adapters/uiAdapter';
import { approxTokens, selectWithinBudget } from '../core/budget';
import { normalizeCommitMessages } from '../core/commitLog';
import type { GenerationError } from '../core/errors';
import { buildInstructionTexts, collectInstructionRefs } from '../core/instructions';
import type { PromptInput } from '../core/models';
import { resolveModel, type ModelResolution } from '../core/modelSelection';
import { extractCommitMessage } from '../core/parse';
import { buildPrompt } from '../core/prompt';
import { splitUnifiedDiff } from '../core/diffSplit';
import { err, ok, type Result } from '../core/result';

/**
 * Fraction of the model's input window this extension will fill.
 *
 * The 4-chars-per-token estimate is badly wrong for CJK text and minified files, so a fifth
 * of the window is held back to absorb the error. Only the final go/no-go check uses the
 * true limit — being over 80% is not by itself a reason to give up.
 */
const BUDGET_RATIO = 0.8;

/** How many times to shrink the budget and rebuild after a real token count comes back high. */
const MAX_BUDGET_RETRIES = 2;

export interface Deps {
	readonly git: GitPort;
	readonly lm: LmPort;
	readonly config: ConfigPort;
	readonly log: Logger;
	readonly pickRepository: (
		candidates: readonly RepositoryHandle[],
	) => Promise<RepositoryHandle | undefined>;
}

export interface Context {
	readonly commandArg: unknown;
	readonly activeEditorUri: vscode.Uri | undefined;
}

export interface GenerateOutcome {
	readonly message: string;
	readonly repository: RepositoryHandle;
	readonly resolution: ModelResolution<ResolvedModel>;
	readonly omittedCount: number;
}

const cancelled: GenerationError = { kind: 'cancelled' };

/**
 * Produces a commit message for the staged changes.
 *
 * Dependencies arrive as an argument rather than through a constructor or a container so
 * that tests can pass plain objects; nothing here needs a mocking framework.
 */
export const generateCommitMessage = async (
	deps: Deps,
	ctx: Context,
	token: vscode.CancellationToken,
): Promise<Result<GenerateOutcome, GenerationError>> => {
	const repositoryResult = await pickRepository(
		deps.git,
		ctx.commandArg,
		ctx.activeEditorUri,
		deps.pickRepository,
	);
	if (!repositoryResult.ok) {
		return repositoryResult;
	}
	const repository = repositoryResult.value;

	await repository.refresh();
	if (token.isCancellationRequested) {
		return err(cancelled);
	}

	if (!repository.hasStagedChanges()) {
		// Deliberately not falling back to the working tree the way the built-in feature
		// does: the message is about to be attached to a commit that will contain the index
		// and nothing else, so describing unstaged work would make the history wrong.
		return err({ kind: 'no-staged-changes' });
	}

	const rawDiff = await repository.getStagedDiff();
	const diffs = splitUnifiedDiff(rawDiff);

	const recentCommitCount = deps.config.getRecentCommitCount();
	const rawCommits = await repository.getRecentCommitMessages(recentCommitCount);

	const refs = collectInstructionRefs(deps.config.getInstructionScopes());
	const fileContents = await deps.config.readInstructionFiles(refs.files);
	const instructions = buildInstructionTexts(refs, fileContents);

	if (token.isCancellationRequested) {
		return err(cancelled);
	}

	const configuredId = deps.config.getModelId();
	const [byId, autoModels] = await Promise.all([
		configuredId !== undefined ? deps.lm.selectById(configuredId) : Promise.resolve([]),
		deps.lm.selectAuto(),
	]);

	const resolution = resolveModel(configuredId, byId, autoModels);
	if (resolution.kind === 'unavailable') {
		deps.log.error(
			`No language model available (requested: ${resolution.requestedId ?? '<unset>'}).`,
		);
		return err(
			resolution.requestedId !== undefined
				? { kind: 'no-model-available', requestedId: resolution.requestedId }
				: { kind: 'no-model-available' },
		);
	}
	const model = resolution.model;
	deps.log.info(
		`Model: ${model.name} (id=${model.id}, vendor=${model.vendor}, ` +
			`maxInputTokens=${model.maxInputTokens}) via ${resolution.kind}.`,
	);

	const promptBase: Omit<PromptInput, 'includedDiffs' | 'omittedFiles'> = {
		repositoryName: repository.name,
		branchName: repository.branchName,
		recentCommits: normalizeCommitMessages(rawCommits),
		instructions,
	};

	// The fixed part is everything except the diff bodies and the omitted list. The omitted
	// list does grow as files are demoted, but that growth is small next to the 20% headroom
	// and the retry loop below, so it is not worth a second estimate pass.
	const fixedPart = buildPrompt({ ...promptBase, includedDiffs: [], omittedFiles: [] });
	const softLimit = Math.floor(model.maxInputTokens * BUDGET_RATIO);
	let budgetTokens = softLimit - approxTokens(fixedPart);

	let prompt = '';
	let actualTokens = 0;
	let omittedCount = 0;

	for (let attempt = 0; attempt <= MAX_BUDGET_RETRIES; attempt += 1) {
		const outcome = selectWithinBudget(diffs, budgetTokens);
		prompt = buildPrompt({
			...promptBase,
			includedDiffs: outcome.included,
			omittedFiles: outcome.omitted,
		});
		omittedCount = outcome.omitted.length;

		actualTokens = await deps.lm.countTokens(model, prompt);
		deps.log.info(
			`Attempt ${attempt + 1}: ${diffs.length} changed file(s), ` +
				`${outcome.included.length} included, ${omittedCount} omitted, ` +
				`~${approxTokens(prompt)} estimated / ${actualTokens} actual tokens.`,
		);

		if (actualTokens <= softLimit) {
			break;
		}
		budgetTokens = Math.floor(budgetTokens * BUDGET_RATIO);
	}

	if (actualTokens > model.maxInputTokens) {
		// Reachable only when the fixed part alone overflows the window, since the budget
		// logic is willing to demote every diff body.
		deps.log.error(`Prompt is ${actualTokens} tokens, over the ${model.maxInputTokens} limit.`);
		return err({ kind: 'diff-too-large' });
	}

	if (token.isCancellationRequested) {
		return err(cancelled);
	}

	const response = await deps.lm.send(model, prompt, token);
	if (!response.ok) {
		return response;
	}

	const message = extractCommitMessage(response.value);
	if (message === '') {
        return err({ kind: 'empty-response' });
	}

	return ok({ message, repository, resolution, omittedCount });
};
