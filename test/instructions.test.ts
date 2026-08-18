import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInstructionTexts, collectInstructionRefs } from '../src/core/instructions';
import type { RawInstruction } from '../src/core/instructions';

test('concatenates workspaceFolder, workspace then global', () => {
	const refs = collectInstructionRefs([
		[{ text: 'folder' }],
		[{ text: 'workspace' }],
		[{ text: 'global' }],
	]);
	assert.deepEqual(refs.texts, ['folder', 'workspace', 'global']);
});

test('skips undefined scopes', () => {
	const refs = collectInstructionRefs([undefined, [{ text: 'w' }], undefined]);
	assert.deepEqual(refs.texts, ['w']);
});

test('all scopes undefined yields nothing', () => {
	const refs = collectInstructionRefs([undefined, undefined, undefined]);
	assert.deepEqual(refs.texts, []);
	assert.deepEqual(refs.files, []);
});

test('deduplicates repeated files', () => {
	const refs = collectInstructionRefs([[{ file: 'a.md' }], [{ file: 'a.md' }]]);
	assert.deepEqual(refs.files, ['a.md']);
});

test('deduplicates repeated texts', () => {
	const refs = collectInstructionRefs([[{ text: 'same' }], [{ text: 'same' }]]);
	assert.deepEqual(refs.texts, ['same']);
});

test('texts come before file contents in the merged output', () => {
	const refs = collectInstructionRefs([[{ file: 'a.md' }, { text: 'inline' }]]);
	const merged = buildInstructionTexts(refs, new Map([['a.md', 'from file']]));
	assert.deepEqual(merged, ['inline', 'from file']);
});

test('ignores non-array scope values', () => {
	const refs = collectInstructionRefs(['oops' as unknown as RawInstruction[]]);
	assert.deepEqual(refs.texts, []);
});

test('ignores entries with neither text nor file', () => {
	const refs = collectInstructionRefs([[{ nope: 1 } as unknown as RawInstruction]]);
	assert.deepEqual(refs.texts, []);
	assert.deepEqual(refs.files, []);
});

test('files that could not be read are dropped', () => {
	const refs = collectInstructionRefs([[{ file: 'missing.md' }]]);
	assert.deepEqual(buildInstructionTexts(refs, new Map()), []);
});

test('blank entries are removed from the merged output', () => {
	const refs = collectInstructionRefs([[{ text: '   ' }, { file: 'blank.md' }]]);
	assert.deepEqual(buildInstructionTexts(refs, new Map([['blank.md', '\n\n']])), []);
});

test('absolute and ~/ paths get no special treatment', () => {
	// Native Copilot resolves commit-message instruction files relative to workspace folders
	// only. Treating these as ordinary path strings is what keeps settings portable between
	// this extension and the built-in feature.
	const refs = collectInstructionRefs([[{ file: '/etc/x.md' }, { file: '~/y.md' }]]);
	assert.deepEqual(refs.files, ['/etc/x.md', '~/y.md']);
	assert.deepEqual(buildInstructionTexts(refs, new Map()), []);
});
