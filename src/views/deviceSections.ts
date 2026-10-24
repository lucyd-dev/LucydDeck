import { Info, RefreshCw, TableProperties } from "@lucide/vue";

export interface SectionItem {
    id: string;
    label: string;
    icon: unknown;
}

export const DEVICE_SECTIONS: SectionItem[] = [
    { id: "info", label: "Info", icon: Info },
    { id: "files", label: "Files", icon: TableProperties },
    { id: "review", label: "Review", icon: RefreshCw },
];

export const DEVICE_SECTION_IDS = DEVICE_SECTIONS.map((section) => section.id);
export const DEFAULT_DEVICE_SECTION = "info";
