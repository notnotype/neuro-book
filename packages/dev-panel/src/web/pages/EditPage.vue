<script setup lang="ts">
import {AlertDialog, Badge, Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter} from "vue-router";
import {useFileEditSession} from "../host/file-edit-session.js";
import {renderMarkdown} from "../host/markdown.js";
import {taskLabel, workLabel} from "../host/format.js";
import {loadStateOf, useResource} from "../host/panel-data.js";
import {docHref, taskHref, workHref} from "../host/routes.js";
import type {Meta} from "../host/types.js";
import ActionLink from "../parts/ActionLink.vue";
import DiffView from "../parts/DiffView.vue";
import FileEditor from "../parts/FileEditor.vue";
import LoadState from "../parts/LoadState.vue";
import PageShell from "../parts/PageShell.vue";
import TruncatedText from "../parts/TruncatedText.vue";
import UncommittedDialog from "../parts/UncommittedDialog.vue";
import WriteResult from "../parts/WriteResult.vue";

/**
 * 编辑页（`/edit?path=`）：只编辑主工作区里的文件（Work 与 Task 的 README、文档类产物、文档树上的文档），保存即在 master 上提交这一个路径。
 * 保存带打开时的哈希（`baseHash`）：别人在打开之后改过就不写，显示两版之间的差异（前端按行算）；目标有别人没提交的改动时先弹差异再确认。
 * 未保存的改动：站内跳转（左栏、链接、改 `?path=`、浏览器后退）用路由守卫拦，等面板自己的确认框（t15 阶段 4 第 5 批）；
 * 关标签页与刷新只能用原生的 `beforeunload`（浏览器不让自定义）。Ctrl+S（Mac 上 ⌘+S）保存。
 * 文件身份、基线与草稿、保存与冲突在 `host/file-edit-session.ts`（t15）；这里只接路由守卫、快捷键、剪贴板与模板。
 */
const route = useRoute();
const router = useRouter();
const path = computed(() => (typeof route.query.path === "string" ? route.query.path : null));
/** Work 或 Task 目录里的文件（README、文档类产物、计划……）属于谁：面包屑与找不到时的出口按它推（t15 阶段 4 第 5 批起不只 README）。 */
const record = computed(() => (path.value ? /^\.agents\/works\/([^/]+)\/(?:tasks\/([^/]+)\/)?.+$/u.exec(path.value) : null));
/** 面包屑按路径推出所属的 Work、Task；别的文件回到文档页里的它。 */
const crumbs = computed(() => {
    const value = path.value;
    const owner = record.value;
    const items: Array<{label: string; href?: string}> = [{label: "首页", href: "/"}];
    if (owner?.[1]) {
        items.push({label: workLabel(owner[1]), href: workHref(owner[1])});
        if (owner[2]) items.push({label: taskLabel(owner[2]), href: taskHref(owner[1], owner[2])});
    } else if (value) {
        items.push({label: "文档", href: "/docs"}, {label: value.slice(value.lastIndexOf("/") + 1), href: docHref("main", value)});
    }
    items.push({label: "编辑"});
    return items;
});
/**
 * 文件找不到（404）时去哪里：Work 或 Task 目录里的文件回到那个 Task 或 Work；别的文件回到文档页。
 * 不用面包屑里的“文档里的它”：那份文档同样找不到。
 */
const up = computed(() => {
    const owner = record.value;
    if (owner?.[1] && owner[2]) return {href: taskHref(owner[1], owner[2]), label: "回到 Task"};
    if (owner?.[1]) return {href: workHref(owner[1]), label: "回到 Work"};
    return {href: "/docs", label: "回到文档"};
});
const fileName = computed(() => (path.value ? path.value.slice(path.value.lastIndexOf("/") + 1) : "文件"));
const navigate = (href: string) => void router.push(href);
const session = useFileEditSession(path);
const {file, draft, dirty, write, saving, notice, uncommitted, mismatch} = session;
const meta = useResource<Meta>(() => "/api/meta", ["records"]);

const blocked = computed(() => {
    const writable = meta.data.value?.mainWritable;
    if (writable && !writable.ok) return `主工作区现在不能写（${writable.message ?? writable.code}）`;
    const data = file.data.value;
    if (data?.stagedRename) return "这个文件是暂存区里一次改名的一端，只提交它会拆开那次改名；先在终端处理暂存区";
    if (data && !data.editable) return data.reason?.message ?? "不能编辑";
    return null;
});
const previewHtml = computed(() => (path.value ? renderMarkdown(draft.value.replace(/^---\n[\s\S]*?\n---\n/u, ""), {checkoutKey: "main", path: path.value, artifactBase: meta.data.value?.artifactBase ?? null}) : ""));

