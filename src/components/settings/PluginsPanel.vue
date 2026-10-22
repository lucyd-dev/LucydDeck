<script setup lang="ts">
import { Plug } from "@lucide/vue";
</script>

<template>
    <div class="plugins-panel">
        <p class="settings-panel__hint">
            Install, configure, and enable sandboxed plugins. The plugin runtime ships in Step 4.
        </p>
        <div class="plugins-panel__empty">
            <Plug :size="20" />
            <span>No plugins installed.</span>
        </div>
    </div>
</template>
