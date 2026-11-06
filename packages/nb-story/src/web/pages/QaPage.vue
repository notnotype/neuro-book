<script lang="ts">
import type {ComposerView as StoredComposer} from "@notnotype/nb-agent-ui";

/**
 * 输入框的存档（草稿、输入历史、模式与这个对话选的模型和推理档），按“书 id + 对话”记在模块里：去设置页（“管理模型…”）
 * 再回来页面重建，草稿还在。只在这一个标签页的内存里，刷新就没了。
 */
const composerStore = new Map<string, StoredComposer>();
/** 交给过视图的最大草稿版本号：换对话时的新版本要大过它（受理发送时 acceptSubmission 在当前版本上加一）。 */
let shownVersion = 0;
</script>

<script setup lang="ts">
// 书里的“问答”页（docs/specs/story/viewer.md 的问答页，w00024 t13 决定 6 到 10、15 到 18）：对话列表在宽屏左栏、窄屏
// 顶栏的下拉；对话视图用 nb-agent-ui，数据经 qa/source.ts（一个对话一个）；出处与人名在右侧抽屉打开。
import {computed, onBeforeUnmount, provide, ref, shallowRef, watch, watchEffect} from "vue";
import {useRouter} from "vue-router";
import {AlertDialog, Banner, Button, IconButton, Popover} from "@notnotype/nb-ui/components";
import {acceptSubmission, applyComposerAction, createAgentContext, createAgentViewRegistry, type AgentConversationContext, type AgentSessionListItem, type AgentViewAction, type ComposerView, type MessageView} from "@notnotype/nb-agent-ui";
import {AgentConversationView, AgentSessionList, builtinMessageActionsContribution, builtinRolesContribution} from "@notnotype/nb-agent-ui/vue";
import {decodeTarget} from "@notnotype/nb-markdown";
import {provideMarkdownHost} from "@notnotype/nb-markdown/host";
import {PromptEditor, PromptTextView} from "@notnotype/nb-markdown/prompt";

import type {QaConfig} from "../../contract/config-schema";
import type {QaRunView, ViewerResult} from "../../contract/contract";
import {normalizeRef} from "../../contract/refs";
import {formatAt, useBook} from "../host/book";
import {StoryCallError, useStoryClient} from "../host/client";
import {readModeNoticeSeen, writeModeNoticeSeen} from "../host/prefs";
import {currentPosition, highestPosition} from "../../contract/qa-record";
import ModeNotice from "../parts/ModeNotice.vue";
import AnswerCard from "../qa/AnswerCard.vue";
import {REF_SCHEME} from "../qa/link-refs";
import {CHAPTER_SCHEME, createMentionSearch, ENTITY_SCHEME, MENTION_LIMIT, mentionMenu, mentionPlainText, type MentionEntity} from "../qa/mentions";
import {QA_LINKABLE, refChapter} from "../qa/linkable";
import {createNameResolver, QA_NAME_LOOKUP} from "../qa/names";
import {candidateInfos, clampThinking, contextTokensOf, priceCurrency, resolveChoice, type CatalogProvider} from "../qa/models";
import {createQaSource, type QaSource, type QaSourceState} from "../qa/source";
import QaInspector from "../qa/QaInspector.vue";
import QaPositionControl from "../qa/QaPositionControl.vue";
import QaStatusBar from "../qa/QaStatusBar.vue";
import StoryMarkdown from "../qa/StoryMarkdown.vue";
import {storyToolsContribution} from "../qa/tools";
import {UNVERIFIED_REFS} from "../qa/turns";
import UnverifiedRefs from "../qa/UnverifiedRefs.vue";

const book = useBook();
const client = useStoryClient();
const router = useRouter();

provideMarkdownHost({report: (event, message, error) => console.warn({event, error}, message)});

// nb-story 的 Agent 没有文件与命令工具：不登记内置工具（read 同名会冲突）与内置输入框命令（`/` 命令在这里没人处理）。
// 输入框只登记 `@`（引用人物、章节与段落，w00024 t15 决定 2）；问题前面的 `+` 插 `@` 打开同一个菜单（t16 决定 1）。
const registry = createAgentViewRegistry([
    builtinRolesContribution,
    builtinMessageActionsContribution,
    storyToolsContribution(AnswerCard),
    {source: "nb-story:qa-entries", entries: [{id: "nb-story.unverified-refs", customType: UNVERIFIED_REFS, component: UnverifiedRefs}]},
    {source: "nb-story:qa-mentions", triggers: [{id: "nb-story.mention", char: "@"}]},
    {source: "nb-story:qa-insert", toolbarButtons: [{id: "nb-story.insert-ref", icon: "i-lucide-plus", label: "插入引用（人物、章节、段落），同 @", placement: "leading", trigger: "@"}]},
]);
const renderers = {markdown: StoryMarkdown, promptEditor: PromptEditor, promptTextView: PromptTextView};