async function copyDraft(): Promise<void> {
    try {
        await navigator.clipboard.writeText(draft.value);
        notice.value = {outcome: "info", title: "已复制你的改动", message: "载入新版本之后可以对照着重新改", items: [], notes: [], retry: false};
    } catch (error) {
        console.error("复制失败", error);
        notice.value = {outcome: "failure", title: "复制失败", message: "浏览器不让写剪贴板；手动全选编辑框里的文字复制", items: [], notes: [], retry: false};
    }
}

/**
 * 站内离开的确认框（面板自己的 `AlertDialog`，不用 `window.confirm`）：路由守卫返回 Promise，等开发者选（t15 阶段 4 第 5 批）。
 * - 框的寿命跟着它等的那一次导航：又来一次离开这一页的导航（框是模态的，只有浏览器后退、前进来得了），先把上一次按“留下”结算；
 *   回到这一页同一个文件的导航（后退之后再前进）不经守卫、直接放行，vue-router 会取消上一次，框也要跟着关（见 `router.beforeEach`）；
 * - “离开”“留下”各自结算；Esc 只发关闭，等 `closed`（关闭做完、焦点栈已释放）再按“留下”结算。点遮罩不会关（nb-ui 的 AlertDialog）；
 * - 留下时焦点回到打开框之前的元素，没有（或已不在页面上）就回到编辑框：AlertDialog 没有触发器时不归还焦点。
 */
const leaveOpen = ref(false);
let pendingLeave: ((leave: boolean) => void) | null = null;
let returnFocus: HTMLElement | null = null;
let stayed = false;
function settleLeave(leave: boolean): void {
    const settle = pendingLeave;
    pendingLeave = null;
    stayed = !leave;
    leaveOpen.value = false;
    settle?.(leave);
}
function askLeave(): Promise<boolean> {
    if (pendingLeave) settleLeave(false);
    returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    leaveOpen.value = true;
    return new Promise((resolve) => {
        pendingLeave = resolve;
    });
}
/** Esc 关掉框：关闭做完之后还没结算的按“留下”结算；留下时把焦点还回去。 */
function onLeaveDialogClosed(): void {
    if (pendingLeave) settleLeave(false);
    if (!stayed) return;
    const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>("textarea[aria-label='文件内容']");
    target?.focus();
    returnFocus = null;
}
/** 站内离开：保存在途时直接拒绝（这次保存照样会提交，离开不会丢掉它，等结果回来再走）；有未保存的改动时问。 */
async function mayLeave(): Promise<boolean> {
    if (saving.value) {
        notice.value = {outcome: "info", title: "正在保存", message: "等它完成再离开（等别的写入最长 30 秒）", items: [], notes: [], retry: false};
        return false;
    }
    return !dirty.value || await askLeave();
}
onBeforeRouteLeave(() => mayLeave());
onBeforeRouteUpdate((to) => to.query.path === route.query.path || mayLeave());
/** 回到这一页同一个文件的导航不经上面两个守卫：它会取消框在等的那一次，所以在这里按“留下”结算并关框。 */
const removeBeforeEach = router.beforeEach((to) => {
    if (pendingLeave && to.name === route.name && to.query.path === route.query.path) settleLeave(false);
});
onBeforeUnmount(() => {
    removeBeforeEach();
    if (pendingLeave) settleLeave(false);
});

/** Ctrl+S（Mac 上 ⌘+S）保存；不能保存时也拦下浏览器的“另存网页”，在操作栏写原因（保存在途时按钮已在转圈，不另写）。 */
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
const saveShortcut = isMac ? "⌘+S" : "Ctrl+S";
const shortcutNote = ref<string | null>(null);
watch(draft, () => {
    shortcutNote.value = null;
});
function onKeydown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== "s" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    // 按住不放的重复、有对话框开着（别人没提交的改动、离开确认）、正在保存：都不再处理。
    if (event.repeat || uncommitted.value !== null || leaveOpen.value || write.pending.value) return;
    if (blocked.value !== null) shortcutNote.value = blocked.value;
    else if (mismatch.value !== null) shortcutNote.value = "文件在你打开之后被改过，先处理上面的差异";
    else if (!dirty.value) shortcutNote.value = "没有改动，不用保存";
    else {
        shortcutNote.value = null;
        void session.save();
    }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
function guardUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value) return;
    event.preventDefault();
    event.returnValue = "";
}
onMounted(() => window.addEventListener("beforeunload", guardUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", guardUnload));
</script>

<template>
    <PageShell :crumbs="crumbs" :title="`编辑 ${fileName}`" @navigate="navigate">
        <template v-if="dirty" #status><Badge tone="warning" variant="soft" size="sm">未保存</Badge></template>
        <template v-if="path && file.data.value" #actions>
            <ActionLink :href="docHref('main', path)" icon="i-lucide-book-open" @navigate="navigate">看文档</ActionLink>
        </template>
        <template v-if="path" #meta><TruncatedText :text="path" mono /></template>
        <LoadState v-if="!path" :loading="false" :error="{message: '没有指定要编辑的文件'}" :retryable="false" />
        <template v-else>
            <LoadState v-bind="loadStateOf(file)" label="正在读取文件" :subject="`${path} 这个文件`" :up-href="up.href" :up-label="up.label" @navigate="navigate" @retry="file.reload()" />
            <template v-if="file.data.value">
                <p v-if="file.data.value.changedIn.length > 0" class="nbdev-hint">
                    这些分支改过它：{{ file.data.value.changedIn.map((entry) => entry.branch ?? entry.key).join("、") }}。在 master 上直接改，合并时可能与它们冲突。
                </p>
                <p v-if="file.data.value.uncommitted" class="nbdev-hint">
                    主工作区里这个文件有别人没提交的改动（{{ file.data.value.uncommitted.status.join("、") }}）；保存时会先给你看差异再确认。
                </p>
                <p v-if="file.data.value.kind === 'work_readme' || file.data.value.kind === 'task_readme'" class="nbdev-note">
                    frontmatter 的 schema、id、issueId 与 status 不能在这里改（改状态用 Work 或 Task 页的状态切换）；保存时 updated 会改成今天。
                </p>
                <p v-if="blocked" class="nbdev-warn">{{ blocked }}</p>
                <FileEditor v-model="draft" :preview-html="previewHtml" :readonly="blocked !== null || saving" :line-limit="file.data.value.lineLimit" @navigate="navigate" />
                <!-- 冲突的差异放在编辑器下面：出现时不把编辑器推下去（t15 阶段 3c）。 -->
                <section v-if="mismatch" class="nbdev-surface nbdev-surface-warn nbdev-stack p-3">
                    <p class="font-semibold">{{ mismatch.maybeMine ? "文件变了，多半是你刚才那次保存已经生效。与打开时相比：" : "文件在你打开之后被改过，没有保存。别人改了什么：" }}</p>
                    <DiffView :text="mismatch.diff || '（只有空白不同）'" />
                    <div class="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" @click="copyDraft">复制我的改动</Button>
                        <Button size="sm" variant="danger" @click="session.takeCurrent">{{ mismatch.maybeMine ? "载入新版本" : "载入新版本（丢掉我的改动）" }}</Button>
                    </div>
                </section>
                <!-- 操作栏贴在可视区底部：保存、放弃与这次保存的结果都在这里，结果出现时不推动编辑器（t15 阶段 3c）。 -->
                <div class="nbdev-edit-bar nbdev-stack sticky bottom-0 z-10 border-t py-3">
                    <WriteResult v-if="notice" :notice="notice" @dismiss="notice = null" @retry="session.save()" />
                    <div class="flex flex-wrap items-center gap-2">
                        <Button :loading="write.pending.value" :disabled="!dirty || blocked !== null || mismatch !== null" :aria-keyshortcuts="isMac ? 'Meta+S' : 'Control+S'" @click="session.save()">保存并提交 <kbd class="nbdev-save-kbd">{{ saveShortcut }}</kbd></Button>
                        <Button variant="ghost" :disabled="!dirty || write.pending.value" @click="session.discard">放弃改动</Button>
                        <span v-if="write.slow.value" class="nbdev-note">在等别的写入完成…</span>
                        <!-- 常驻的实时区域：内容变了读屏才会播报；插入时就带着字的不播报。 -->
                        <span class="nbdev-note" role="status">{{ shortcutNote && !write.slow.value ? `${saveShortcut}：${shortcutNote}` : "" }}</span>
                    </div>
                </div>
                <AlertDialog :open="leaveOpen" title="有未保存的改动" description="离开这一页会丢掉还没保存的改动。" confirm-label="离开，丢掉改动" cancel-label="留下" tone="neutral" @update:open="(open) => (leaveOpen = open)" @confirm="settleLeave(true)" @cancel="settleLeave(false)" @closed="onLeaveDialogClosed" />
                <UncommittedDialog :open="uncommitted !== null" :path="path" :changes="uncommitted?.changes ?? null" :pending="write.pending.value" @confirm="uncommitted && session.save(true, uncommitted.currentHash)" @cancel="uncommitted = null" />
            </template>
        </template>
    </PageShell>
</template>

<style scoped>
.nbdev-edit-bar {
    border-color: var(--divider);
    background: var(--bg-main);
}
.nbdev-save-kbd {
    margin-left: 0.25em;
    font-family: var(--font-mono);
    font-size: 0.85em;
    opacity: 0.85;
}
</style>
