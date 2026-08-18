/** The pseudo-model Copilot exposes for automatic model selection. */
export const AUTO_MODEL_ID = 'auto';

export type ModelResolution<T> =
	| { readonly kind: 'configured'; readonly model: T }
	| { readonly kind: 'fallback-auto'; readonly model: T; readonly requestedId?: string }
	| { readonly kind: 'unavailable'; readonly requestedId?: string };

/**
 * Picks the model to use.
 *
 * Only exact `id` matches count. Falling back to a `family` match would make the same
 * setting resolve to different models depending on which providers are installed, and
 * would also match the alias entries Copilot registers (whose `family` is the alias name).
 * A setting that quietly means different things in different environments is worse than
 * one that visibly falls back to `auto`, which is why a missed match is reported to the
 * caller through `requestedId` rather than being swallowed.
 *
 * Generic over `T` so the adapter can pass its own model handles straight through and get
 * the selected one back — the core never needs to know what else is attached to them.
 *
 * @param configuredId Value of `commitMessageGenerator.model`. Empty means unset.
 * @param byId         Models matching `configuredId`. Empty when unset or not found.
 * @param autoModels   Models matching the `auto` pseudo-model.
 */
export const resolveModel = <T extends { readonly id: string }>(
	configuredId: string | undefined,
	byId: readonly T[],
	autoModels: readonly T[],
): ModelResolution<T> => {
	const requestedId = configuredId !== undefined && configuredId !== '' ? configuredId : undefined;

	const configured = requestedId !== undefined ? byId[0] : undefined;
	if (configured) {
		return { kind: 'configured', model: configured };
	}

	const auto = autoModels[0];
	if (auto) {
		return requestedId !== undefined
			? { kind: 'fallback-auto', model: auto, requestedId }
			: { kind: 'fallback-auto', model: auto };
	}

	return requestedId !== undefined ? { kind: 'unavailable', requestedId } : { kind: 'unavailable' };
};
