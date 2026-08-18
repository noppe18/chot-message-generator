import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approxTokens, selectWithinBudget } from '../src/core/budget';
import type { FileDiff } from '../src/core/models';

const mk = (path: string, size: number): FileDiff => ({
	path,
	body: 'x'.repeat(size),
	insertions: 1,
	deletions: 2,
});

test('everything fits', () => {
	const diffs = [mk('a', 40), mk('b', 40)];
	const r = selectWithinBudget(diffs, 1000);
	assert.equal(r.included.length, 2);
	assert.deepEqual(r.omitted, []);
});

test('zero budget demotes everything', () => {
	const diffs = [mk('a', 40)];
	const r = selectWithinBudget(diffs, 0);
	assert.deepEqual(r.included, []);
	assert.equal(r.omitted.length, 1);
});

test('prefers smaller diffs when the budget is tight', () => {
	const diffs = [mk('big', 4000), mk('small', 40)];
	const r = selectWithinBudget(diffs, 20);
	assert.deepEqual(r.included.map((d) => d.path), ['small']);
});

test('demotes everything when not even the smallest fits', () => {
	const diffs = [mk('huge', 4000), mk('large', 8000)];
	const r = selectWithinBudget(diffs, 10);
	assert.deepEqual(r.included, []);
	assert.equal(r.omitted.length, 2);
});

test('a single oversized file is never force-included', () => {
	const r = selectWithinBudget([mk('lock', 400000)], 100);
	assert.deepEqual(r.included, []);
	assert.deepEqual(r.omitted.map((f) => f.path), ['lock']);
});

test('restores original order in both lists', () => {
	const diffs = [mk('z', 4000), mk('a', 40), mk('m', 400)];
	const r = selectWithinBudget(diffs, 120);
	assert.deepEqual(r.included.map((d) => d.path), ['a', 'm']);
	assert.deepEqual(r.omitted.map((f) => f.path), ['z']);
});

test('equal sizes break ties by path for stable selection', () => {
	const diffs = [mk('b', 40), mk('a', 40)];
	const r = selectWithinBudget(diffs, 10);
	assert.deepEqual(r.included.map((d) => d.path), ['a']);
});

test('summaries carry insertion and deletion counts', () => {
	const r = selectWithinBudget([mk('a', 4000)], 1);
	assert.deepEqual(r.omitted[0], { path: 'a', insertions: 1, deletions: 2 });
});

test('does not mutate the input array', () => {
	const diffs = [mk('z', 4000), mk('a', 40)];
	const before = diffs.map((d) => d.path);
	selectWithinBudget(diffs, 100);
	assert.deepEqual(diffs.map((d) => d.path), before);
});

test('approxTokens rounds up', () => {
	assert.equal(approxTokens(''), 0);
	assert.equal(approxTokens('abc'), 1);
	assert.equal(approxTokens('abcd'), 1);
	assert.equal(approxTokens('abcde'), 2);
});
