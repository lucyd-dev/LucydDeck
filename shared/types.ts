export interface ProfileMeta {
    name: string;
}

export interface PageMeta {
    id: string;
}

export interface ButtonConfig {
    imageName?: string;
    backgroundColor?: string;
    label?: string;
    click: string[];
    longPress: string[];
}

export interface PageConfig {
    buttons: Record<string, ButtonConfig>;
}
