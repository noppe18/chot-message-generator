#!/usr/bin/env node
/**
 * Blocks two classes of tampering that ordinary review and type-checking miss.
 *
 * Written with no dependencies on purpose. A guard that pulls packages from the registry
 * could be subverted by the very supply chain it is meant to police, and it would also have
 * to run before its own check. Everything here uses the Node standard library only, so the
 * whole thing is auditable in one sitting.
 *
 * Usage:  node scripts/supply-chain-guard.mjs
 * Exits non-zero on the first category that fails, printing every finding first.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Characters that alter how text renders without being visible themselves.
 *
 * These are the Trojan Source class of attack: bidirectional overrides let a reviewer see
 * `if (isAdmin)` where the compiler sees the negation, and zero-width characters hide
 * identifiers that differ from the ones on screen. Neither shows up in a diff.
 */
const INVISIBLE = new Map([
	[0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
	[0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
	[0x202c, 'POP DIRECTIONAL FORMATTING'],
	[0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
	[0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
	[0x2066, 'LEFT-TO-RIGHT ISOLATE'],
	[0x2067, 'RIGHT-TO-LEFT ISOLATE'],
	[0x2068, 'FIRST STRONG ISOLATE'],
	[0x2069, 'POP DIRECTIONAL ISOLATE'],
	[0x200e, 'LEFT-TO-RIGHT MARK'],
	[0x200f, 'RIGHT-TO-LEFT MARK'],
	[0x200b, 'ZERO WIDTH SPACE'],
	[0x200c, 'ZERO WIDTH NON-JOINER'],
	[0x200d, 'ZERO WIDTH JOINER'],
	[0x2060, 'WORD JOINER'],
	[0x00ad, 'SOFT HYPHEN'],
	[0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
	[0xfeff, 'ZERO WIDTH NO-BREAK SPACE (BOM)'],
]);

/** Cyrillic and Greek ranges, used for homoglyph detection. */
const CONFUSABLE_RANGES = [
	[0x0370, 0x03ff, 'Greek'],
	[0x0400, 0x04ff, 'Cyrillic'],
];

/**
 * Where a homoglyph would actually be dangerous.
 *
 * Japanese prose in `docs/` is expected and CJK is never confusable with ASCII, so the
 * scan for lookalike letters is limited to files that execute or that declare identity.
 * Applying it to prose would produce noise that trains people to skip the check.
 */
const CONFUSABLE_SCOPE = /^(src\/|test\/|scripts\/|\.github\/|package\.json$|package-lock\.json$)/;

/** The only place packages may come from. */
const ALLOWED_REGISTRY = 'https://registry.npmjs.org/';

const listTrackedFiles = () =>
	execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const readTextOrNull = (path) => {
	try {
		const buf = readFileSync(path);
		// A NUL byte means binary; those carry no source for a reviewer to be misled by.
		return buf.includes(0) ? null : buf.toString('utf8');
	} catch {
		return null;
	}
};

const positionOf = (text, index) => {
	const before = text.slice(0, index);
	const line = before.split('\n').length;
	return { line, column: index - before.lastIndexOf('\n') };
};

const scanCharacters = (files) => {
	const findings = [];

	for (const file of files) {
		const text = readTextOrNull(file);
		if (text === null) {
			continue;
		}
		const checkConfusable = CONFUSABLE_SCOPE.test(file);

		for (let i = 0; i < text.length; i += 1) {
			const cp = text.codePointAt(i);

			const invisible = INVISIBLE.get(cp);
			if (invisible !== undefined) {
				const { line, column } = positionOf(text, i);
				findings.push(`${file}:${line}:${column}  U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${invisible}`);
				continue;
			}

			if (checkConfusable) {
				const range = CONFUSABLE_RANGES.find(([lo, hi]) => cp >= lo && cp <= hi);
				if (range) {
					const { line, column } = positionOf(text, i);
					findings.push(
						`${file}:${line}:${column}  U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${range[2]} letter in executable/manifest path`,
					);
				}
			}
		}
	}

	return findings;
};

/**
 * Verifies every resolved package comes from the public npm registry over TLS and carries
 * an integrity hash.
 *
 * `npm ci` already refuses a lockfile that disagrees with `package.json`, but it will
 * happily install from a git URL, a tarball on someone's server, or a private registry if
 * the lockfile says so. Those are the shapes an attacker needs, and none of them look
 * unusual in a 600-line lockfile diff.
 */
const scanLockfile = () => {
	const findings = [];
	const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
	const packages = lock.packages ?? {};

	for (const [path, pkg] of Object.entries(packages)) {
		// The root entry and workspace links have no resolved URL by design.
		if (path === '' || pkg.link === true) {
			continue;
		}
		const { resolved, integrity } = pkg;

		if (resolved === undefined) {
			findings.push(`${path}  has no "resolved" URL`);
			continue;
		}
		if (!resolved.startsWith(ALLOWED_REGISTRY)) {
			findings.push(`${path}  resolves outside the npm registry: ${resolved}`);
		}
		if (integrity === undefined) {
			findings.push(`${path}  has no "integrity" hash`);
		}
	}

	return findings;
};

/** Rejects dependency specs that bypass the registry, e.g. `git+https://…` or `file:../x`. */
const scanManifest = () => {
	const findings = [];
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	const suspect = /^(git\+|git:|https?:|file:|link:|portal:)/;

	for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
			if (typeof spec === 'string' && suspect.test(spec)) {
				findings.push(`package.json ${field}.${name}  non-registry spec: ${spec}`);
			}
		}
	}

	return findings;
};

const report = (title, findings, hint) => {
	if (findings.length === 0) {
		console.log(`  ok    ${title}`);
		return 0;
	}
	console.log(`  FAIL  ${title}`);
	for (const finding of findings) {
		console.log(`          ${finding}`);
	}
	console.log(`        ${hint}`);
	return 1;
};

const main = () => {
	const files = listTrackedFiles();
	console.log(`supply-chain guard  (${files.length} tracked files)\n`);

	let failed = 0;
	failed += report(
		'no invisible or lookalike characters',
		scanCharacters(files),
		'These render differently than they compile. Remove them, or narrow the scope in scripts/supply-chain-guard.mjs if a use is genuinely intended.',
	);
	failed += report(
		'every package resolves to the npm registry with an integrity hash',
		scanLockfile(),
		'Regenerate the lockfile with `npm install` against the public registry.',
	);
	failed += report(
		'no non-registry dependency specs',
		scanManifest(),
		'Depend on published versions rather than git URLs or local paths.',
	);

	if (failed > 0) {
		console.log(`\n${failed} check(s) failed.`);
		process.exit(1);
	}
	console.log('\nAll checks passed.');
};

main();
