import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "vite-plugin-electron/simple";
import vue from "@vitejs/plugin-vue";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
    "@": path.resolve(dirname, "src"),
    "@shared": path.resolve(dirname, "shared"),
};

// https://vitejs.dev/config/
export default defineConfig({
    resolve: {
        alias,
    },
    plugins: [
        vue(),
        electron({
            main: {
                // Two entries: the app and the worker runtime that
                // `utilityProcess.fork` launches for each plugin.
                entry: {
                    main: "electron/main.ts",
                    runtime: "electron/main/plugins/runtime.ts",
                },
                // Add Vite options for the main process build.
                vite: {
                    resolve: {
                        alias,
                    },
                    build: {
                        rolldownOptions: {
                            external: ["node-hid", "sharp", "serialport"],
                        },
                    },
                },
            },
            preload: {
                // Shortcut of `build.rolldownOptions.input`.
                // Preload scripts may contain Web assets, so use the build input option instead of `build.lib.entry`.
                input: path.join(dirname, "electron/preload.ts"),
                vite: {
                    resolve: {
                        alias,
                    },
                },
            },
        }),
    ],
});
