import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCommitMessage } from '../src/core/parse';

test('extracts a ```text fenced message', () => {
	assert.equal(extractCommitMessage('```text\nfeat: add X\n```'), 'feat: add X');
});

test('extracts the block when surrounded by prose', () => {
	const raw = 'Here you go:\n\n```text\nfix: correct the off-by-one\n```\n\nHope that helps!';
	assert.equal(extractCommitMessage(raw), 'fix: correct the off-by-one');
});

test('falls back to an untagged fence', () => {
	assert.equal(extractCommitMessage('```\nfeat: add X\n```'), 'feat: add X');
});

test('falls back to a differently tagged fence', () => {
	assert.equal(extractCommitMessage('```markdown\nfeat: add X\n```'), 'feat: add X');
});

test('returns bare text untouched apart from trimming', () => {
	assert.equal(extractCommitMessage('  feat: add X  \n'), 'feat: add X');
});

test('preserves subject, blank line and body', () => {
	const raw = '```text\nfeat: add X\n\nThis explains why.\n```';
	assert.equal(extractCommitMessage(raw), 'feat: add X\n\nThis explains why.');
});

test('collapses three or more consecutive newlines to one blank line', () => {
	assert.equal(extractCommitMessage('feat: add X\n\n\n\nbody'), 'feat: add X\n\nbody');
});

test('normalizes CRLF', () => {
	assert.equal(extractCommitMessage('```text\r\nfeat: add X\r\n```'), 'feat: add X');
});

test('returns empty string for blank input', () => {
	assert.equal(extractCommitMessage('   \n  \n'), '');
	assert.equal(extractCommitMessage(''), '');
});
