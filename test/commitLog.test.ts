import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCommitMessage, normalizeCommitMessages } from '../src/core/commitLog';

test('subject-only message has no body lines', () => {
	const c = normalizeCommitMessage('feat: add X');
	assert.equal(c.subject, 'feat: add X');
	assert.deepEqual(c.bodyLines, []);
});

test('keeps subject and body', () => {
	const c = normalizeCommitMessage('feat: add X\n\nBecause Y.');
	assert.equal(c.subject, 'feat: add X');
	assert.deepEqual(c.bodyLines, ['Because Y.']);
});

test('strips Co-authored-by from the body', () => {
	const c = normalizeCommitMessage('feat: add X\n\nBody.\n\nCo-authored-by: A <a@example.com>');
	assert.deepEqual(c.bodyLines, ['Body.']);
});

test('strips other trailers regardless of case', () => {
	const raw = 'feat: add X\n\nBody.\nsigned-off-by: A\nREFS: #12\nCloses: #3\nFixes: #4';
	assert.deepEqual(normalizeCommitMessage(raw).bodyLines, ['Body.']);
});

test('never strips the subject even when it looks like a trailer', () => {
	// `Fixes: ...` as a subject is metadata-shaped but is still the subject line.
	assert.equal(normalizeCommitMessage('Fixes: broken build').subject, 'Fixes: broken build');
	// A Conventional Commits subject must survive too.
	assert.equal(normalizeCommitMessage('fix: broken build').subject, 'fix: broken build');
});

test('truncates to maxLines including the subject', () => {
	const raw = ['s', ...Array.from({ length: 14 }, (_, i) => `line ${i}`)].join('\n');
	const c = normalizeCommitMessage(raw, 10);
	assert.equal(c.bodyLines.length, 9);
});

test('collapses consecutive blank lines in the body', () => {
	const c = normalizeCommitMessage('s\n\na\n\n\n\nb');
	assert.deepEqual(c.bodyLines, ['a', '', 'b']);
});

test('drops leading and trailing blank lines from the body', () => {
	const c = normalizeCommitMessage('s\n\n\na\n\n\n');
	assert.deepEqual(c.bodyLines, ['a']);
});

test('empty input yields empty subject and body', () => {
	const c = normalizeCommitMessage('');
	assert.equal(c.subject, '');
	assert.deepEqual(c.bodyLines, []);
});

test('normalizeCommitMessages maps over the list', () => {
	assert.equal(normalizeCommitMessages(['a', 'b']).length, 2);
});
