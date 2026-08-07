<script setup lang="ts">
// 决策拍板对话框:ADR 决策流的核心仪式 —— 从候选中落槌,写下 结论/动机/风险 三段。
// 提交语义:宿主 tab 映射到 updateStoryDecision({status:"decided", decision, motivation, risk, chosenOption?});
// 选中候选传 chosenOption(与候选原文匹配),未选中的候选由服务层自动转为否决记录骨架(whyRejected=null);
// 选「全新方案」不传 chosenOption,全部候选转骨架。三段客户端必填校验,服务层还有一道不变式校验。
import {computed, reactive, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import type {StoryDecisionDto} from "nbook/shared/dto/plot.dto";

// 拍板提交载荷:宿主 tab 负责发 PATCH 并把服务层错误经 error prop 回传。
export type PlotDecisionDecideSave = {
    decision: string;
    motivation: string;
    risk: string;
    // 为空表示「全新方案(不在候选中)」:不传 chosenOption,全部候选转否决骨架;非空是被选候选的原文。
    chosenOption: string | null;
};

const props = defineProps<{
    visible: boolean;
    // 待拍板的决策(open 态);为空表示宿主尚未选中决策,对话框不应处于打开状态。
    decision: StoryDecisionDto | null;
    saving?: boolean;
    // 为空表示宿主侧无保存错误;非空是服务层校验/请求失败文案(对话框局部 error)。
    error?: string;
}>();

const emit = defineEmits<{
    (e: "update:visible", value: boolean): void;
    (e: "save", payload: PlotDecisionDecideSave): void;
}>();

// 单选态:数字=候选下标,"new"=全新方案;为 null 表示尚未选择(有候选时强制显式选择)。
const choice = ref<number | "new" | null>(null);
// 三段草稿。
const draft = reactive({decision: "", motivation: "", risk: ""});
// 行内校验错误;为空表示该字段当前无校验问题。
const fieldErrors = reactive({choice: "", decision: "", motivation: "", risk: ""});

const options = computed(() => props.decision?.options ?? []);
// 当前选中候选的原文;为空表示选了「全新方案」或尚未选择。
const chosenOptionText = computed(() => {
    return typeof choice.value === "number" ? (options.value[choice.value]?.option ?? null) : null;
});

watch(() => props.visible, (visible) => {
    if (visible) {
        // 无候选时直接落在「全新方案」;有候选时留空,强制显式选择(拍板仪式的一部分)。
        choice.value = options.value.length > 0 ? null : "new";
        draft.decision = "";
        draft.motivation = "";
        draft.risk = "";
        fieldErrors.choice = "";
        fieldErrors.decision = "";
        fieldErrors.motivation = "";
        fieldErrors.risk = "";
    }
});

/** 选择一个候选(或全新方案),并清掉选择项的校验提示。 */
function chooseOption(value: number | "new"): void {
    choice.value = value;
    fieldErrors.choice = "";
}

/** 一键把选中候选的文本填入结论(填入后仍可改写)。 */
function fillDecisionFromChoice(): void {
    if (chosenOptionText.value !== null) {
        draft.decision = chosenOptionText.value;
        fieldErrors.decision = "";
    }
}

/** 关闭对话框(不提交)。 */
function closeDialog(): void {
    emit("update:visible", false);
}

/** 客户端必填校验并提交;任一字段为空时行内 danger 提示,不发请求。 */
function submit(): void {
    const decision = draft.decision.trim();
    const motivation = draft.motivation.trim();
    const risk = draft.risk.trim();
    fieldErrors.choice = choice.value === null ? "请选择一个候选方案,或选择「全新方案」" : "";
    fieldErrors.decision = decision ? "" : "结论不能为空:最终怎么定";
    fieldErrors.motivation = motivation ? "" : "动机不能为空:为什么这样定";
    fieldErrors.risk = risk ? "" : "风险不能为空:writer 沿此写下去要注意什么";
    if (fieldErrors.choice || fieldErrors.decision || fieldErrors.motivation || fieldErrors.risk) {
        return;
    }
    emit("save", {decision, motivation, risk, chosenOption: chosenOptionText.value});
}
</script>

<template>
    <!-- 决策拍板对话框 -->
    <Dialog
        :model-value="props.visible"
        title="拍板决策"
        width="640px"
        show-cancel
        overlay-type="opaque"
        :busy="props.saving"
        @request-close="closeDialog"
        @update:model-value="emit('update:visible', $event)"
    >
        <template #header-extra>
            <div v-if="props.saving || props.error" class="ml-2 flex items-center text-xs">
                <span v-if="props.saving" class="flex items-center gap-1 text-[var(--text-muted)]">
                    <span class="i-lucide-loader-circle animate-spin"></span>
                    拍板中
                </span>
                <span v-else class="text-[var(--status-danger)]">{{ props.error }}</span>
            </div>
        </template>
        <template #footer>
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="closeDialog">取消</button>
            <!-- 落槌:拍板动作的主按钮 -->
            <button class="inline-flex items-center justify-center gap-1.5 h-8 min-w-[112px] px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.saving" @click="submit">
                <span v-if="props.saving" class="flex items-center gap-1">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>
                    拍板中
                </span>
                <template v-else>
                    <span class="i-lucide-gavel h-3.5 w-3.5"></span>
                    <span>落槌拍板</span>
                </template>
            </button>
        </template>

        <!-- 拍板表单主体 -->
        <div class="mt-1 space-y-3.5 px-1">
            <!-- 待决问题:仪式的开场,突出显示 -->
            <div class="rounded-lg border border-[var(--border-color)] border-l-[3px] border-l-[var(--accent-main)] bg-[var(--bg-subtle)] px-3 py-2.5">
                <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <span class="i-lucide-circle-help h-3 w-3"></span>
                    <span>待决问题</span>
                </div>
                <div class="mt-1.5 whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-[var(--text-main)]">{{ props.decision?.question ?? "" }}</div>
            </div>

            <!-- 候选单选组:每个候选一项 + 末尾「全新方案」 -->
            <div class="space-y-1.5">
                <div class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">选定方案</div>
                <button
                    v-for="(option, index) in options"
                    :key="index"
                    type="button"
                    class="w-full rounded-md border px-3 py-2 text-left transition-colors"
                    :class="choice === index ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                    @click="chooseOption(index)"
                >
                    <div class="flex items-start gap-2.5">
                        <span class="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border" :class="choice === index ? 'border-[var(--accent-main)]' : 'border-[var(--border-strong)]'">
                            <span v-if="choice === index" class="h-1.5 w-1.5 rounded-full bg-[var(--accent-main)]"></span>
                        </span>
                        <span class="min-w-0">
                            <span class="block text-[12px] leading-5" :class="choice === index ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-secondary)]'">{{ option.option }}</span>
                            <span v-if="option.note" class="mt-0.5 block text-[11px] leading-4 text-[var(--text-muted)]">{{ option.note }}</span>
                        </span>
                    </div>
                </button>
                <!-- 全新方案:结论不在候选中,全部候选将转为否决记录骨架 -->
                <button
                    type="button"
                    class="w-full rounded-md border border-dashed px-3 py-2 text-left transition-colors"
                    :class="choice === 'new' ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-transparent hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                    @click="chooseOption('new')"
                >
                    <div class="flex items-start gap-2.5">
                        <span class="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border" :class="choice === 'new' ? 'border-[var(--accent-main)]' : 'border-[var(--border-strong)]'">
                            <span v-if="choice === 'new'" class="h-1.5 w-1.5 rounded-full bg-[var(--accent-main)]"></span>
                        </span>
                        <span class="min-w-0">
                            <span class="block text-[12px] leading-5" :class="choice === 'new' ? 'font-semibold text-[var(--text-main)]' : 'text-[var(--text-secondary)]'">全新方案(不在候选中)</span>
                            <span class="mt-0.5 block text-[11px] leading-4 text-[var(--text-muted)]">结论在下方直接写出,全部候选将转为否决记录</span>
                        </span>
                    </div>
                </button>
                <div v-if="fieldErrors.choice" class="text-[11px] text-[var(--status-danger)]">{{ fieldErrors.choice }}</div>
            </div>

            <!-- 结论 -->
            <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">结论(decision)</div>
                    <button v-if="chosenOptionText !== null" type="button" class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--accent-text)] transition-colors hover:bg-[var(--bg-hover)]" @click="fillDecisionFromChoice">
                        <span class="i-lucide-corner-left-down h-2.5 w-2.5"></span>
                        把候选文本填入
                    </button>
                </div>
                <FormTextarea v-model="draft.decision" :rows="3" placeholder="最终怎么定(写进决策记录的结论)" />
                <div v-if="fieldErrors.decision" class="text-[11px] text-[var(--status-danger)]">{{ fieldErrors.decision }}</div>
            </div>

            <!-- 动机 -->
            <div class="space-y-1.5">
                <div class="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">动机(motivation)</div>
                <FormTextarea v-model="draft.motivation" :rows="2" placeholder="为什么这样定(供后续审查与接手者理解)" />
                <div v-if="fieldErrors.motivation" class="text-[11px] text-[var(--status-danger)]">{{ fieldErrors.motivation }}</div>
            </div>

            <!-- 风险:writer 的刹车点,warning 色块 -->
            <div class="space-y-1.5 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2.5">
                <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--status-warning)]">
                    <span class="i-lucide-triangle-alert h-3 w-3"></span>
                    <span>风险(risk · writer 的刹车点)</span>
                </div>
                <FormTextarea v-model="draft.risk" :rows="2" placeholder="沿此结论写下去要注意什么、哪里容易写崩" />
                <div v-if="fieldErrors.risk" class="text-[11px] text-[var(--status-danger)]">{{ fieldErrors.risk }}</div>
            </div>

            <!-- 否决记录去向提示 -->
            <div class="flex items-start gap-1.5 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-2.5 py-1.5 text-[11px] text-[var(--status-info)]">
                <span class="i-lucide-info mt-0.5 h-3 w-3 shrink-0"></span>
                <span>未选中的候选将自动转为否决记录,理由可稍后在编辑中补填。</span>
            </div>
        </div>
    </Dialog>
</template>
