<script setup lang="ts">
/**
 * “消息”视图的外框：聊天区与会话页放占位，真实的聊天与会话面板在各自的场景里。
 *
 * 场景名以 `docked` 开头的挂一条替身侧轨（工作台右轨的最小结构：入口一列、`main`、`foot`、展开按钮），视图段送进它的 `main`、`foot`；
 * 轨宽收着 48、展开 260，场景名带 `-200`、`-420` 时按那个宽。其余场景按场景给的 `placement`（右边缘、不画）。
 * 宿主那一半照真实宿主做：`show-list` 时展开并切页，展开好了调 `focusSearch`；替身轨上的展开按钮切换展开。
 */
import {AgentMessages} from "@notnotype/nb-agent-ui/vue";
import type {MessagesSegmentPlacement} from "@notnotype/nb-agent-ui/vue";
import {computed, nextTick, ref} from "vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {withAgentSceneText} from "./agent-text";

const props = defineProps<LabFixtureProps>();
const Messages = withAgentSceneText(AgentMessages);
const subject = useLabSubject<typeof AgentMessages>(() => props.input, ["open-contact", "retry-contacts", "open-session", "new-session", "show-list", "escape-search"]);

const docked = computed(() => props.scene.startsWith("docked"));
const expanded = computed(() => props.input?.props?.expanded === true);
const railWidth = computed(() => {
    if (!expanded.value) return 48;
    const match = /-(200|420)(?:-|$)/u.exec(props.scene);
    return match === null ? 260 : Number(match[1]);
});

const mainEl = ref<HTMLElement | null>(null);
const footEl = ref<HTMLElement | null>(null);
const placement = computed((): MessagesSegmentPlacement | undefined => {
    if (!docked.value) return undefined;
    return mainEl.value !== null && footEl.value !== null ? {kind: "rail", main: mainEl.value, foot: footEl.value} : {kind: "none"};
});

const frameRef = ref<InstanceType<typeof AgentMessages> | null>(null);
async function showList(tab: "bot" | "sessions"): Promise<void> {
    subject.write("model", "tab", tab);
    subject.write("props", "expanded", true);
    await nextTick();
    frameRef.value?.focusSearch(tab);
}
</script>

<template>
    <div class="flex h-[520px] max-w-full" :class="props.scene.includes('390') ? 'w-[390px]' : props.scene.startsWith('docked') ? 'w-[720px]' : 'w-[480px]'" :style="props.scene.includes('short') ? {height: '300px'} : undefined">
        <Messages ref="frameRef" data-lab-subject class="min-w-0 flex-1" v-bind="{...subject.bindings.value, ...(placement === undefined ? {} : {placement})}" @show-list="showList">
            <div class="grid h-full place-items-center text-sm text-[var(--text-muted)]">聊天区（AgentConversationView）</div>
            <template #sessions>
                <div class="flex flex-col gap-2 p-2 text-sm text-[var(--text-muted)]">
                    <input class="rounded border border-[var(--border-color)] bg-transparent px-2 py-1" placeholder="搜索会话" aria-label="搜索会话">
                    会话面板（AgentSessionPanel）
                </div>
            </template>
        </Messages>
        <nav v-if="docked" class="lab-rail" :class="{'lab-rail--expanded': expanded}" :style="{width: `${railWidth}px`}" aria-label="替身侧轨" data-lab-rail>
            <div class="lab-rail__entries"><span class="i-lucide-message-circle lab-rail__entry" aria-hidden="true"></span></div>
            <div ref="mainEl" class="lab-rail__main"></div>
            <div ref="footEl" class="lab-rail__foot"></div>
            <button type="button" class="lab-rail__expand" :aria-expanded="expanded" aria-label="展开" @click="subject.write('props', 'expanded', !expanded)">
                <span :class="expanded ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'" aria-hidden="true"></span>
            </button>
        </nav>
    </div>
</template>

<style scoped>
/* 工作台右轨（WorkbenchToolStrip 的视图段）的最小结构：收着一列，展开是两栏，48 一列贴外缘。 */
.lab-rail {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    height: 100%;
    padding-block: 6px;
    border-inline-start: var(--border-w) solid var(--border-color);
    background: var(--bg-panel);
    transition: width var(--motion-layout) var(--ease-layout);
}

.lab-rail--expanded {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-columns: minmax(0, 1fr) 48px;
    justify-items: center;
}

.lab-rail__entries {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-bottom: 6px;
}

.lab-rail--expanded .lab-rail__entries,
.lab-rail--expanded .lab-rail__foot,
.lab-rail--expanded .lab-rail__expand {
    grid-column: 2;
}

.lab-rail__entry {
    width: 20px;
    height: 20px;
    margin: 8px;
    color: var(--accent-text);
}

.lab-rail__main {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-height: 0;
    overflow: hidden;
}

.lab-rail--expanded .lab-rail__main {
    grid-row: 1 / -1;
    grid-column: 1;
    align-items: stretch;
    align-self: stretch;
    height: 100%;
    border-inline-end: var(--border-w) solid var(--border-color);
}

.lab-rail__foot {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
}

.lab-rail--expanded .lab-rail__foot {
    grid-row: 3;
}

.lab-rail__expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    margin-block: 6px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
}

.lab-rail--expanded .lab-rail__expand {
    grid-row: 4;
}
</style>
