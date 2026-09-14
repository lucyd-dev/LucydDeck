import { dialog } from "electron";
import type { StorageDialogs } from "../services/StorageService";

/**
 * Electron-backed dialog handles for StorageService export/import flows.
 * Kept out of the service so the storage layer stays unit-testable.
 */
export function createStorageDialogs(): StorageDialogs {
    return {
        async pickExportDirectory(defaultName: string) {
            const result = await dialog.showSaveDialog({
                title: "Export profile",
                defaultPath: defaultName,
                filters: [{ name: "LucydDeck profile", extensions: ["*"] }],
                properties: ["createDirectory", "showOverwriteConfirmation"],
            });
            return result.canceled || result.filePath === "" ? null : result.filePath;
        },
    };
}
