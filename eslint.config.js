// ESLint 9 flat config. The legacy .eslintrc.json format is no longer read.
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
	{ ignores: ['out/**', 'dist/**', 'node_modules/**', 'src/types/git.d.ts'] },
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: __dirname },
		},
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error',
		},
	},
	{
		// The architectural invariant of this codebase: src/core holds pure functions over
		// readonly data and must stay independent of the editor. Enforcing it here rather
		// than in review is what keeps the test suite runnable under plain Node, with no
		// VS Code instance and no mocking framework.
		files: ['src/core/**/*.ts'],
		rules: {
			'no-param-reassign': ['error', { props: true }],
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'vscode',
							message:
								'src/core must not depend on the editor. Put editor access in src/adapters and pass plain data in.',
						},
					],
					patterns: [
						{
							group: ['../adapters/*', '../usecase/*'],
							message: 'src/core must not depend on outer layers.',
						},
					],
				},
			],
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			// Tests deliberately construct malformed inputs to prove they are ignored.
			'@typescript-eslint/no-unsafe-assignment': 'off',
			// `node:test`'s test() returns a promise that the runner owns; calling it without
			// awaiting is the documented usage, not a forgotten await.
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
);
