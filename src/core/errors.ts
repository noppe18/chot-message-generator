/**
 * Every way generating a commit message can fail.
 *
 * Why a discriminated union: the UI layer switches exhaustively over `kind` to pick a
 * message. Adding a new failure mode here makes that switch fail to compile, so a new
 * error can never reach the user as a blank or generic notification.
 */
export type GenerationError =
	| { readonly kind: 'git-extension-unavailable' }
	| { readonly kind: 'no-repository' }
	/** The user dismissed the repository picker. Not an error worth a notification. */
	| { readonly kind: 'repository-not-selected' }
	| { readonly kind: 'no-staged-changes' }
	| { readonly kind: 'no-model-available'; readonly requestedId?: string }
	| { readonly kind: 'model-access-denied' }
	| { readonly kind: 'quota-exceeded' }
	| { readonly kind: 'request-failed'; readonly detail: string }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'empty-response' }
	| { readonly kind: 'diff-too-large' };
