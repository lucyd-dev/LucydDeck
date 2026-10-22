<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Crop, Upload, X } from "@lucide/vue";
import { useAppStore } from "@/stores/appStore";
import { useIconStore } from "@/stores/iconStore";

const emit = defineEmits<{
    (event: "imported", name: string): void;
    (event: "close"): void;
}>();

const app = useAppStore();
const icons = useIconStore();

/** Display canvas is square; output is the device icon size. */
const CANVAS_SIZE = 280;
const OUTPUT_SIZE = 140;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

const fileInput = ref<HTMLInputElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const drawRect = ref<Rect | null>(null);
const crop = ref<Rect | null>(null);
const dragStart = ref<{ x: number; y: number } | null>(null);
const iconName = ref("");
const busy = ref(false);

function pickFile(): void {
    fileInput.value?.click();
}

function onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
        return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
        app.pushToast("error", "Image is larger than 25 MB");
        return;
    }
    iconName.value = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "icon";
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        image.value = img;
        URL.revokeObjectURL(url);
        draw();
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        app.pushToast("error", "Could not read that image");
    };
    img.src = url;
}

function draw(): void {
    const el = canvas.value;
    const img = image.value;
    if (!el || !img) {
        return;
    }
    el.width = CANVAS_SIZE;
    el.height = CANVAS_SIZE;
    const ctx = el.getContext("2d");
    if (!ctx) {
        return;
    }
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const scale = Math.min(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = (CANVAS_SIZE - w) / 2;
    const y = (CANVAS_SIZE - h) / 2;
    drawRect.value = { x, y, w, h };
    ctx.drawImage(img, x, y, w, h);

    const area = crop.value ?? { x, y, w, h };
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, 0, CANVAS_SIZE, area.y);
    ctx.fillRect(0, area.y + area.h, CANVAS_SIZE, CANVAS_SIZE - area.y - area.h);
    ctx.fillRect(0, area.y, area.x, area.h);
    ctx.fillRect(area.x + area.w, area.y, CANVAS_SIZE - area.x - area.w, area.h);
    ctx.strokeStyle = "#7c6cf0";
    ctx.lineWidth = 2;
    ctx.strokeRect(area.x, area.y, area.w, area.h);
    ctx.restore();
}

function pointerPosition(event: PointerEvent): { x: number; y: number } {
    const el = canvas.value!;
    const rect = el.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE,
        y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
}

function onPointerDown(event: PointerEvent): void {
    if (!image.value) {
        return;
    }
    const position = pointerPosition(event);
    dragStart.value = position;
    crop.value = { x: position.x, y: position.y, w: 0, h: 0 };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(event: PointerEvent): void {
    if (!dragStart.value || !canvas.value) {
        return;
    }
    const position = pointerPosition(event);
    crop.value = {
        x: Math.min(dragStart.value.x, position.x),
        y: Math.min(dragStart.value.y, position.y),
        w: Math.abs(position.x - dragStart.value.x),
        h: Math.abs(position.y - dragStart.value.y),
    };
    draw();
}

function onPointerUp(): void {
    dragStart.value = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (crop.value && (crop.value.w < 4 || crop.value.h < 4)) {
        crop.value = drawRect.value ? { ...drawRect.value } : null;
        draw();
    }
}

onBeforeUnmount(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
});

async function confirmImport(): Promise<void> {
    const img = image.value;
    const area = crop.value ?? drawRect.value;
    if (!img || !area || area.w < 4 || area.h < 4) {
        app.pushToast("warning", "Pick an image and drag a crop region first");
        return;
    }
    const output = document.createElement("canvas");
    output.width = OUTPUT_SIZE;
    output.height = OUTPUT_SIZE;
    const ctx = output.getContext("2d");
    if (!ctx) {
        return;
    }
    // Crop rect is in canvas coordinates; map it back onto the source image.
    const rect = drawRect.value ?? { x: 0, y: 0, w: CANVAS_SIZE, h: CANVAS_SIZE };
    const sx = Math.max(0, ((area.x - rect.x) / rect.w) * img.naturalWidth);
    const sy = Math.max(0, ((area.y - rect.y) / rect.h) * img.naturalHeight);
    const sw = Math.min(img.naturalWidth - sx, (area.w / rect.w) * img.naturalWidth);
    const sh = Math.min(img.naturalHeight - sy, (area.h / rect.h) * img.naturalHeight);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    busy.value = true;
    try {
        const result = await icons.importData(iconName.value, output.toDataURL("image/png"));
        if (result !== null) {
            emit("imported", result.name);
        }
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <div class="crop-dialog" role="dialog" aria-modal="true" aria-label="Import icon">
        <div class="crop-dialog__dialog">
            <header class="crop-dialog__header">
                <h3 class="crop-dialog__title">
                    <Crop :size="15" />
                    <span>Import Icon</span>
                </h3>
                <button
                    class="crop-dialog__close"
                    type="button"
                    title="Close"
                    @click="emit('close')"
                >
                    <X :size="16" />
                </button>
            </header>

            <p class="inspector-section__hint">
                Output is stored at <strong>140×140 px</strong> (device button size). Source images
                up to <strong>25 MB</strong> — PNG, JPEG, or WebP. Drag on the preview to crop
                before importing.
            </p>

            <input
                ref="fileInput"
                class="crop-dialog__file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                @change="onFileChange"
            />

            <div class="crop-dialog__stage">
                <canvas
                    ref="canvas"
                    class="crop-dialog__canvas"
                    :class="{ 'crop-dialog__canvas--empty': !image }"
                    @pointerdown="onPointerDown"
                ></canvas>
                <p v-if="!image" class="crop-dialog__placeholder">Choose an image to begin</p>
            </div>

            <label class="field">
                <span class="field__label">Icon name</span>
                <input
                    v-model="iconName"
                    class="field__input"
                    type="text"
                    placeholder="my-icon"
                />
            </label>

            <div class="crop-dialog__actions">
                <button class="crop-dialog__secondary" type="button" @click="pickFile">
                    <Upload :size="13" />
                    <span>Choose image</span>
                </button>
                <button
                    class="crop-dialog__primary"
                    type="button"
                    :disabled="busy || !image"
                    @click="confirmImport"
                >
                    Import icon
                </button>
            </div>
        </div>
    </div>
</template>
