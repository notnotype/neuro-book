<script setup lang="ts">
/**
 * Lab 右栏：检视面板的四个页签（docs/specs/ui/component-lab.md 的输出“右侧检视面板”）。元素页签展示检查器选中的元素，
 * 文档页签展示能力标签与组件文档，事件页签展示事件日志，数据页签编辑场景登记的分层输入。数据都由 LabShell 持有，
 * 这里只呈现与转发；复制定位报告的“已复制”提示归这一栏。
 */
import {computed, onBeforeUnmount, ref} from "vue";
import {Switch as NbSwitch, Tabs as NbTabs} from "@notnotype/nb-ui/components";
import type {TabsItem} from "@notnotype/nb-ui/components";

import JsonViewer from "nbook/ui/JsonViewer.vue";

import CollapsibleSidePanel from "./components/CollapsibleSidePanel.vue";
import EventLogPanel from "./components/EventLogPanel.vue";
import MarkdownView from "./components/MarkdownView.vue";
import type {LabEventEntry} from "./components/event-log.types";
import type {LabComponentEntry} from "./component-index";
import {INSPECT_CLASS_LIMIT, nodeReport} from "./inspect";
import type {InspectedNode} from "./inspect";
import type {LabInspection} from "./inspect-checks";
import type {LabTokenGroup} from "./lab-tokens";
import LabVariablesPanel from "./LabVariablesPanel.vue";
import type {LabSceneInput} from "./lab-subject";

const props = defineProps<{
    collapsed: boolean;
    width: number;
    selected: LabComponentEntry | null;
    picked: InspectedNode | null;
    events: LabEventEntry[];
    eventLimit: number;
    sceneInput: LabSceneInput | undefined;
    /** 场景登记的插槽预设名。 */
    fixtureSlots: readonly string[];
    fixtureState: unknown;
    inputEditError: string;
    /** fixture 声明没有可编辑输入的理由；有输入时为 undefined。 */
    noInput: string | undefined;
    /** 选中元素的结构检查与计算样式读数；没有选中时为 null。 */
    inspection: LabInspection | null;
    // 变量页签：覆盖由 LabShell 持有；操作是函数，要拿到同步的返回值与异常（见 LabVariablesPanel）。
    tokenGroups: readonly LabTokenGroup[];
    resolvedTokens: Readonly<Record<string, string>>;
    overrides: Readonly<Record<string, string>>;
    overrideCount: number;
    onOverrideSet: (name: string, value: string) => void;
    onOverrideReset: (name: string) => void;
    onOverrideResetAll: () => void;
    onOverrideImport: (raw: string) => number;
    onOverrideExport: () => string;
}>();

const tab = defineModel<string>("tab", {required: true});

const emit = defineEmits<{
    "update:collapsed": [collapsed: boolean];
    "clear-picked": [];
    "clear-events": [];
    "reset-input": [];
    "edit-input": [layer: "props" | "model", value: unknown];
    "set-slot": [name: string, on: boolean];
}>();

const tabItems = computed<TabsItem[]>(() => [
    {value: "doc", label: "文档"},
    {value: "element", label: "元素"},
    {value: "events", label: "事件", count: props.events.length},
    {value: "data", label: "数据"},
    {value: "variables", label: "变量", ...(props.overrideCount > 0 ? {count: props.overrideCount} : {})},
]);

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyPicked(): Promise<void> {
    if (props.picked === null) {
        return;
    }
    await navigator.clipboard.writeText(nodeReport(props.picked));
    copied.value = true;
    if (copiedTimer !== null) {
        clearTimeout(copiedTimer);
    }
    copiedTimer = setTimeout(() => {
        copied.value = false;
    }, 1600);
}

onBeforeUnmount(() => {
    if (copiedTimer !== null) {
        clearTimeout(copiedTimer);
    }
});
</script>

