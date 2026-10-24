<script setup lang="ts">
import { Trash2 } from "@lucide/vue";
import IconButton from "@/components/ui/IconButton.vue";
import Tooltip from "@/components/ui/Tooltip.vue";
import type { InventoryRow } from "@/device/inventory";

defineProps<{
    row: InventoryRow;
    disabledReason?: string;
    deleting?: boolean;
}>();

const emit = defineEmits<{ (event: "delete"): void }>();
</script>

<template>
    <Tooltip :text="disabledReason ?? 'Delete from deck'">
        <IconButton
            :label="`Delete ${row.name} from deck`"
            variant="ghost"
            :disabled="disabledReason !== undefined || deleting"
            @click="emit('delete')"
        >
            <Trash2 :size="14" />
        </IconButton>
    </Tooltip>
</template>
