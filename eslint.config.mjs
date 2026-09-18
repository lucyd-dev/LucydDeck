import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

export default tseslint.config(
    {
        ignores: ["dist/", "dist-electron/", "release/", "node_modules/", "*.bin", ".kilo/"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs["flat/recommended"],
    {
        files: ["**/*.{ts,tsx,vue,mjs,cjs}"],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    {
        files: ["**/*.vue"],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
            },
        },
        rules: {
            // Formatting is owned by Prettier (see .prettierrc.json); the
            // ESLint vue formatting rules stay off to avoid fighting it.
            "vue/max-attributes-per-line": "off",
            "vue/singleline-html-element-content-newline": "off",
            "vue/html-closing-bracket-newline": "off",
            "vue/html-indent": "off",
        },
    },
);