<template>
    <CollapsibleSidePanel
        :collapsed="collapsed"
        title="检视"
        side="right"
        layer="content"
        class="lab-panel shrink-0"
        :style="collapsed ? undefined : {width: `${width}px`, flex: `0 0 ${width}px`}"
        @update:collapsed="emit('update:collapsed', $event)"
    >
        <div class="flex h-full min-h-0 flex-col">
            <div class="lab-tabs shrink-0">
                <NbTabs v-model="tab" :items="tabItems" size="sm" aria-label="检视面板" />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
                <div v-if="tab === 'element'" class="lab-pad" data-lab-panel="element">
                    <template v-if="picked">
                        <dl class="lab-meta lab-meta--flush">
                            <div v-if="picked.componentName" class="lab-meta-row">
                                <dt class="lab-meta-key">组件</dt>
                                <dd class="min-w-0 break-words">{{ picked.componentName }}</dd>
                            </div>
                            <div v-if="picked.hostComponentName && picked.hostComponentName !== picked.componentName" class="lab-meta-row">
                                <dt class="lab-meta-key">所属宿主</dt>
                                <dd class="min-w-0 break-words">{{ picked.hostComponentName }}</dd>
                            </div>
                            <div v-if="picked.hostComponentFile && picked.hostComponentFile !== picked.componentFile" class="lab-meta-row">
                                <dt class="lab-meta-key">宿主文件</dt>
                                <dd class="min-w-0 break-all font-mono">{{ picked.hostComponentFile }}</dd>
                            </div>
                            <div v-if="picked.componentFile" class="lab-meta-row">
                                <dt class="lab-meta-key">源文件</dt>
                                <dd class="min-w-0 break-all font-mono">{{ picked.componentFile }}</dd>
                            </div>
                            <div class="lab-meta-row">
                                <dt class="lab-meta-key">选择器</dt>
                                <dd class="min-w-0 break-all font-mono">{{ picked.selector }}</dd>
                            </div>
                            <div v-if="picked.text" class="lab-meta-row">
                                <dt class="lab-meta-key">文本</dt>
                                <dd class="min-w-0 break-words font-mono text-[11px]">{{ picked.text }}</dd>
                            </div>
                            <div v-if="picked.snippet" class="lab-meta-row">
                                <dt class="lab-meta-key">标签</dt>
                                <dd class="min-w-0 break-all font-mono text-[11px] text-[var(--accent-text)]">{{ picked.snippet }}</dd>
                            </div>
                            <div class="lab-meta-row">
                                <dt class="lab-meta-key">尺寸</dt>
                                <dd class="tabular-nums">{{ picked.width }} × {{ picked.height }}</dd>
                            </div>
                            <div v-if="picked.isSubject" class="lab-meta-row">
                                <dt class="lab-meta-key">标记</dt>
                                <dd>fixture 标出的零件本体</dd>
                            </div>
                        </dl>

                        <p class="lab-panel-label">类名 {{ picked.classes.length }}</p>
                        <div class="lab-tags">
                            <span v-if="picked.classes.length === 0" class="lab-note">无</span>
                            <code
                                v-for="name in picked.classes.slice(0, INSPECT_CLASS_LIMIT)"
                                :key="name"
                                class="lab-chip"
                            >{{ name }}</code>
                            <span v-if="picked.classes.length > INSPECT_CLASS_LIMIT" class="lab-note">
                                还有 {{ picked.classes.length - INSPECT_CLASS_LIMIT }} 个（复制里是全的）
                            </span>
                        </div>

                        <div class="lab-row">
                            <button type="button" class="lab-btn lab-btn--icon" @click="copyPicked">
                                <span
                                    class="h-3.5 w-3.5"
                                    :class="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                                    aria-hidden="true"
                                ></span>
                                {{ copied ? "已复制" : "复制" }}
                            </button>
                            <button type="button" class="lab-btn" @click="emit('clear-picked')">取消选中</button>
                        </div>

                        <template v-if="inspection !== null">
                            <p class="lab-panel-label">结构检查</p>
                            <ul class="lab-checks" data-lab-checks>
                                <li v-for="check in inspection.checks" :key="check.label" class="lab-check" :data-pass="check.pass">
                                    <span :class="check.pass ? 'i-lucide-circle-check text-[var(--status-success)]' : 'i-lucide-circle-x text-[var(--status-danger)]'" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                                    <span class="shrink-0">{{ check.label }}</span>
                                    <span class="lab-note min-w-0 truncate" :title="check.detail">{{ check.detail }}</span>
                                </li>
                            </ul>
                            <template v-for="group in inspection.groups" :key="group.id">
                                <p class="lab-panel-label">{{ group.label }}</p>
                                <dl class="lab-meta lab-meta--flush" :data-lab-readout="group.id">
                                    <div v-for="item in group.items" :key="item.label" class="lab-meta-row">
                                        <dt class="lab-meta-key">{{ item.label }}</dt>
                                        <dd class="flex min-w-0 items-center gap-[var(--space-2)] break-all font-mono text-[11px]">
                                            <span v-if="item.swatch" class="lab-check-swatch" :style="{background: item.swatch}" aria-hidden="true"></span>
                                            {{ item.value }}
                                        </dd>
                                    </div>
                                </dl>
                            </template>
                        </template>
                    </template>
                    <p v-else class="lab-note">
                        点上面的「检查」，再点界面上任意位置——组件、源文件与选择器会落在这里，可以复制。
                    </p>
                </div>

                <div v-else-if="tab === 'doc'" class="lab-pad" data-lab-panel="doc">
                    <template v-if="selected">
                        <!-- 能力标签与能不能挂都是文档 frontmatter 派生的，
                             放在文档正文上方而不是单开一个 tab。 -->
                        <dl class="lab-meta">
                            <div class="lab-meta-row">
                                <dt class="lab-meta-key">目录</dt>
                                <dd>{{ selected.group }}</dd>
                            </div>
                            <div class="lab-meta-row">
                                <dt class="lab-meta-key">能力标签</dt>
                                <dd class="lab-tags">
                                    <span v-if="selected.tags.length === 0">无</span>
                                    <code v-for="tag in selected.tags" :key="tag" class="lab-chip">{{ tag }}</code>
                                </dd>
                            </div>
                            <div class="lab-meta-row">
                                <dt class="lab-meta-key">确定性验证</dt>
                                <dd>
                                    {{ selected.mountable
                                        ? (selected.needsSnapshot ? "需预置状态快照" : "可以")
                                        : (selected.verifyEntry ? `在 ${selected.verifyEntry} 的集成场景里` : "只能在正式界面") }}
                                </dd>
                            </div>
                        </dl>
                        <MarkdownView :source="selected.doc" />
                    </template>
                </div>

                <div v-else-if="tab === 'events'" class="flex h-full flex-col" data-lab-panel="events">
                    <div class="lab-strip shrink-0">
                        <span class="lab-note">最多留最近 {{ eventLimit }} 条</span>
                        <button type="button" class="lab-btn" @click="emit('clear-events')">清空</button>
                    </div>
                    <EventLogPanel :entries="events" empty-text="操作一下组件，事件会记在这里" />
                </div>

                <div v-else-if="tab === 'data'" class="lab-pad lab-data" data-lab-panel="data">
                    <!-- 只展示 fixture 明确登记的 props / model / slots；Lab 不读取被测组件运行时签名。 -->
                    <template v-if="sceneInput !== undefined">
                        <div class="flex shrink-0 items-center justify-between">
                            <span class="lab-note">改完立刻生效</span>
                            <button type="button" class="lab-btn" @click="emit('reset-input')">还原输入</button>
                        </div>
                        <p v-if="inputEditError !== ''" role="alert" class="lab-note text-[var(--status-danger)]">{{ inputEditError }}</p>
                        <section v-if="sceneInput.model !== undefined">
                            <p class="lab-panel-label">model · 受控值，组件发 update 时回写</p>
                            <JsonViewer
                                :value="sceneInput.model"
                                :read-only="false"
                                :max-height="260"
                                @update:value="emit('edit-input', 'model', $event)"
                            />
                        </section>
                        <section v-if="sceneInput.props !== undefined">
                            <p class="lab-panel-label">props · 非受控输入，没写的走组件默认值</p>
                            <JsonViewer
                                :value="sceneInput.props"
                                :read-only="false"
                                :max-height="260"
                                @update:value="emit('edit-input', 'props', $event)"
                            />
                        </section>
                        <section v-if="sceneInput.slots !== undefined && fixtureSlots.length > 0">
                            <p class="lab-panel-label">slots · 开启后填入 fixture 备好的预设内容</p>
                            <div v-for="name in fixtureSlots" :key="name" class="lab-meta-row items-center">
                                <code class="lab-chip">#{{ name }}</code>
                                <NbSwitch
                                    :model-value="sceneInput.slots[name] === true"
                                    size="sm"
                                    :aria-label="`插槽 ${name} 使用预设内容`"
                                    @update:model-value="emit('set-slot', name, $event)"
                                />
                            </div>
                        </section>
                    </template>
                    <p v-else class="lab-note">
                        {{ noInput ? `无需输入调试：${noInput}` : "这个场景未登记调试输入，请按 fixture 合同迁移。" }}
                    </p>
                    <section v-if="fixtureState !== undefined">
                        <p class="lab-panel-label">内部状态 · 只读，由 fixture 上报</p>
                        <JsonViewer :value="fixtureState" :read-only="true" :max-height="260" />
                    </section>
                </div>

                <LabVariablesPanel
                    v-else-if="tab === 'variables'"
                    data-lab-panel="variables"
                    :groups="tokenGroups"
                    :resolved="resolvedTokens"
                    :overrides="overrides"
                    :count="overrideCount"
                    :on-set="onOverrideSet"
                    :on-reset="onOverrideReset"
                    :on-reset-all="onOverrideResetAll"
                    :on-import="onOverrideImport"
                    :on-export="onOverrideExport"
                />
            </div>
        </div>
    </CollapsibleSidePanel>
</template>
