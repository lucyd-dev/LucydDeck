export interface ProfileMeta {
    name: string;
    /** True when this profile is the persistent boot default. */
    isDefault?: boolean;
}

export interface PageMeta {
    id: string;
    /** File mtime (ms) for external-edit detection; optional on the wire. */
    mtimeMs?: number;
}

export interface ButtonConfig {
    imageName?: string;
    backgroundColor?: string;
    label?: string;
    click: string[];
}

export interface PageConfig {
    buttons: Record<string, ButtonConfig>;
}
