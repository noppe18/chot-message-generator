/**
 * A value that is either a success or a failure.
 *
 * Why not exceptions: the set of ways this extension can fail is small, known, and
 * every one of them needs a specific message shown to the user. Returning failures as
 * values lets the compiler check that the UI layer handles all of them. A thrown error
 * that a caller forgets to catch still type-checks, which is how silent-failure paths
 * get created.
 */
export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