const MODE_LABEL = {graph: "图当目录", full: "全读"} as const;
const MODES = [
    {key: "graph", label: "图当目录", icon: "i-lucide-network"},
    {key: "full", label: "全读", icon: "i-lucide-book-open"},
];

// ---- 人名（决定 16）：按查看器的位置与数据版本查，卡片经注入拿到 ----
const resolveName = createNameResolver(async name => {
    try {
        return (await client.call("entity.card", {book: book.bookId, at: book.at.value, entity: name})).id;
    } catch (error) {
        // 找不到、重名都是“不做成链接”；别的失败抛给缓存（不记下，下次再查），这一次同样不做成链接。
        if (error instanceof StoryCallError && (error.code === "entity_not_found" || error.code === "entity_ambiguous")) return null;
        console.warn({error, name}, "按名字查人物失败");
        throw error;
    }
});
const nameScope = () => `${book.bookId}@${formatAt(book.at.value)}#${book.dataVersion.value}`;
provide(QA_NAME_LOOKUP, {scope: nameScope, resolve: who => resolveName(nameScope(), who)});
// 没抽取的尾部章（w00024 t30）：问答能读到，查看器没有。答案里指向那些章的出处保持纯文字，不发 reference.open。
provide(QA_LINKABLE, chapter => chapter <= book.info.chapters);
/** 已提交加未抽取尾部各章的段数：位置控件、草稿位置、@ 的章节与段落候选都用这一张表。 */
const fullParagraphs = computed(() => [...book.info.paragraphs, ...book.info.unextracted]);

// ---- 设置：没配置时输入框停用，给“去设置”；候选模型与目录给输入框的模型下拉 ----
const config = shallowRef<QaConfig | null>(null);
const configured = ref<boolean | null>(null);
void client.call("config.get", {}).then(
    result => {
        configured.value = result.state === "valid";
        config.value = result.state === "valid" ? result.config : null;
    },
    (error: unknown) => {
        console.warn({error}, "读问答配置失败");
        configured.value = false;
    },
);
const catalog = shallowRef<readonly CatalogProvider[]>([]);
void client.call("models.catalog", {}).then(
    result => (catalog.value = result.providers),
    // 读不到目录时候选照样列出（灰掉，写“目录里没有这个模型”），发问时由服务端报真正的原因。
    (error: unknown) => console.warn({error}, "读模型目录失败"),
);
const candidates = computed(() => (config.value === null ? new Map() : candidateInfos(config.value, catalog.value)));

// ---- 对话列表 ----
type Row = ViewerResult<"qa.list">["conversations"][number];
const rows = shallowRef<Row[]>([]);
const broken = shallowRef<ViewerResult<"qa.list">["broken"]>([]);
const listState = ref<"loading" | "ready" | "error">("loading");
const listError = ref<string | undefined>(undefined);
let listToken = 0;
async function loadList(): Promise<void> {
    const token = (listToken += 1);
    if (rows.value.length === 0) listState.value = "loading";
    try {
        const result = await client.call("qa.list", {book: book.bookId});
        if (token !== listToken) return;
        rows.value = result.conversations;
        broken.value = result.broken;
        listState.value = "ready";
    } catch (error) {
        if (token !== listToken) return;
        // 已经有行时（轮询中途）一次失败只留诊断，列表不换成错误提示；下一次轮询再试。
        if (listState.value === "ready") {
            console.warn({error}, "重取问答对话列表失败");
            return;
        }
        listState.value = "error";
        listError.value = error instanceof Error ? error.message : String(error);
    }
}
void loadList();
// 有对话在跑时每 5 秒重取一次列表（状态与时间会变）；都不在跑时不轮询。
const anyRunning = computed(() => rows.value.some(row => row.run?.state === "running"));
watchEffect(onCleanup => {
    if (!anyRunning.value) return;
    const timer = setInterval(() => void loadList(), 5000);
    onCleanup(() => clearInterval(timer));
});
// 列表的时间按 now 写，每分钟更新（过了午夜“今天”变“昨天”）。
const minute = ref(Date.now());
const minuteTimer = setInterval(() => (minute.value = Date.now()), 60_000);
onBeforeUnmount(() => clearInterval(minuteTimer));

