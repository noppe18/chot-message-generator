import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveModel } from '../src/core/modelSelection';

const m = (id: string) => ({ id });

test('uses the configured model when found', () => {
	const r = resolveModel('gpt-5.1', [m('gpt-5.1')], [m('auto')]);
	assert.equal(r.kind, 'configured');
	assert.equal(r.kind === 'configured' && r.model.id, 'gpt-5.1');
});

test('falls back to auto and reports the missed id', () => {
	const r = resolveModel('nope', [], [m('auto')]);
	assert.equal(r.kind, 'fallback-auto');
	assert.equal(r.kind === 'fallback-auto' && r.requestedId, 'nope');
});

test('unset configuration falls back to auto without a requestedId', () => {
	const r = resolveModel(undefined, [], [m('auto')]);
	assert.equal(r.kind, 'fallback-auto');
	assert.equal(r.kind === 'fallback-auto' && r.requestedId, undefined);
});

test('empty string counts as unset', () => {
	const r = resolveModel('', [], [m('auto')]);
	assert.equal(r.kind === 'fallback-auto' && r.requestedId, undefined);
});

test('unavailable when neither the configured model nor auto exists', () => {
	const r = resolveModel('x', [], []);
	assert.equal(r.kind, 'unavailable');
	assert.equal(r.kind === 'unavailable' && r.requestedId, 'x');
});

test('takes the first candidate when several match', () => {
	const r = resolveModel('dup', [m('dup'), m('dup')], []);
	assert.equal(r.kind, 'configured');
});

test('carries extra fields of the handle through', () => {
	const handle = { id: 'auto', extra: 42 };
	const r = resolveModel(undefined, [], [handle]);
	assert.equal(r.kind === 'fallback-auto' && r.model.extra, 42);
});
