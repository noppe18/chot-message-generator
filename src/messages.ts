import type { GenerationError } from './core/errors';

/** How a failure should surface to the user. */
export type Severity = 'error' | 'warning' | 'silent';

export interface UserFacingMessage {
	readonly severity: Severity;
	readonly text: string;
}

/**
 * Maps every failure to what the user sees.
 *
 * Why a total record rather than a switch with a default: adding a case to
 * {@link GenerationError} without deciding how to explain it becomes a compile error here,
 * so a new failure mode can never reach the user as a blank or generic notification.
 *
 * `silent` entries are outcomes the user caused deliberately (cancelling the progress
 * notification, dismissing the repository picker). Telling someone what they just chose is
 * noise, so those are only written to the log.
 */
export const ERROR_MESSAGES: Record<GenerationError['kind'], UserFacingMessage> = {
	'git-extension-unavailable': {
		severity: 'error',
		text: 'The built-in Git extension is not available. Enable it and try again.',
	},
	'no-repository': {
		severity: 'warning',
		text: 'No Git repository found in this workspace.',
	},
	'repository-not-selected': {
		severity: 'silent',
		text: 'Repository selection was dismissed.',
	},
	'no-staged-changes': {
		severity: 'warning',
		text: 'No staged changes to describe. Stage the changes you want to commit and try again.',
	},
	'no-model-available': {
		severity: 'error',
		text: 'No language model is available. Sign in to GitHub Copilot, or configure a language model provider.',
	},
	'model-access-denied': {
		severity: 'error',
		text: 'Access to the language model was denied. Grant permission and try again.',
	},
	'quota-exceeded': {
		severity: 'error',
		text: 'The language model quota has been exceeded. Try again later.',
	},
	'request-failed': {
		severity: 'error',
		text: 'Failed to generate a commit message. See the output for details.',
	},
	cancelled: {
		severity: 'silent',
		text: 'Generation was cancelled.',
	},
	'empty-response': {
		severity: 'error',
		text: 'The language model returned an empty response.',
	},
	'diff-too-large': {
		severity: 'error',
		text: 'The staged changes are too large for the selected model, even after truncation.',
	},
};

export const MESSAGES = {
	progressTitle: 'Generating commit message…',
	showDetails: 'Show Details',
	modelFallback: (requestedId: string): string =>
		`Model "${requestedId}" is not available. Used "auto" instead.`,
	pickRepositoryPlaceholder: 'Select the repository to generate a commit message for',
	outputChannelName: 'Chot Message Generator',
} as const;
