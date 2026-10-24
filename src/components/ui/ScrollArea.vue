<template>
    <div class="ui-scroll-area" tabindex="0">
        <slot />
    </div>
</template>

<style scoped>
.ui-scroll-area {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.ui-scroll-area:focus-visible {
    outline-offset: -2px;
}
</style>
