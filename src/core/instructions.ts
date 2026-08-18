/** An entry of `github.copilot.chat.commitMessageGeneration.instructions`. */
export type RawInstruction = { readonly text: string } | { readonly file: string };

export interface InstructionRefs {
	/** Deduplicated file paths, in the order they appear in settings. */
	readonly files: readonly string[];
	/** Deduplicated inline texts, in the order they appear in settings. */
	readonly texts: readonly string[];
}

const hasText = (entry: unknown): entry is { text: string } =>
	typeof (entry as { text?: unknown } | null)?.text === 'string';

const hasFile = (entry: unknown): entry is { file: string } =>
	typeof (entry as { file?: unknown } | null)?.file === 'string';

/**
 * Collects instruction references from every configuration scope.
 *
 * Why all scopes rather than the effective value: `getConfiguration().get()` returns only
 * the narrowest scope that defines the key, so a workspace-level entry would silently
 * erase the user's global rules. The built-in Copilot reads the scopes separately and
 * concatenates them, which supports the natural "shared rules in user settings,
 * project-specific rules in the workspace" split. Matching that behaviour is what lets a
 * user switch between this extension and the built-in feature without editing settings.
 *
 * @param scopes Settings values ordered workspaceFolder → workspace → global.
 *               Pass `undefined` for scopes that do not define the key.
 */
export const collectInstructionRefs = (
	scopes: readonly (readonly RawInstruction[] | undefined)[],
): InstructionRefs => {
	const files: string[] = [];
	const texts: string[] = [];
	const seenFiles = new Set<string>();
	const seenTexts = new Set<string>();

	for (const scope of scopes) {
		if (!Array.isArray(scope)) {
			continue;
		}
		for (const entry of scope) {
			if (hasFile(entry) && !seenFiles.has(entry.file)) {
				seenFiles.add(entry.file);
				files.push(entry.file);
			} else if (hasText(entry) && !seenTexts.has(entry.text)) {
				seenTexts.add(entry.text);
				texts.push(entry.text);
			}
		}
	}

	return { files, texts };
};

/**
 * Merges inline texts and the contents of instruction files into the final instruction list.
 *
 * @param fileContents Contents of {@link InstructionRefs.files}. Files that could not be
 *                     read are simply absent, mirroring the built-in behaviour of ignoring
 *                     unreadable instruction files rather than failing the whole request.
 */
export const buildInstructionTexts = (
	refs: InstructionRefs,
	fileContents: ReadonlyMap<string, string>,
): readonly string[] => {
	const fromFiles = refs.files
		.map((path) => fileContents.get(path))
		.filter((content): content is string => content !== undefined);

	return [...refs.texts, ...fromFiles].map((s) => s.trim()).filter((s) => s.length > 0);
};
