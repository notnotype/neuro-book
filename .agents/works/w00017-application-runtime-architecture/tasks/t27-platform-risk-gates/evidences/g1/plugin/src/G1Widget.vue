<script setup lang="ts">
import {computed, inject, onBeforeUnmount, onMounted, ref} from "vue";
import {Button, Popover, Tooltip} from "@notnotype/nb-ui/components";
import {PLUGIN_HOST_CONTEXT, useHostColorMode, useHostI18n} from "@neurobook/plugin-sdk";

// 这个组件是 G1 风险门的示例插件视图：它在宿主构建之外单独构建，运行时才被宿主加载。
const props = defineProps<{variant: string}>();

const count = ref(0);
const host = inject(PLUGIN_HOST_CONTEXT, null);
const {t, locale} = useHostI18n();
const colorMode = useHostColorMode();
const popoverOpen = ref(false);
const renderBoom = ref(false);
const resizeEvents = ref(0);

function onResize(): void {
    resizeEvents.value += 1;
}

onMounted(() => window.addEventListener("resize", onResize));
onBeforeUnmount(() => window.removeEventListener("resize", onResize));

const renderProbe = computed(() => {
    if (renderBoom.value) {
        throw new Error(`G1 plugin render error (${props.variant})`);
    }
    return "render-ok";
});

function throwInHandler(): void {
    throw new Error(`G1 plugin handler error (${props.variant})`);
}
</script>

<template>
    <div class="g1-plugin" :data-g1-plugin="props.variant">
        <div class="g1-plugin__row">
            <span class="g1-plugin__label">count</span>
            <span data-testid="count">{{ count }}</span>
            <button data-testid="plain-inc" class="g1-plugin__plain" type="button" @click="count++">plain +1</button>
            <Button data-testid="nb-inc" size="sm" @click="count++">nb-ui +1</Button>
        </div>
        <div class="g1-plugin__row">
            <span class="g1-plugin__label">i18n</span>
            <span data-testid="i18n">{{ t("common.cancel") }}</span>
            <span data-testid="locale">{{ locale }}</span>
            <span class="g1-plugin__label">theme</span>
            <span data-testid="theme">{{ colorMode }}</span>
            <span class="g1-plugin__label">inject</span>
            <span data-testid="inject">{{ host?.hostName ?? "missing" }}</span>
        </div>
        <div class="g1-plugin__row">
            <Tooltip :text="`tooltip-${props.variant}`" :delay="0" placement="top">
                <Button data-testid="tooltip-trigger" variant="secondary" size="sm">tooltip</Button>
            </Tooltip>
            <Popover v-model:open="popoverOpen" side="bottom">
                <template #trigger>
                    <Button data-testid="popover-trigger" variant="secondary" size="sm">popover</Button>
                </template>
                <div :data-testid="`popover-body-${props.variant}`" class="g1-plugin__popover">
                    popover {{ props.variant }} · {{ t("common.confirm") }} · {{ count }}
                </div>
            </Popover>
        </div>
        <div class="g1-plugin__row">
            <span data-testid="render-probe">{{ renderProbe }}</span>
            <button data-testid="throw-render" class="g1-plugin__plain" type="button" @click="renderBoom = true">throw in render</button>
            <button data-testid="throw-handler" class="g1-plugin__plain" type="button" @click="throwInHandler">throw in handler</button>
            <span data-testid="resize-events">{{ resizeEvents }}</span>
        </div>
    </div>
</template>

<style scoped>
.g1-plugin {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px dashed rgb(120 160 255 / 60%);
    border-radius: 8px;
}

.g1-plugin__row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.g1-plugin__label {
    opacity: 0.6;
    font-size: 12px;
}

.g1-plugin__plain {
    padding: 2px 8px;
    border: 1px solid currentColor;
    border-radius: 4px;
}

.g1-plugin__popover {
    min-width: 160px;
    padding: 4px;
}
</style>
