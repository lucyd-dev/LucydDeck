<script setup lang="ts">
import { useProfileStore } from "@/stores/profileStore";
import { BOARD_COLS, BOARD_ROWS, BOARD_SIZE } from "@shared/schema";
import KeyButton from "./KeyButton.vue";

const profile = useProfileStore();
</script>

<template>
    <div
        class="board-canvas"
        :style="{
            '--board-cols': String(BOARD_COLS),
            '--board-rows': String(BOARD_ROWS),
        }"
    >
        <KeyButton
            v-for="position in BOARD_SIZE"
            :key="position - 1"
            :index="position - 1"
            :button="profile.currentPage.buttons[String(position - 1)]"
            :selected="profile.selectedKey === String(position - 1)"
            :multi-selected="profile.isMultiSelect && profile.isKeySelected(String(position - 1))"
            @select="profile.selectKey"
        />
    </div>
</template>