function before(a: {chapter: number; paragraph?: number}, b: {chapter: number; paragraph?: number}): boolean {
    return a.chapter < b.chapter || (a.chapter === b.chapter && (a.paragraph ?? Number.POSITIVE_INFINITY) < (b.paragraph ?? Number.POSITIVE_INFINITY));
}
const items = computed<AgentSessionListItem[]>(() => [
    ...rows.value.map(row => ({
        id: row.id,
        title: mentionPlainText(row.question),
        description: `${row.turns === 0 ? "第 1 轮" : `${row.turns} 轮`} · ${MODE_LABEL[row.mode]} · 读到 ${formatAt(row.currentAt)}`,
        updatedAt: Date.parse(row.updatedAt) || 0,
        status: row.run?.state === "running" ? ("running" as const) : row.status === "failed" ? ("error" as const) : row.status === "interrupted" ? ("interrupted" as const) : ("idle" as const),
        // 警告按整个对话出现过的最高位置：位置往回调不能解除旧答案里可能带着后文的警告（输出 53）。
        ...(before(book.at.value, row.highestAt) ? {note: {text: `读到 ${formatAt(row.highestAt)}，晚于你现在的位置`, icon: "i-lucide-eye"}} : {}),
    })),
    // 读不成的记录单列一行，只能删除（决定 18）。
    ...broken.value.map(item => ({id: item.id, title: "损坏的记录", description: item.problem, updatedAt: 0, status: "error" as const, note: {text: "只能删除"}})),
]);
const brokenIds = computed(() => new Set(broken.value.map(item => item.id)));

// ---- 选中的对话与它的数据源 ----
const selectedId = computed(() => book.qaConversation.value);
/** 正在发起一轮（qa.start 还没返回，或续问后数据源还没读到它）的对话；新对话是 NEW。 */
const starting = ref<string | null>(null);
/** 发起、停止或删除失败的原因，写在输入框上方；草稿不清。换对话时清掉。 */
const startError = ref<string | null>(null);
const sourceState = shallowRef<QaSourceState | null>(null);
let source: QaSource | null = null;
watch(
    selectedId,
    id => {
        source?.dispose();
        source = null;
        sourceState.value = null;
        startError.value = null;
        if (id === null || brokenIds.value.has(id)) return;
        source = createQaSource({client, book: book.bookId, conversation: id, onChange: state => (sourceState.value = state)});
        sourceState.value = source.state();
    },
    {immediate: true},
);
onBeforeUnmount(() => source?.dispose());

const run = computed<QaRunView | null>(() => sourceState.value?.run ?? null);
const running = computed(() => run.value?.state === "running");
const record = computed(() => sourceState.value?.record ?? null);
// 看着的这一轮结束了：列表里它的状态、轮数与时间要跟着变。
watch(running, (now, before) => {
    if (before && !now) void loadList();
});
const title = computed(() => mentionPlainText(record.value?.turns[0]?.question ?? run.value?.question ?? ""));
/** 这个对话下一问用的位置（改过位置的取改后的）；还没有记录的首轮取运行里的。 */
const conversationAt = computed(() => (record.value === null ? (run.value?.at ?? null) : currentPosition(record.value)));
/** 整个对话出现过的最高位置：剧透警告按它判断。 */
const highestAt = computed(() => (record.value === null ? (run.value?.at ?? null) : highestPosition(record.value)));
const conversationMode = computed(() => record.value?.mode ?? run.value?.mode ?? null);

