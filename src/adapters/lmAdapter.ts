import * as vscode from 'vscode';
import type { GenerationError } from '../core/errors';
import type { ModelCandidate } from '../core/models';
import { AUTO_MODEL_ID } from '../core/modelSelection';
import { err, ok, type Result } from '../core/result';

/** Vendor that provides the `auto` pseudo-model. */
const COPILOT_VENDOR = 'copilot';

/**
 * A language model together with the handle needed to actually call it.
 *
 * Why both: selection happens in the pure core, which only knows `ModelCandidate`, but
 * `sendRequest` needs the `LanguageModelChat` object itself. Looking the model up again by
 * id at send time would risk resolving to a different model — `auto` in particular picks a
 * different backend on each resolution — so the object chosen during selection is carried
 * through to the request.
 */
export interface ResolvedModel extends ModelCandidate {
	readonly chat: vscode.LanguageModelChat;
}

export interface LmPort {
	selectById(id: string): Promise<readonly ResolvedModel[]>;
	selectAuto(): Promise<readonly ResolvedModel[]>;
	countTokens(model: ResolvedModel, text: string): Promise<number>;
	send(
		model: ResolvedModel,
		prompt: string,
		token: vscode.CancellationToken,
	): Promise<Result<string, GenerationError>>;
}

const toResolved = (chat: vscode.LanguageModelChat): ResolvedModel => ({
	id: chat.id,
	vendor: chat.vendor,
	name: chat.name,
	maxInputTokens: chat.maxInputTokens,
	chat,
});

const toError = (
	error: unknown,
	token: vscode.CancellationToken,
): GenerationError => {
	if (token.isCancellationRequested || error instanceof vscode.CancellationError) {
		return { kind: 'cancelled' };
	}
	if (error instanceof vscode.LanguageModelError) {
		switch (error.code) {
			case 'NoPermissions':
				return { kind: 'model-access-denied' };
			case 'Blocked':
				return { kind: 'quota-exceeded' };
			case 'NotFound':
				return { kind: 'no-model-available' };
			default:
				break;
		}
	}
	return { kind: 'request-failed', detail: String(error) };
};

export const createLmPort = (): LmPort => ({
	/**
	 * The model list is queried afresh on every invocation rather than cached across them:
	 * `onDidChangeChatModels` fires as providers come and go, and the list empties entirely
	 * when the user signs out of Copilot.
	 */
	async selectById(id) {
		return (await vscode.lm.selectChatModels({ id })).map(toResolved);
	},

	async selectAuto() {
		return (
			await vscode.lm.selectChatModels({ vendor: COPILOT_VENDOR, id: AUTO_MODEL_ID })
		).map(toResolved);
	},

	countTokens: (model, text) => Promise.resolve(model.chat.countTokens(text)),

	async send(model, prompt, token) {
		try {
			const response = await model.chat.sendRequest(
				[vscode.LanguageModelChatMessage.User(prompt)],
				{ justification: 'Generate a commit message from the staged changes.' },
				token,
			);

			let text = '';
			for await (const chunk of response.text) {
				text += chunk;
			}
			return ok(text);
		} catch (error) {
			return err(toError(error, token));
		}
	},
});
