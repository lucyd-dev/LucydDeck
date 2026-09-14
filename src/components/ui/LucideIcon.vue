<script setup lang="ts">
import { computed } from "vue";
import iconSettings from "lucide-static/icons/settings.svg?raw";
import iconBlocks from "lucide-static/icons/blocks.svg?raw";
import iconSave from "lucide-static/icons/save.svg?raw";
import iconPlug from "lucide-static/icons/plug.svg?raw";
import iconChevronDown from "lucide-static/icons/chevron-down.svg?raw";
import iconZap from "lucide-static/icons/zap.svg?raw";
import iconHardDrive from "lucide-static/icons/hard-drive.svg?raw";
import iconX from "lucide-static/icons/x.svg?raw";

const icons: Record<string, string> = {
    settings: iconSettings,
    blocks: iconBlocks,
    save: iconSave,
    plug: iconPlug,
    "chevron-down": iconChevronDown,
    zap: iconZap,
    "hard-drive": iconHardDrive,
    x: iconX,
};

const props = defineProps<{
    name: string;
    size?: number;
}>();

const svg = computed(() => icons[props.name] ?? "");
const sizeStyle = computed(() =>
    props.size ? `width: ${props.size}px; height: ${props.size}px;` : "",
);
</script>

<template>
    <!-- eslint-disable vue/no-v-html -- bundled static lucide SVG, never user input -->
    <span class="lucide-icon" role="img" aria-hidden="true" :style="sizeStyle" v-html="svg" />
    <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped lang="scss">
.lucide-icon {
    display: inline-block;
    line-height: 0;

    svg {
        width: 1.2em;
        height: 1.2em;
        color: currentColor;
        fill: none;
        stroke: currentColor;
        display: block;
    }
}
</style>