// ---- 输入框的 `@` 引用：候选按这个对话的阅读位置给（新对话用查看器的位置），晚于它的对象不在名单里 ----
/** 新对话第一问的章；null 跟着查看器的位置。@ 候选与提交用它，不按查看器的位置给后文的人物。 */
const draftChapter = ref<number | null>(null);
const mentionAt = computed(() => (selectedId.value === null ? (draftChapter.value === null ? book.at.value : {chapter: draftChapter.value}) : (conversationAt.value ?? book.at.value)));
/** 对象与记录只到抽取进度：阅读位置在没抽取的尾部里时，查对象用抽取进度的位置。 */
const graphAtOf = (at: {chapter: number; paragraph?: number}): {chapter: number; paragraph?: number} => (at.chapter > book.info.chapters ? book.info.extractedThrough : at);
/** 人物取到一次加一：services 换一个新的菜单函数，编辑器按当前查询重取（resolveTriggerMenu 的约定）。 */
const mentionTick = ref(0);
const mentions = createMentionSearch({
    async search(query): Promise<MentionEntity[]> {
        // 空查询给提及最多的几个人物（决定 4）：多取一些再筛人物与身份。
        const result = await client.call("entities.list", {book: book.bookId, at: graphAtOf(mentionAt.value), ...(query === "" ? {limit: 20} : {query, limit: MENTION_LIMIT})});
        const entities = result.items.map(item => ({id: item.id, label: item.label, kind: item.kind, names: item.names.top}));
        return query === "" ? entities.filter(item => item.kind === "person" || item.kind === "persona").slice(0, 6) : entities;
    },
    onChange: () => (mentionTick.value += 1),
});
// 换了位置先取好空查询的人物：第一次打 `@` 就有人物，菜单的高亮也不会先落在章节项上、人物到了还停在那里。
watch(
    [() => formatAt(mentionAt.value), book.dataVersion],
    () => {
        mentions.reset();
        mentions.lookup("");
        mentionTick.value += 1;
    },
    {immediate: true},
);
onBeforeUnmount(() => mentions.dispose());
const services = computed(() => {
    void mentionTick.value;
    const at = mentionAt.value;
    return {
        resolveTriggerMenu: (context: {trigger: string; query: string}) =>
            context.trigger === "@" ? mentionMenu(context.query, {entities: mentions.lookup(context.query), book: {...book.info, paragraphs: fullParagraphs.value}, at}) : {items: []},
    };
});

// ---- 输入框：存档按对话各存一份（见上面的 composerStore） ----
// 换对话时交给视图的草稿总带一个新版本号：输入框只在版本变了时换内容（nb-agent-ui README 的“草稿”）。
const NEW = "";
const baseComposer = createAgentContext({}).composer;
const storeKey = (id: string | null): string => `${book.bookId}\u0000${id ?? NEW}`;
function composerOf(id: string | null): ComposerView {
    const saved = composerStore.get(storeKey(id)) ?? {...baseComposer, modes: id === null ? MODES : [], mode: "graph"};
    shownVersion += 1;
    return {...saved, draft: {...saved.draft, version: shownVersion}};
}
const composer = shallowRef<ComposerView>(composerOf(selectedId.value));
watch(selectedId, id => (composer.value = composerOf(id)));
function setComposer(next: ComposerView): void {
    composerStore.set(storeKey(selectedId.value), next);
    shownVersion = Math.max(shownVersion, next.draft.version);
    composer.value = next;
}

/**
 * 这一轮用的模型与推理档。存档里的 `modelKey` 为 null 表示这个对话还没选过（规则见 `resolveChoice`）。`requested` 是选的档，
 * `thinking` 是按所选模型夹过、真正发出的档。
 */
const choice = computed(() => {
    if (config.value === null) return null;
    const lastTurn = run.value?.model ?? record.value?.turns.at(-1)?.model ?? null;
    const {model, requested} = resolveChoice(config.value, composer.value, lastTurn);
    return {model, requested, thinking: clampThinking(candidates.value.get(model)?.efforts ?? [], requested)};
});
/** 交给视图的输入框：存档叠上候选与所选模型的推理档。 */
const viewComposer = computed<ComposerView>(() => {
    const current = choice.value;
    if (current === null) return composer.value;
    return {
        ...composer.value,
        models: [...candidates.value.values()].map(info => info.view),
        modelKey: current.model,
        thinkingLevels: [...(candidates.value.get(current.model)?.efforts ?? [])],
        thinking: current.thinking,
    };
});

const removeOpen = ref(false);
const listOpen = ref(false);

