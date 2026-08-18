/** Matches a whole-string ```text fence, which is the format the prompt asks for. */
const TEXT_FENCE = /^```text[ \t]*\n([\s\S]*?)\n?```[ \t]*$/m;

/**
 * Matches a whole-string fence with any (or no) language tag.
 *
 * Why this fallback exists: models regularly ignore the "```text" instruction and emit a
 * bare ``` fence, or tag it `markdown` / `git` / `diff`. Without this, the fence markers
 * themselves would be committed as part of the message.
 */
const ANY_FENCE = /^```[a-zA-Z0-9_+-]*[ \t]*\n([\s\S]*?)\n?```[ \t]*$/;

/** Three or more consecutive newlines, i.e. two or more blank lines. */
const EXCESS_BLANK_LINES = /\n{3,}/g;

/**
 * Extracts the commit message from a raw model response.
 *
 * Falls back to the whole response when no fence is found, matching the built-in Copilot
 * behaviour: a response in the wrong shape is still more useful to the user than nothing.
 *
 * @returns The message, trimmed. Empty when the model returned nothing usable — callers
 *          should treat that as `empty-response` rather than writing it to the input box.
 */
export const extractCommitMessage = (raw: string): string => {
	const normalized = raw.replace(/\r\n/g, '\n');

	const fenced = TEXT_FENCE.exec(normalized) ?? ANY_FENCE.exec(normalized.trim());
	const body = fenced?.[1] ?? normalized;

	return body.trim().replace(EXCESS_BLANK_LINES, '\n\n');
};
