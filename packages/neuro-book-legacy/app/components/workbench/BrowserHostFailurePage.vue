<script setup lang="ts">
import {Button, Spinner} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    kind: "starting" | "connection-failed" | "incompatible" | "startup-failed";
    title: string;
    description: string;
    retryLabel: string;
    reloadLabel: string;
    reason?: string;
}>(), {reason: ""});
const emit = defineEmits<{retry: []; reload: []}>();
</script>

<template>
    <main class="browser-host-surface" :data-browser-host-failure="props.kind !== 'starting' ? props.kind : undefined"
        :data-browser-connection-failure="props.kind === 'connection-failed' ? '' : undefined"
        :role="props.kind === 'starting' ? 'status' : 'alert'" :aria-busy="props.kind === 'starting' ? true : undefined">
        <section class="browser-host-content">
            <Spinner v-if="props.kind === 'starting'" size="lg" :label="props.title" />
            <span v-else :class="props.kind === 'connection-failed' ? 'i-lucide-wifi-off' : 'i-lucide-triangle-alert'"
                class="browser-host-icon" aria-hidden="true" />
            <h1>{{ props.title }}</h1>
            <p>{{ props.description }}</p>
            <p v-if="props.reason" class="browser-host-reason">{{ props.reason }}</p>
            <Button v-if="props.kind === 'connection-failed'" icon-class="i-lucide-refresh-cw" @click="emit('retry')">{{ props.retryLabel }}</Button>
            <Button v-else-if="props.kind !== 'starting'" icon-class="i-lucide-refresh-cw" @click="emit('reload')">{{ props.reloadLabel }}</Button>
        </section>
    </main>
</template>

<style scoped>
.browser-host-surface {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    background: var(--bg-main);
    color: var(--text-main);
    font-family: var(--font-ui);
    overflow-y: auto;
}
.browser-host-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    max-width: 28rem;
    text-align: center;
    overflow-wrap: anywhere;
}
.browser-host-icon {width: 2rem; height: 2rem; color: var(--status-danger);}
h1 {font-size: var(--text-lg); font-weight: 600;}
p {font-size: var(--text-sm); line-height: 1.5; color: var(--text-secondary);}
.browser-host-reason {font-size: var(--text-xs); color: var(--text-muted); white-space: pre-wrap;}
</style>