const now = ref(Date.now());
watchEffect(onCleanup => {
    if (!running.value) return;
    const timer = setInterval(() => (now.value = Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
});

const ctx = computed<AgentConversationContext>(() => {
    const state = sourceState.value;
    const id = selectedId.value;
    const canContinue = id === null || (state?.phase === "ready" && state.continuable.ok);
    const startingHere = starting.value === (id ?? NEW);
    return createAgentContext({
        session: id === null ? null : {id, title: title.value, summary: "", profileName: "问答", profileIcon: "i-lucide-messages-square", archived: false, summaryState: "idle"},
        availability:
            id !== null && state?.phase === "loading"
                ? {status: "loading", message: "", actions: []}
                : state?.phase === "failed"
                  ? {status: "load-error", message: state.error?.message ?? "读不到这个对话", actions: []}
                  : {status: "ready", message: "", actions: []},
        // 模式、模型与推理档运行中以外都能改（canChangeRuntime 缺省为假，不给时模式按钮一直点不动）。
        interaction: {canSend: configured.value === true && canContinue && !running.value && !startingHere, canStop: running.value, canChangeRuntime: !running.value && !startingHere, canManageModels: true},
        run: running.value || startingHere ? {status: "running", phase: ""} : {status: "idle", phase: ""},
        messages: state?.messages ?? ([] as MessageView[]),
        composer: viewComposer.value,
        usage: {contextTokens: contextTokensOf(state?.messages ?? []), contextLimit: choice.value === null ? null : (candidates.value.get(choice.value.model)?.contextWindow ?? null)},
        now: now.value,
    });
});

// ---- 操作 ----
function openTarget(raw: string): void {
    // 正文里的出处链接经 Markdown 解析后是编码过的地址（“—”成了 %E2%80%94），先解码再按标准写法打开。
    const target = decodeTarget(raw);
    // 兜底：指向没抽取的尾部章的出处与章引用（查看器没有那几章）不打开。渲染层已把自动识别的出处降成纯文字，
    // 这里拦住模型显式写的链接与用户 @ 的引用，免得抽屉报“没有这一章”。
    const beyondViewer = (chapter: number | null): boolean => chapter !== null && chapter > book.info.chapters;
    if (target.startsWith(REF_SCHEME)) {
        if (!beyondViewer(refChapter(target.slice(REF_SCHEME.length)))) book.openSource(normalizeRef(target.slice(REF_SCHEME.length)));
    } else if (target.startsWith(ENTITY_SCHEME)) book.openCard(target.slice(ENTITY_SCHEME.length));
    // 引用一章：打开这一章开头的原文（w00024 t15 决定 3）。
    else if (target.startsWith(CHAPTER_SCHEME)) {
        const chapter = target.slice(CHAPTER_SCHEME.length);
        if (/^\d+$/u.test(chapter) && !beyondViewer(Number(chapter))) book.openSource(`${Number(chapter)}.1`);
    }
}

async function submit(text: string): Promise<void> {
    const question = text.trim();
    // 发出时的对话与草稿：等受理的这段时间里用户可能换了对话，回来的结果只写回发出的那一个（草稿按对话各存一份）。
    const target = selectedId.value;
    const key = target ?? NEW;
    if (question === "" || starting.value === key) return;
    const sent = composer.value;
    const picked = choice.value;
    const stillHere = () => (selectedId.value ?? NEW) === key;
    starting.value = key;
    startError.value = null;
    try {
        const started = await client.call("qa.start", {
            book: book.bookId,
            question,
            ...(target === null ? {mode: sent.mode === "full" ? ("full" as const) : ("graph" as const), at: draftChapter.value === null ? book.at.value : {chapter: draftChapter.value}} : {conversation: target}),
            ...(picked === null ? {} : {model: picked.model, ...(picked.thinking === null ? {} : {thinking: picked.thinking as NonNullable<QaConfig["model"]["thinking"]>})}),
        });
        // 受理了才清空草稿；失败时草稿留着，原因写在输入框上方。新对话的草稿（含输入历史）带到这个对话下，模式只在新对话时可选。
        const accepted = acceptSubmission(sent, text);
        if (target === null) {
            draftChapter.value = null;
            composerStore.delete(storeKey(null));
            composerStore.set(storeKey(started.conversation), {...accepted, modes: []});
            if (stillHere()) book.qaConversation.value = started.conversation;
        } else if (stillHere()) {
            setComposer(accepted);
            // 等数据源读到这一轮再放开“正在发起”：否则这段时间页面像是空闲的，还能再发一次。
            await source?.refresh();
        } else composerStore.set(storeKey(target), accepted);
        void loadList();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (stillHere()) startError.value = message;
        else console.warn({error, conversation: target}, "问答开始失败（已经换到别的对话）");
    } finally {
        if (starting.value === key) starting.value = null;
    }
}

async function copy(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        console.warn({error}, "复制失败");
    }
}

/** 答案卡片复制成文字：结论、谁知道什么或分点、依据、说明与覆盖范围。 */
function answerText(args: unknown): string {
    const value = (args ?? {}) as {conclusion?: string; conclusionType?: string; knowledge?: {who: string; state: string; how: string; refs: string[]}[]; points?: {text: string; refs: string[]}[]; evidence?: string[]; explanation?: string; coverage?: string};
    const lines = [`结论（${value.conclusionType ?? ""}）：${value.conclusion ?? ""}`];
    for (const row of value.knowledge ?? []) lines.push(`- ${row.who}：${row.state}。${row.how}（${row.refs.join("、")}）`);
    for (const point of value.points ?? []) lines.push(`- ${point.text}（${point.refs.join("、")}）`);
    lines.push(`依据：${(value.evidence ?? []).join("、")}`, `说明：${value.explanation ?? ""}`, `覆盖范围：${value.coverage ?? ""}`);
    return lines.join("\n");
}

// ---- 会话状态（t24）：状态条与上下文检查器，数据取自对话里的助手消息用量 ----
const inspectorOpen = ref(false);
const statusMessages = computed(() => sourceState.value?.messages ?? []);
const statusLimit = computed(() => (choice.value === null ? null : (candidates.value.get(choice.value.model)?.contextWindow ?? null)));
/**
 * 费用的币种：这个对话用过的模型（已有的轮与正在跑的这一轮）在目录里写的单价币种。只有一种就用它；用过不同币种的模型时
 * 为 null，不把不同币种的金额加在一起；都没写单价时费用本来就不显示。币种取自模型而不是输入框当前选的模型。
 */
const statusCurrency = computed<string | null>(() => {
    const refs = new Set([...(record.value?.turns.map(turn => turn.model) ?? []), ...(run.value?.model === undefined ? [] : [run.value.model])]);
    const currencies = new Set([...refs].map(ref => priceCurrency(catalog.value, ref)).filter((currency): currency is string => currency !== null));
    return currencies.size > 1 ? null : ([...currencies][0] ?? "CNY");
});

// ---- 阅读位置（t25）：已有的对话改位置立刻写进会话，新对话改的是第一问的位置 ----
const changingPosition = ref(false);
const positionAt = computed(() => {
    if (selectedId.value !== null) return conversationAt.value;
    return draftChapter.value === null ? book.at.value : {chapter: draftChapter.value, paragraph: fullParagraphs.value[draftChapter.value - 1] ?? 1};
});
/** 阅读位置在没抽取的尾部里：图只到抽取进度，之后只能读原文。 */
const beyondGraph = computed(() => positionAt.value !== null && positionAt.value.chapter > book.info.chapters);
/** 位置控件不能改的原因；能改时为 null。 */
const positionBlock = computed<string | null>(() => {
    if (selectedId.value === null) return null;
    if (running.value) return "对话正在运行，等这一轮结束后再改";
    if (conversationMode.value === "full") return "全读对话读的是开始时的原文，阅读位置不能改，请开新对话";
    if (sourceState.value?.phase === "ready" && !sourceState.value.continuable.ok) return `不能续问，也就不能改位置：${sourceState.value.continuable.reason}`;
    return null;
});
async function onPositionChange(chapter: number): Promise<void> {
    const target = selectedId.value;
    if (target === null) {
        draftChapter.value = chapter;
        return;
    }
    changingPosition.value = true;
    startError.value = null;
    try {
        await client.call("qa.position", {book: book.bookId, conversation: target, at: {chapter}});
        if (selectedId.value === target) await source?.refresh();
        void loadList();
    } catch (error) {
        if (selectedId.value === target) startError.value = error instanceof Error ? error.message : String(error);
        else console.warn({error, conversation: target}, "改阅读位置失败（已经换到别的对话）");
    } finally {
        changingPosition.value = false;
    }
}

/** 第一次切换读书方式要先弹说明（t26）：等用户确认，这期间模式不变。 */
const pendingMode = ref<"graph" | "full" | null>(null);
function confirmMode(): void {
    const mode = pendingMode.value;
    pendingMode.value = null;
    if (mode === null) return;
    writeModeNoticeSeen();
    const next = applyComposerAction(composer.value, {type: "mode.set", mode});
    if (next !== null) setComposer(next);
}

function handle(action: AgentViewAction): void {
    if (action.type === "mode.set" && !readModeNoticeSeen()) {
        pendingMode.value = action.mode === "full" ? "full" : "graph";
        return;
    }
    // 换模型或推理档前先把“没选过”落成当前的选择：不然换了模型，原来缺省的推理档就丢了。
    const current = choice.value;
    const base = (action.type === "model.set" || action.type === "thinking.set") && current !== null ? {...composer.value, modelKey: current.model, thinking: current.requested} : composer.value;
    const next = applyComposerAction(base, action);
    if (next !== null) {
        setComposer(next);
        return;
    }
    switch (action.type) {
        case "composer.submit":
            void submit(action.text);
            return;
        case "composer.stop":
            if (selectedId.value !== null) void client.call("qa.stop", {book: book.bookId, conversation: selectedId.value}).catch((error: unknown) => (startError.value = error instanceof Error ? error.message : String(error)));
            return;
        case "session.select":
            book.qaConversation.value = action.sessionId;
            listOpen.value = false;
            return;
        case "session.create":
            book.qaConversation.value = null;
            listOpen.value = false;
            return;
        case "sessions.refresh":
            void loadList();
            return;
        case "model.manage":
            void router.push("/settings");
            return;
        case "reference.open":
            openTarget(action.target);
            return;
        case "link.open":
            window.open(action.href, "_blank", "noopener,noreferrer");
            return;
        case "message.copy": {
            const message = ctx.value.messages.find(item => item.id === action.messageId);
            if (message?.kind === "assistant") void copy(message.text);
            else if (message?.kind === "user") void copy(message.blocks.map(block => (block.kind === "text" ? block.text : "")).join(""));
            return;
        }
        case "tool.copy": {
            const call = ctx.value.messages.flatMap(message => (message.kind === "assistant" ? message.toolCalls : [])).find(item => item.id === action.toolCallId);
            if (call !== undefined) void copy(call.name === "answer" ? answerText(call.args) : (call.result?.text ?? ""));
            return;
        }
        default:
            // 其余（附件、分支、改写历史……）这里不支持，视图也不会给入口。
            return;
    }
}

async function removeConversation(): Promise<void> {
    const id = selectedId.value;
    if (id === null) return;
    try {
        await client.call("qa.remove", {book: book.bookId, id});
        composerStore.delete(storeKey(id));
        book.qaConversation.value = null;
    } catch (error) {
        startError.value = `删除失败：${error instanceof Error ? error.message : String(error)}`;
    }
    void loadList();
}

// ---- 版式 ----
const wide = computed(() => book.tier.value === "wide");
const behindViewer = computed(() => highestAt.value !== null && before(book.at.value, highestAt.value));
const aheadOfViewer = computed(() => conversationAt.value !== null && before(conversationAt.value, book.at.value));
const unsaved = computed(() => {
    const saved = run.value?.saved;
    return run.value?.state === "ended" && saved?.ok === false ? `这一轮没有保存（${saved.reason === "conflict" ? "这个对话在别处被改了或删了" : saved.reason === "book_not_found" ? "书被删了或换了一代" : (saved.message ?? saved.reason)}）` : null;
});
</script>

<template>
    <div class="qa-page" data-qa-page>
        <aside v-if="wide" class="qa-list">
            <AgentSessionList :items="items" :selected-id="selectedId" :state="listState" :error-message="listError" :now="minute" locale="zh-CN" :labels="{title: '对话', create: '新对话', empty: '还没有对话', untitled: '新对话'}" @action="handle" />
        </aside>
        <section class="qa-main">
            <header class="qa-bar">
                <Popover v-if="!wide" v-model:open="listOpen" align="start" content-class="w-[min(340px,92vw)] max-h-[60vh] overflow-y-auto p-0">
                    <template #trigger>
                        <button type="button" class="qa-switch" data-qa-switch>
                            <span class="i-lucide-messages-square shrink-0" />
                            <span class="truncate">{{ selectedId === null ? "新对话" : title || "对话" }}</span>
                            <span class="i-lucide-chevron-down shrink-0 text-[var(--text-muted)]" />
                        </button>
                    </template>
                    <AgentSessionList :items="items" :selected-id="selectedId" :state="listState" :error-message="listError" :now="minute" locale="zh-CN" :header="false" :labels="{empty: '还没有对话', untitled: '新对话'}" @action="handle" />
                </Popover>
                <template v-if="selectedId !== null && conversationAt !== null">
                    <span v-if="wide" class="qa-title" :title="title">{{ title }}</span>
                    <QaPositionControl v-if="positionAt" :at="positionAt" :paragraphs="fullParagraphs" :max-chapter="fullParagraphs.length" :disabled-reason="positionBlock" :busy="changingPosition" @change="onPositionChange" />
                    <span v-if="beyondGraph" class="qa-meta" data-qa-beyond-graph>图只抽到第 {{ book.info.chapters }} 章，之后只读原文</span>
                    <span v-if="conversationMode" class="qa-meta">{{ MODE_LABEL[conversationMode] }}</span>
                    <span v-if="behindViewer && highestAt" class="qa-warn" data-qa-ahead><span class="i-lucide-eye" />这个对话读到过 {{ formatAt(highestAt) }}，晚于你现在的位置 {{ formatAt(book.at.value) }}，答案可能含后文</span>
                    <span v-else-if="aheadOfViewer" class="qa-meta">早于你现在的位置 {{ formatAt(book.at.value) }}</span>
                </template>
                <template v-else-if="selectedId === null && positionAt">
                    <QaPositionControl :at="positionAt" :paragraphs="fullParagraphs" :max-chapter="fullParagraphs.length" :disabled-reason="null" :busy="false" @change="onPositionChange" />
                    <span v-if="beyondGraph" class="qa-meta" data-qa-beyond-graph>图只抽到第 {{ book.info.chapters }} 章，之后只读原文</span>
                    <span class="qa-meta">新对话从这里读起</span>
                </template>
                <span class="ml-auto" />
                <Button v-if="running" size="sm" variant="secondary" icon-class="i-lucide-square" data-qa-stop @click="handle({type: 'composer.stop'})">停止</Button>
                <AlertDialog
                    v-if="selectedId !== null"
                    v-model:open="removeOpen"
                    title="删除这个对话"
                    :description="running ? '这个对话正在回答，会先停下再删除。删除后不能恢复。' : '删除后不能恢复。'"
                    confirm-label="删除"
                    tone="danger"
                    @confirm="removeConversation"
                >
                    <template #trigger>
                        <IconButton size="sm" icon-class="i-lucide-trash-2" aria-label="删除这个对话" data-qa-remove />
                    </template>
                </AlertDialog>
                <IconButton v-if="!wide" size="sm" icon-class="i-lucide-square-pen" aria-label="新对话" @click="handle({type: 'session.create'})" />
            </header>

            <div v-if="configured === false || unsaved || sourceState?.detached || sourceState?.logProblem || (selectedId !== null && sourceState?.phase === 'ready' && !sourceState.continuable.ok && !running) || startError || brokenIds.has(selectedId ?? '')" class="qa-notices">
                <Banner v-if="configured === false" tone="warning" title="还没有配置问答用的模型" message="先在设置页填好模型，才能提问。">
                    <template #actions><RouterLink to="/settings" class="qa-link">去设置</RouterLink></template>
                </Banner>
                <Banner v-if="brokenIds.has(selectedId ?? '')" tone="danger" title="这份记录读不出来" message="只能删除。" />
                <Banner v-if="unsaved" tone="warning" :message="unsaved" data-qa-unsaved />
                <Banner v-if="sourceState?.detached" tone="warning" message="这个对话在别处（命令行）也续问了，这一轮基于较早的记录，结束后不会保存。" />
                <Banner v-if="sourceState?.logProblem" tone="info" :message="`过程没有保留（${sourceState.logProblem}），只显示每一轮的问题与结果。`" />
                <Banner v-else-if="selectedId !== null && sourceState?.phase === 'ready' && !sourceState.continuable.ok && !running" tone="info" :message="`不能续问：${sourceState.continuable.reason}`" />
                <Banner v-if="startError" tone="danger" :message="startError" dismissible data-qa-start-error @dismiss="startError = null" />
            </div>

            <div class="qa-view">
                <AgentConversationView :ctx="ctx" :services="services" :registry="registry" :renderers="renderers" locale="zh-CN" :header="false" process-disclosure="live" composer-layout="inline" @action="handle" />
            </div>
            <QaStatusBar :messages="statusMessages" :context-limit="statusLimit" :currency="statusCurrency" @open="inspectorOpen = true" />
        </section>
        <QaInspector v-model:open="inspectorOpen" :messages="statusMessages" :context-limit="statusLimit" :currency="statusCurrency" />
        <ModeNotice :open="pendingMode !== null" :target="pendingMode ?? 'graph'" @confirm="confirmMode" @cancel="pendingMode = null" />
    </div>
</template>

<style scoped>
.qa-page { display: flex; height: 100%; min-height: 0; }
.qa-list { width: 280px; flex-shrink: 0; border-right: 1px solid var(--divider); background: var(--panel-surface); min-height: 0; }
.qa-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.qa-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; padding: 8px 16px; border-bottom: 1px solid var(--divider); font-size: var(--text-sm); }
.qa-title { font-weight: var(--weight-strong); color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
.qa-meta { color: var(--text-muted); font-size: var(--text-xs); }
.qa-warn { display: inline-flex; align-items: center; gap: 4px; color: var(--status-warning); font-size: var(--text-xs); }
.qa-switch { display: flex; align-items: center; gap: 6px; max-width: 60vw; border-radius: var(--radius-control); padding: 2px 6px; font-weight: var(--weight-strong); }
.qa-switch:hover { background: var(--bg-hover); }
.qa-notices { display: flex; flex-direction: column; gap: 6px; padding: 8px 16px 0; }
.qa-link { color: var(--accent-text); }
.qa-view { flex: 1; min-height: 0; }
</style>
