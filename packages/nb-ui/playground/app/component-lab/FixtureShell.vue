<script setup lang="ts">
import {computed} from "vue";
import FormCheckbox from "../../../src/components/form/FormCheckbox.vue";
import FormSelect from "../../../src/components/form/FormSelect.vue";
import {getLabScene, type LabComponentDefinition} from "./registry";

/**
 * fixture 的公共外壳：eyebrow 行（组件/场景）+ 顶部紧凑场景属性工具栏 + 被测组件插槽。
 * 将场景属性上移至顶栏，彻底解决下方下拉浮层展开时互相遮挡的问题。
 */
const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const controls = defineModel<Record<string, string | boolean>>("controls", {required: true});

const scene = computed(() => getLabScene(props.definition, props.sceneId));

function controlValue(id: string): string | boolean {
    return controls.value[id] ?? "";
}

function setControl(id: string, value: string | boolean): void {
    controls.value = {...controls.value, [id]: value};
}
</script>

<template>
    <div class="lab-fixture w-full">
        <!-- 顶栏：组件路径 + 紧凑场景属性控制条（磨砂玻璃胶囊条） -->
        <div class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
            <div class="font-mono text-xs font-medium text-[var(--text-muted)]">
                {{ definition.label }} / {{ scene.label }}
            </div>

            <div v-if="definition.controls.length > 0" class="flex flex-wrap items-center gap-3">
                <span class="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">场景属性:</span>
                <div v-for="control in definition.controls" :key="control.id" :data-control="control.id" class="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <template v-if="control.type === 'boolean'">
                        <FormCheckbox
                            :model-value="Boolean(controlValue(control.id))"
                            :label="control.label"
                            @update:model-value="setControl(control.id, $event)"
                        />
                    </template>
                    <template v-else>
                        <span class="text-[11px] text-[var(--text-muted)]">{{ control.label }}</span>
                        <FormSelect
                            v-if="control.type === 'select'"
                            :model-value="String(controlValue(control.id))"
                            :options="(control.options ?? []).map((option) => ({label: option.label, value: option.value}))"
                            size="sm"
                            dropdown-direction="down"
                            hide-checkmark
                            class="w-24"
                            @update:model-value="setControl(control.id, $event)"
                        />
                        <input
                            v-else
                            class="nb-ui-control nb-ui-control-h-sm w-20 rounded-[var(--radius-control)] border bg-[var(--control-surface)] px-2 text-xs text-[var(--text-main)] outline-none"
                            type="text"
                            :value="String(controlValue(control.id))"
                            @change="setControl(control.id, ($event.target as HTMLInputElement).value)"
                        >
                    </template>
                </div>
            </div>
        </div>

        <!-- 被测组件展示区 -->
        <slot></slot>
    </div>
</template>
