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

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const publishLabData = useLabDataSink();

// 受控状态
const label = ref("refactor/w00003-nb-ui-adoption");
const icon = ref("i-lucide-git-branch");
const badge = ref<string | number>("1↑");
const variant = ref<WorkbenchStatusBarItemVariant>("default");
const clickable = ref(true);
const active = ref(false);
const title = ref("当前 Git 分支");
const clickCount = ref(0);

function applyScene(sceneName: string): void {
    clickCount.value = 0;
    switch (sceneName) {
        case "variants":
            label.value = "5 个错误";
            icon.value = "i-lucide-x-circle";
            badge.value = 5;
            variant.value = "error";
            clickable.value = true;
            active.value = false;
            title.value = "工作区诊断错误计数";
            break;
        case "readonly":
            label.value = "UTF-8";
            icon.value = "";
            badge.value = "";
            variant.value = "default";
            clickable.value = false;
            active.value = false;
            title.value = "只读：文件编码模式";
            break;
        case "default":
        default:
            label.value = "refactor/w00003-nb-ui-adoption";
            icon.value = "i-lucide-git-branch";
            badge.value = "1↑";
            variant.value = "default";
            clickable.value = true;
            active.value = false;
            title.value = "当前 Git 分支（带未推送提交角标）";
            break;
    }
}

watch(
    () => props.scene,
    (newScene) => {
        applyScene(newScene || "default");
    },
    {immediate: true},
);

function onItemClick(event: MouseEvent): void {
    clickCount.value += 1;
    emitLabEvent("status-item-click", {
        label: label.value,
        variant: variant.value,
        active: active.value,
        clickCount: clickCount.value,
    });
}

function onStripClick(event: MouseEvent): void {
    // 当 item 为 readonly (clickable=false) 时，根节点为 span，不发组件级 click。
    // 这里监听承载槽位，用于在 readonly 场景下直观验证「槽位捕获到原生事件，但组件没有触发 click」的断言契约。
    if (!clickable.value) {
        emitLabEvent("status-strip-pointer", {
            note: "只读项（span）未拦截且不分发 click 事件，点击穿透至外层宿主",
            time: Date.now(),
        });
    }
}

const VARIANTS: WorkbenchStatusBarItemVariant[] = ["default", "error", "warning", "info", "success"];

watch([label, icon, badge, variant, clickable, active, clickCount], () => {
    publishLabData({
        scene: props.scene,
        label: label.value,
        icon: icon.value,
        badge: badge.value,
        variant: variant.value,
        clickable: clickable.value,
        active: active.value,
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
                        :class="variant === v ? 'bg-[var(--accent-main)] font-semibold text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                        @click="variant = v"
                    >
                        {{ v }}
                    </button>
                </div>

                <!-- 激活态切换 -->
                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="active ? 'bg-[var(--accent-main)] text-white' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                    @click="active = !active"
                >
                    {{ active ? "激活态 (Active)" : "非激活 (Normal)" }}
                </button>

                <!-- 可点 / 只读切换 -->
                <button
                    type="button"
                    class="h-6 cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-color)] px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
                    :class="clickable ? 'bg-[var(--panel-surface)] text-[var(--text-main)]' : 'bg-[var(--status-warning)] text-black font-semibold'"
                    @click="clickable = !clickable"
                >
                    {{ clickable ? "可交互 (<button>)" : "只读形态 (<span>)" }}
                </button>

                <!-- 角标切换 -->
                <div class="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                    <span>角标:</span>
                    <button
                        type="button"
                        class="h-5 cursor-pointer rounded border border-[var(--border-color)] px-1.5 hover:bg-[var(--bg-hover)]"
                        @click="badge = badge ? '' : 42"
                    >
                        {{ badge !== '' ? `有 (${badge})` : '无' }}
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
                    :id="'status-item-subject'"
                    :label="label"
                    :icon="icon"
                    :badge="badge"
                    :variant="variant"
                    :clickable="clickable"
                    :active="active"
                    :title="title"
                    @click="onItemClick"
                />
            </div>

            <div class="text-[11px] text-[var(--text-muted)] select-none">
                {{ clickable ? "💡 鼠标悬停可预览 2px 微圆角高亮反馈，点击测试事件上报" : "🔒 只读形态（span 根节点）：无悬停底色、无焦点环，点击不产生 click 事件" }}
            </div>
        </div>
    </div>
</template>
