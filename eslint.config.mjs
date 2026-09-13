import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
	{
		ignores: ['dist/', 'dist-electron/', 'release/', 'node_modules/', '*.bin'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...pluginVue.configs['flat/recommended'],
	{
		files: ['**/*.{ts,tsx,vue,mjs,cjs}'],
		languageOptions: {
			ecmaVersion: 2020,
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	{
		files: ['**/*.vue'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser,
			},
		},
		rules: {
			// Stylistic formatting rules (no Prettier in this repo) relaxed for
			// the legacy prototype boilerplate; re-enable when UI lands in Step 1.
			'vue/max-attributes-per-line': 'off',
			'vue/singleline-html-element-content-newline': 'off',
			'vue/html-closing-bracket-newline': 'off',
			'vue/html-indent': 'off',
		},
	},
);
