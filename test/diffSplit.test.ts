import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitUnifiedDiff } from '../src/core/diffSplit';

const modified = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old line
+new line
 context`;

test('single file diff yields one entry with the right path', () => {
	const r = splitUnifiedDiff(modified);
	assert.equal(r.length, 1);
	assert.equal(r[0]!.path, 'src/a.ts');
});

test('preserves input order across multiple files', () => {
	const raw = ['z.ts', 'a.ts', 'm.ts']
		.map((p) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n+x`)
		.join('\n');
	assert.deepEqual(
		splitUnifiedDiff(raw).map((d) => d.path),
		['z.ts', 'a.ts', 'm.ts'],
	);
});

test('new file takes the path from the +++ line', () => {
	const raw = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
+content`;
	assert.equal(splitUnifiedDiff(raw)[0]!.path, 'new.ts');
});

test('deleted file takes the path from the --- line', () => {
	const raw = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
-content`;
	assert.equal(splitUnifiedDiff(raw)[0]!.path, 'gone.ts');
});

test('rename uses the post-rename path', () => {
	const raw = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
+x`;
	assert.equal(splitUnifiedDiff(raw)[0]!.path, 'new.ts');
});

test('unquotes paths containing spaces', () => {
	const raw = `diff --git "a/my file.ts" "b/my file.ts"
--- "a/my file.ts"
+++ "b/my file.ts"
+x`;
	assert.equal(splitUnifiedDiff(raw)[0]!.path, 'my file.ts');
});

test('does not count +++ and --- as changed lines', () => {
	const r = splitUnifiedDiff(modified)[0]!;
	assert.equal(r.insertions, 1);
	assert.equal(r.deletions, 1);
});

test('input without diff headers yields nothing', () => {
	assert.deepEqual(splitUnifiedDiff('not a diff at all'), []);
	assert.deepEqual(splitUnifiedDiff(''), []);
});

test('discards preamble before the first header', () => {
	assert.equal(splitUnifiedDiff(`warning: something\n${modified}`).length, 1);
});

test('handles CRLF input', () => {
	assert.equal(splitUnifiedDiff(modified.replace(/\n/g, '\r\n'))[0]!.path, 'src/a.ts');
});

test('binary file diff still yields one entry', () => {
	const raw = `diff --git a/logo.png b/logo.png
index 111..222 100644
Binary files a/logo.png and b/logo.png differ`;
	const r = splitUnifiedDiff(raw);
	assert.equal(r.length, 1);
	assert.equal(r[0]!.path, 'logo.png');
});
