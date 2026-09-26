<script setup lang="ts">
/**
 * WorkbenchStatusBarItem 原子零件的 Lab 场景。
 *
 * 遵循 Component Lab 新 Fixture API 规范：
 * 1. 舞台直连与单一主体（data-lab-subject）：杜绝嵌套假视区与整栏假外壳；
 * 2. 契约呈现：状态栏项高度契约 100%（~22px），在标准 22px 状态栏承载槽位中居中展示；
 * 3. 调试控件分离：所有交互切换与变体测试收敛至 LabFixtureControls；
 * 4. 三档场景契约：
 *    - default: 图标 + 文本 + 角标（支持切换激活态与微圆角高亮）；
 *    - variants: error / warning / info / success 语义变体配色与角标；
 *    - readonly: clickable=false 纯文本/span 渲染，不进 Tab 序列，不发点击事件。
 */
import {computed, ref, watch} from "vue";
import WorkbenchStatusBarItem, {
    type WorkbenchStatusBarItemVariant,
} from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchStatusBarItem>(() => props.input);

const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();
const clickCount = ref(0);
watch(() => props.scene, () => { clickCount.value = 0; });


function onItemClick(): void {
    clickCount.value += 1;
    emitLabEvent("status-item-click", {
        label: subject.bindings.value.label,
        variant: subject.bindings.value.variant,
        active: subject.bindings.value.active,
        clickCount: clickCount.value,
    });
}

function onStripClick(event: MouseEvent): void {
    // 当 item 为 readonly (clickable=false) 时，根节点为 span，不发组件级 click。
    // 这里监听承载槽位，用于在 readonly 场景下直观验证「槽位捕获到原生事件，但组件没有触发 click」的断言契约。
    if (!subject.bindings.value.clickable) {
        emitLabEvent("status-strip-pointer", {
            note: "只读项（span）未拦截且不分发 click 事件，点击穿透至外层宿主",
            time: Date.now(),
        });
    }
}

const VARIANTS: WorkbenchStatusBarItemVariant[] = ["default", "error", "warning", "info", "success"];

watch(() => [subject.bindings.value, clickCount.value], () => {
    publishLabData({
        scene: props.scene,
        ...subject.bindings.value,
        clickCount: clickCount.value,
    });
}, {immediate: true});
</script>

<template>
    <div class="flex h-full w-full flex-col items-center justify-center p-6">
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-medium text-[var(--text-secondary)]">原子属性控制：</span>

                <!-- 变体切换按钮组 -->
                <div class="flex items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] p-0.5">
                    <span class="px-1 text-[10px] text-[var(--text-muted)]">变体:</span>
                    <button
                        v-for="v in VARIANTS"
                        :key="v"
                        type="button"
                        class="h-5 cursor-pointer rounded px-1.5 text-[11px] transition-colors"
                        :class="subject.bindings.value.variant === v ? 'bg-[var(--accent-main)] font-semibold text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                        @click="subject.write('props', 'variant', v)"
                    >
                        {{ v }}
                    </button>
                </div>

                <!-- 激活态切换 -->
                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="subject.bindings.value.active ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="subject.write('props', 'active', !subject.bindings.value.active)"
                >
                    {{ subject.bindings.value.active ? "激活态 (Active)" : "非激活 (Normal)" }}
                </button>

                <!-- 可点 / 只读切换 -->
                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="subject.bindings.value.clickable ? 'bg-[var(--panel-surface)] text-[var(--text-main)]' : 'bg-[var(--status-warning)] text-black font-semibold'"
                    @click="subject.write('props', 'clickable', !subject.bindings.value.clickable)"
                >
                    {{ subject.bindings.value.clickable ? "可交互 (<button>)" : "只读形态 (<span>)" }}
                </button>

                <!-- 角标切换 -->
                <div class="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                    <span>角标:</span>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded border border-[var(--border-color)] px-1.5 hover:bg-[var(--bg-hover)]"
                        @click="subject.write('props', 'badge', subject.bindings.value.badge ? '' : 42)"
                    >
                        {{ subject.bindings.value.badge !== '' ? `有 (${subject.bindings.value.badge})` : '无' }}
                    </button>
                </div>

                <span class="text-[var(--text-muted)]">|</span>
                <span class="text-[var(--text-secondary)]">
                    累计点击: <strong class="font-mono text-[var(--text-main)]">{{ clickCount }}</strong>
                </span>
            </div>
        </LabFixtureControls>

        <!-- 舞台展示区：居中展示标准 22px 状态栏槽位与被测单零件 -->
        <div class="flex flex-col items-center gap-3">
            <div class="text-xs text-[var(--text-secondary)] select-none">
                状态栏子项（标准 ~22px 高度契约 · 2px 微圆角悬停/激活态 · 单主体）：
            </div>

            <!-- 极窄 22px 状态栏插槽容器（完全平直、无大胶囊圆角） -->
            <div
                class="flex h-[22px] w-full items-stretch justify-center border border-[var(--divider)] bg-[var(--panel-surface)] px-[var(--space-1)] shadow-xs"
                @click="onStripClick"
            >
                <WorkbenchStatusBarItem
                    data-lab-subject
                    v-bind="subject.bindings.value"
                    @click="onItemClick"
                />
            </div>

            <div class="text-[11px] text-[var(--text-muted)] select-none">
                {{ subject.bindings.value.clickable ? "💡 鼠标悬停可预览 2px 微圆角高亮反馈，点击测试事件上报" : "🔒 只读形态（span 根节点）：无悬停底色、无焦点环，点击不产生 click 事件" }}
            </div>
        </div>
    </div>
</template>
