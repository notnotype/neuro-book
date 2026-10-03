<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import {useLabControlsRegister} from "./lab-event-sink";

const register = useLabControlsRegister();
const isClient = ref(typeof document !== "undefined");
let registered = false;

if (typeof document !== "undefined") {
    register(true);
    registered = true;
}

onMounted(() => {
    isClient.value = true;
    if (!registered) {
        register(true);
        registered = true;
    }
});

onBeforeUnmount(() => {
    if (registered) {
        register(false);
        registered = false;
    }
});

const canTeleport = computed(() => {
    if (!isClient.value || typeof document === "undefined") return false;
    return Boolean(document.getElementById("lab-fixture-controls-target"));
});
</script>

<template>
    <Teleport v-if="canTeleport" to="#lab-fixture-controls-target">
        <slot />
    </Teleport>
    <div v-else class="lab-fixture-controls-fallback hidden" aria-hidden="true">
        <slot />
    </div>
</template>
