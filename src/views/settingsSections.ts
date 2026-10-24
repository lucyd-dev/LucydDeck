import { FolderOpen, Info, Palette } from "@lucide/vue";
import type { SectionItem } from "@/views/deviceSections";

export const SETTINGS_SECTIONS: SectionItem[] = [
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "data", label: "Data", icon: FolderOpen },
    { id: "about", label: "About", icon: Info },
];

export const SETTINGS_SECTION_IDS = SETTINGS_SECTIONS.map((section) => section.id);
export const DEFAULT_SETTINGS_SECTION = "appearance";
