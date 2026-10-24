<template>
    <div class="deck-sidebar">
        <p class="sidebar__section-title">Plugins</p>
        <nav class="sidebar__nav" aria-label="Plugin sections">
            <RouterLink
                class="sidebar__nav-item sidebar__nav-item--active"
                :to="{ name: 'plugins' }"
            >
                <span>Installed</span>
                <span class="sidebar__nav-count">0</span>
            </RouterLink>
        </nav>
        <p class="sidebar__hint">
            Plugin installation, worker isolation and published state arrive in a later step.
        </p>
    </div>
</template>
