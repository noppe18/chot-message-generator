import * as vscode from 'vscode';
import type { RawInstruction } from '../core/instructions';

/** VS Code setting read for custom instructions. Owned by the built-in Copilot extension. */
const INSTRUCTIONS_KEY = 'github.copilot.chat.commitMessageGeneration.instructions';

const MAX_RECENT_COMMITS = 50;
const DEFAULT_RECENT_COMMITS = 5;

export interface ConfigPort {
	getModelId(): string | undefined;
	getRecentCommitCount(): number;
	getInstructionScopes(): readonly (readonly RawInstruction[] | undefined)[];
	readInstructionFiles(paths: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export const createConfigPort = (): ConfigPort => ({
	getModelId() {
		const raw = vscode.workspace
			.getConfiguration('commitMessageGenerator')
			.get<string>('model', '')
			.trim();
		return raw === '' ? undefined : raw;
	},

	getRecentCommitCount() {
		const raw = vscode.workspace
			.getConfiguration('commitMessageGenerator')
			.get<number>('recentCommitCount', DEFAULT_RECENT_COMMITS);
		if (!Number.isFinite(raw)) {
			return DEFAULT_RECENT_COMMITS;
		}
		return Math.min(MAX_RECENT_COMMITS, Math.max(0, Math.floor(raw)));
	},

	/**
	 * Returns each configuration scope separately, narrowest first.
	 *
	 * Why not `get()`: the effective value is whichever single scope defines the key, so a
	 * workspace-level entry would silently discard the user's global rules. The built-in
	 * Copilot inspects the scopes and concatenates them, and matching that is what lets a
	 * user move between this extension and the built-in feature without touching settings.
	 */
	getInstructionScopes() {
		const inspected = vscode.workspace
			.getConfiguration()
			.inspect<RawInstruction[]>(INSTRUCTIONS_KEY);
		return [
			inspected?.workspaceFolderValue,
			inspected?.workspaceValue,
			inspected?.globalValue,
		];
	},

	/**
	 * Reads instruction files, resolving each path against every workspace folder.
	 *
	 * Paths are treated as workspace-folder-relative and nothing else — absolute paths and
	 * `~/` prefixes get no special handling. That is precisely what the built-in feature
	 * does, and widening it here would produce settings that only work while this extension
	 * is installed, which defeats the point of being a drop-in stand-in for it.
	 */
	async readInstructionFiles(paths) {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const contents = new Map<string, string>();

		await Promise.all(
			paths.map(async (path) => {
				for (const folder of folders) {
					try {
						const bytes = await vscode.workspace.fs.readFile(
							vscode.Uri.joinPath(folder.uri, path),
						);
						contents.set(path, new TextDecoder().decode(bytes));
						return;
					} catch {
						// Try the next folder. An unreadable instruction file is ignored rather
						// than failing the request, matching the built-in behaviour.
					}
				}
			}),
		);

		return contents;
	},
});
