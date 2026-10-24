import type { Component } from "vue";
import { Clock, Gamepad2, Keyboard, LayoutGrid, Mouse, Terminal, Type } from "@lucide/vue";
import type { StepCategory } from "@/editor/actionSteps";

/** Icon and label for a step category, shared by step rows and the picker. */
export const CATEGORY_ICONS: Record<StepCategory, Component> = {
    deck: LayoutGrid,
    keyboard: Keyboard,
    mouse: Mouse,
    text: Type,
    timing: Clock,
    commands: Terminal,
    plugins: Gamepad2,
};
