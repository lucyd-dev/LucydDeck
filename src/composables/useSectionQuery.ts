import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

/**
 * Read the active section from the `?section=` query and write it back on
 * change. Views and their sidebar share one allowed list and fallback, so the
 * two cannot drift to different defaults.
 */
export function useSectionQuery(routeName: string, allowed: readonly string[], fallback: string) {
    const route = useRoute();
    const router = useRouter();
    return computed<string>({
        get() {
            const value = String(route.query.section ?? "");
            return allowed.includes(value) ? value : fallback;
        },
        set(value: string) {
            if (!allowed.includes(value)) {
                return;
            }
            void router.push({ name: routeName, query: { ...route.query, section: value } });
        },
    });
}
