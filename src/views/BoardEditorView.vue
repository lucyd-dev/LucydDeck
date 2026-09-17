<script setup lang="ts">
import { useProfileStore } from "@/stores/profileStore";

const profile = useProfileStore();
</script>

<template>
    <section class="view view--board">
        <h1 class="view__title">Board</h1>
        <p class="view__hint">
            Board editing (3×5 grid, action inspector, delta sync) ships in Step 3.
        </p>
        <p v-if="profile.hasProfile" class="view__context">
            Active profile: <strong>{{ profile.activeProfile }}</strong>
        </p>
        <p v-else class="view__context">No profile selected.</p>
    </section>
</template>
