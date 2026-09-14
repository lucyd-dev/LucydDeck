import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Separate config from vite.config.ts: unit tests must not load the
// vite-plugin-electron plugin stack.
export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(dirname, "src"),
            "@shared": path.resolve(dirname, "shared"),
        },
    },
    test: {
        environment: "node",
        include: ["shared/**/*.test.ts", "electron/**/*.test.ts", "src/**/*.test.ts"],
    },
});
