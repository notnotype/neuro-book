<script setup lang="ts">
import {computed, ref, watch} from "vue";
import SettingsLoadState from "../../components/novel-ide/settings/sections/components/SettingsLoadState.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();

type SceneKey = "loading" | "loading-message" | "error" | "error-custom-action";

type SceneProps = {
    /** 形态只由场景决定，不从数据面板取：否则能改出一个叫 loading、画的却是 error 的场景 */
    variant: "loading" | "error";
    message: string;
    actionLabel: string;
};

const KNOWN_SCENES: SceneKey[] = ["loading", "loading-message", "error", "error-custom-action"];

/**
 * 场景初值。空串是初值本身的一部分——`message` 留空才会落到组件自己的默认文案，
 * 所以这里不能用「缺省」把空串折叠掉，否则 loading 与 loading-message 就成了同一个场景。
 */
const SCENE_PROPS: Record<SceneKey, SceneProps> = {
    loading: {variant: "loading", message: "", actionLabel: ""},
    "loading-message": {variant: "loading", message: "正在读取本机设定…", actionLabel: ""},
    error: {variant: "error", message: "读取全局配置失败：文件被占用", actionLabel: ""},
    // 与 error 用同一条真实风格的原因：这两个场景之间只差按钮文案一个变量，
    // 自定义文案特意避开组件默认值（settings.state.reload），否则两档看起来一模一样。
    "error-custom-action": {variant: "error", message: "读取全局配置失败：文件被占用", actionLabel: "重新加载设置"},
};

const sceneKey = computed<SceneKey>(() => KNOWN_SCENES.find((key) => key === props.scene) ?? "loading");

/** 数据面板改的是 props.data：只认字符串，被改成数字/数组时退回场景登记值，不把组件喂成空白。 */
function readText(key: "message" | "actionLabel"): string {
    const fallback = SCENE_PROPS[sceneKey.value][key];
    const source = props.data;
    if (typeof source !== "object" || source === null || Array.isArray(source)) {
        return fallback;
    }
    const value = (source as Record<string, unknown>)[key];
    return typeof value === "string" ? value : fallback;
}

const variant = computed(() => SCENE_PROPS[sceneKey.value].variant);
const message = computed(() => readText("message"));
const actionLabel = computed(() => readText("actionLabel"));

const retryCount = ref(0);

/** 换场景要回到登记初值：否则重复打开同一场景看到的是一条被上次点击留下来的人工状态。 */
function applyScene(): void {
    retryCount.value = 0;
}

// 文案不跟着场景重置：它由 props.data 派生，数据面板改字不该顺手抹掉刚点出来的次数。
watch(() => props.scene, applyScene, {immediate: true});

/** 组件只发 retry，不发结果；夹具照原样记一次并转交 Lab，不伪造「重试成功」。 */
function onRetry(): void {
    retryCount.value += 1;
    emitLabEvent("retry", retryCount.value);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col gap-[var(--space-3)] overflow-y-auto p-[var(--space-4)]">
        <p class="flex shrink-0 flex-wrap items-center justify-between gap-x-[var(--space-3)] gap-y-1 text-[var(--text-xs)] text-[var(--text-secondary)]">
            <span>夹具只记录组件发出的 retry，不接真实读取：这里没有「重试成功」这回事。</span>
            <span class="shrink-0 tabular-nums text-[var(--text-main)]">retry 次数：{{ retryCount }}</span>
        </p>

        <!-- 组件根是 h-full：不给确定高度就看不出它占满整块、也看不出两种形态都在里面居中。 -->
        <div class="h-[320px] w-full shrink-0 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)]">
            <SettingsLoadState
                data-lab-subject
                :variant="variant"
                :message="message"
                :action-label="actionLabel"
                @retry="onRetry"
            />
        </div>
    </div>
</template>
