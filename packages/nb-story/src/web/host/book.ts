/**
 * 一本书在查看器里的会话：阅读位置、视角、当前页、抽屉里打开的东西，以及它们与地址、书库里阅读状态的同步
 * （docs/specs/story/viewer.md 输出 4、5、21 与“状态与转换”）。
 *
 * 抽取中的书（输出 39）：每 5 秒查一次这本书的抽取进度（`ingest`）。又提交了新的章时只记下“落后了”（`behind`），
 * 不换数据；用户点更新、或做了要取新数据的操作（换位置、换页面、打开对象、翻页）时先 `refresh()` 换成新的：重取
 * `info`、数据版本加一，各处的查询按版本在后台重取、回来后替换（不先清空，正在看的内容不跳），阅读位置、页面、
 * 对象与视角都不变。查询本身不固定版本：视角、筛选这类页面里直接改的参数，落后时发出的请求读到的是书库里的新数据，
 * 而 `info` 与徽标还是旧的，直到下一次 refresh。
 *
 * 状态只在这里改；地址与保存都从状态派生：
 * - 地址：状态一变就 router.replace；地址被外部改了（后退、手改）就按地址改状态。两边比较后才写，不会来回触发。
 * - 保存：最后一次变化后 1 秒存一次整份阅读状态；同时只有一次在途，在途时又变了就记下，等它完成再存最新的一份。
 *   页面隐藏或关闭时立即用 keepalive 发出。保存的返回不改动界面；失败时 saveFailed 为真，下次变化时重试。
 */

import {computed, inject, ref, shallowRef, watch, type ComputedRef, type InjectionKey, type Ref, type ShallowRef} from "vue";
import type {Router} from "vue-router";

import type {IngestStatusView, PositionInput, StoryResult} from "../../contract/contract";
import {sendKeepalive, StoryCallError, type StoryClient} from "./client";
import {activeDetail, close, collapse, expand, fromView, openBeside, openIn, swap, toView, touch, type DetailRequest, type DetailsState, type DetailTarget} from "./details";

export const PAGES = ["overview", "relations", "book-graph", "roster", "secrets", "ledger", "questions", "timeline", "episodes", "source", "qa", "revisions", "stats"] as const;
export type Page = (typeof PAGES)[number];
/** 只在这本书记这一类时才有的页（docs/specs/story/viewer.md 输出 2；开关见 ingest.md 输出 18）。 */
const PAGE_FEATURE: Partial<Record<Page, {feature: keyof Features; missing: string}>> = {
    secrets: {feature: "secrets", missing: "这本书没有记录秘密"},
    ledger: {feature: "ledger", missing: "这本书没有记录数值"},
};
type Features = StoryResult<"book.info">["features"];

/** 这本书开着的页，按导航的顺序。导航、手机上的“更多”与跳转都只用它。 */
export function allowedPages(features: Features): Page[] {
    return PAGES.filter(page => {
        const gate = PAGE_FEATURE[page];
        return !gate || features[gate.feature];
    });
}

/** 页不开着时为它的提示，开着时为 null。 */
function closedPage(features: Features, page: Page): string | null {
    const gate = PAGE_FEATURE[page];
    return gate && !features[gate.feature] ? gate.missing : null;
}

export const TABS = ["summary", "relations", "records", "episodes"] as const;
export type Tab = (typeof TABS)[number];

export type DrawerContent =
    | {kind: "card"; entity: string; tab: Tab}
    | {kind: "source"; ref: string}
    | {kind: "para"; chapter: number; paragraph: number}
    | {kind: "node"; id: string; label: string};

/**
 * 从别的页点进来时要定位的东西（总览点主线、秘密、悬念、情节，输出 8）。只在这次跳转里有效，不进地址：
 * 目标页挂载时用 `takeJump` 取走并清空。
 */
export type JumpTarget = {kind: "arc"; id: string} | {kind: "secret"; id: string} | {kind: "question"; id: string} | {kind: "episode"; id: string} | {kind: "entity"; id: string};

/** 存进书库的界面状态（`reading.set` 的 view）：`entity`、`tab` 是左边那张人物卡，`entity2`、`tab2` 是右边那张（输出 69）。 */
interface SavedView {
    page: Page;
    entity: string | null;
    tab: Tab | null;
    entity2: string | null;
    tab2: Tab | null;
    perspective: string;
}

export interface BookSession {
    readonly bookId: string;
    /** 全书的信息（章数、各章段数）；不带阅读位置取，目录标题另按位置取。`refresh()` 后换成新的（读它的地方是响应式的）。 */
    readonly info: StoryResult<"book.info">;
    /** 这本书开着的页（按 `info.features`）。 */
    readonly pages: ComputedRef<readonly Page[]>;
    /** 数据版本：`refresh()` 一次加一。查询 hook 把它当参数，变了就重取。 */
    readonly dataVersion: Ref<number>;
    /** 这本书的抽取进度；没有抽取记录时为 null。 */
    readonly ingest: ShallowRef<IngestStatusView | null>;
    /** 书库里已经提交了比显示的数据更多的章（徽标提示“点这里更新”）。 */
    readonly behind: ComputedRef<boolean>;
    /** 换成书库里最新的数据；正在换时再调用等同一次。没换成时写 `notice` 并 resolve 为 false，不 reject。 */
    refresh(): Promise<boolean>;
    readonly at: Ref<PositionInput>;
    readonly atLabel: ComputedRef<string>;
    /** 读到了抽取到的最后位置（显示“全部读完”，输出 5）。 */
    readonly atEnd: ComputedRef<boolean>;
    readonly perspective: Ref<string>;
    readonly page: Ref<Page>;
    /** 右侧的详情（最多两张，输出 66 到 69）：只经下面的写入口改。 */
    readonly details: Readonly<ShallowRef<DetailsState>>;
    /** 最近点过、看得见的那张详情的内容；整块收起或没有时为 null。读它的页面（人物页、关系图、待确认）按它高亮。 */
    readonly drawer: Readonly<Ref<DrawerContent | null>>;
    /** 打开时去掉了地址里不存在的对象或视角等，给页面角落的一次性提示。 */
    readonly notice: Ref<string | null>;
    readonly saveFailed: Ref<boolean>;
    /** 外壳的宽度档，由外壳按自己的宽度写；页面按它决定版式（输出 32、33）。 */
    readonly tier: Ref<"wide" | "tablet" | "phone">;
    /** 原文页正在看的章；null 表示阅读位置所在章。写进地址（`chapter`），指向阅读位置之后的章时页面显示 F3。 */
    readonly sourceChapter: Ref<number | null>;
    /** 问答页选中的对话 id；null 是新对话。写进地址（`c`），只进地址、不进存下的状态。 */
    readonly qaConversation: Ref<string | null>;
    /** 在主区打开某人的记录宽表（输出 10）；不进地址。 */
    readonly wideRecords: Ref<string | null>;
    /** 整块展开：收起时记着的详情都回来（输出 1）。没有记着的时什么也不做。 */
    reopenDrawer(): void;
    /** 打开一页并带上要定位的目标。 */
    jump(page: Page, target: JumpTarget): void;
    /** 取走发给这一类目标的定位（只取一次）。 */
    takeJump<K extends JumpTarget["kind"]>(kind: K): string | null;
    /** 换阅读位置；`"end"` 是抽取到的最后位置（落后时按换成新数据之后的终点算）。 */
    setAt(at: PositionInput | "end"): void;
    goPage(page: Page): void;
    /** 打开人物卡：换最近点过的那张。`tab` 不给时，已开着的人不换页签，新开的停在概况（`details.ts` 的 `openIn`）。 */
    openCard(entity: string, tab?: Tab): void;
    openSource(ref: string): void;
    openParagraph(chapter: number, paragraph: number): void;
    openNode(id: string, label: string): void;
    /** 打开到指定的那张（卡片里的链接经外壳的会话代理走这里）。 */
    openDetail(request: DetailRequest, at: DetailTarget): void;
    /** 在旁边打开（Ctrl 点、“在旁边打开”）。 */
    openBeside(request: DetailRequest): void;
    /** 关掉一张；是最后一张时等于整块收起。 */
    closeDetail(key: number): void;
    /** 成为最近点过的那张。 */
    touchDetail(key: number): void;
    /** 左右对调，被拖的那张成为最近的。 */
    swapDetails(movedKey: number): void;
    /** 整块收起，记着这几张。 */
    closeDrawer(): void;
    dispose(): void;
}

export const BOOK_SESSION: InjectionKey<BookSession> = Symbol("nb-story book session");

export function useBook(): BookSession {
    const session = inject(BOOK_SESSION);
    if (!session) throw new Error("没有提供 BookSession：页面要放在书的外壳里");
    return session;
}

export function formatAt(at: PositionInput): string {
    return at.paragraph === undefined ? String(at.chapter) : `${at.chapter}.${at.paragraph}`;
}

export function parseAt(text: unknown): PositionInput | null {
    if (typeof text !== "string") return null;
    const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/u.exec(text);
    if (!match) return null;
    return match[2] === undefined ? {chapter: Number(match[1])} : {chapter: Number(match[1]), paragraph: Number(match[2])};
}

function isPage(value: unknown): value is Page {
    return typeof value === "string" && (PAGES as readonly string[]).includes(value);
}

function isTab(value: unknown): value is Tab {
    return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

function readSavedView(view: unknown): Partial<SavedView> {
    if (typeof view !== "object" || view === null) return {};
    const value = view as Record<string, unknown>;
    return {
        ...(isPage(value.page) ? {page: value.page} : {}),
        ...(typeof value.entity === "string" ? {entity: value.entity} : {}),
        ...(isTab(value.tab) ? {tab: value.tab} : {}),
        ...(typeof value.entity2 === "string" ? {entity2: value.entity2} : {}),
        ...(isTab(value.tab2) ? {tab2: value.tab2} : {}),
        ...(typeof value.perspective === "string" ? {perspective: value.perspective} : {}),
    };
}

/** 位置在这本书里是否合法（地址可能写错）。 */
function validAt(info: StoryResult<"book.info">, at: PositionInput | null): at is PositionInput {
    if (!at || at.chapter < 1 || at.chapter > info.chapters) return false;
    return at.paragraph === undefined || (at.paragraph >= 1 && at.paragraph <= info.paragraphs[at.chapter - 1]!);
}

/** 位置是否已到抽取到的最后位置：章是最后抽取的那一章，没指定段或段不早于抽取终点。 */
export function isEnd(info: StoryResult<"book.info">, at: PositionInput): boolean {
    const end = info.extractedThrough;
    return at.chapter > end.chapter || (at.chapter === end.chapter && (at.paragraph === undefined || at.paragraph >= end.paragraph));
}

const SAVE_DELAY_MS = 1000;

/**
 * 打开一本书：先取回存下的阅读状态，按“地址写明的优先”合并（输出 4），去掉当前位置还不存在的对象与视角，
 * 再返回会话。页面数据在这之后才取。
 */
export async function openBookSession(client: StoryClient, router: Router, bookId: string): Promise<BookSession> {
    const infoRef = shallowRef(await client.call("book.info", {book: bookId}));
    // 打开时的检查用打开那一刻的信息；之后的读取都经 infoRef（refresh 会换它）。
    const info = infoRef.value;
    const saved = await client.call("reading.get", {book: bookId});
    const route = router.currentRoute.value;
    const query = route.query;
    const savedView = readSavedView(saved.view);
    const notices: string[] = [];

    const urlAt = parseAt(query.at);
    if (query.at !== undefined && !validAt(info, urlAt)) notices.push("地址里的阅读位置不在这本书里，已改用上次的位置");
    // 从没存过（savedAt 为 null）的书第一次打开时读到抽取到的最后位置（输出 4）。
    const end: PositionInput = {chapter: info.extractedThrough.chapter};
    const at = ref<PositionInput>(validAt(info, urlAt) ? urlAt : saved.savedAt !== null && validAt(info, saved.position) ? saved.position : end);
    let initialPage: Page = isPage(route.params.page) ? route.params.page : (savedView.page ?? "overview");
    // 地址或存下的状态指向这本书关掉的那类的页（旧链接、手改地址）：换成总览并提示，地址随后由 syncRoute 改写。
    const closedNotice = closedPage(info.features, initialPage);
    if (closedNotice !== null) {
        notices.push(`${closedNotice}，已打开全书总览`);
        initialPage = "overview";
    }
    const page = ref<Page>(initialPage);
    let perspective = typeof query.perspective === "string" ? query.perspective : (savedView.perspective ?? "reader");
    // 人物卡的四个参数按组取（输出 4）：地址里出现任一个，四个都取地址（没写的当没有，页签缺省概况）；一个都没出现才整组用存下的。
    // 命令行给的地址只写 `entity` 时，页签不从存下的状态补。
    const cardKeys = ["entity", "tab", "entity2", "tab2"] as const;
    const fromUrl = cardKeys.some((name) => query[name] !== undefined);
    const pick = (name: (typeof cardKeys)[number]): unknown => (fromUrl ? query[name] : savedView[name]);
    const requested: Array<{entity: string; tab: Tab}> = [];
    for (const [entityKey, tabKey] of [["entity", "tab"], ["entity2", "tab2"]] as const) {
        const value = pick(entityKey);
        const tabValue = pick(tabKey);
        if (typeof value === "string" && value !== "") requested.push({entity: value, tab: isTab(tabValue) ? tabValue : "summary"});
    }

    if (perspective !== "reader") {
        try {
            await client.call("entities.list", {book: bookId, at: at.value, perspective, limit: 1});
        } catch (error) {
            if (!(error instanceof StoryCallError)) throw error;
            notices.push(`视角“${perspective}”在${formatAt(at.value)}还不可用，已换回读者视角`);
            perspective = "reader";
        }
    }
    // 两张并行核对，按规范化之后的 id 去重（同一个人只留左边那张）；没出现的那张去掉，留下的放在左边，每张一句提示。
    const checked = await Promise.all(requested.map(async (card) => {
        try {
            return {...card, entity: (await client.call("entity.card", {book: bookId, at: at.value, entity: card.entity})).id};
        } catch (error) {
            if (!(error instanceof StoryCallError)) throw error;
            notices.push(`对象“${card.entity}”在这个阅读位置还没出现，已关掉它的人物卡`);
            return null;
        }
    }));
    const cards = checked.filter((card): card is {entity: string; tab: Tab} => card !== null);

    const perspectiveRef = ref(perspective);
    const urlChapter = typeof query.chapter === "string" && /^\d+$/u.test(query.chapter) ? Number(query.chapter) : null;
    const sourceChapter = ref<number | null>(urlChapter !== null && urlChapter >= 1 && urlChapter <= info.chapters ? urlChapter : null);
    const qaConversation = ref<string | null>(typeof query.c === "string" && query.c !== "" ? query.c : null);
    const details = shallowRef<DetailsState>(fromView({entity: cards[0]?.entity ?? null, tab: cards[0]?.tab ?? null, entity2: cards[1]?.entity ?? null, tab2: cards[1]?.tab ?? null}));
    const drawer = computed<DrawerContent | null>(() => (details.value.open ? (activeDetail(details.value)?.content ?? null) : null));
    const notice = ref<string | null>(notices.length ? notices.join("；") : null);
    const saveFailed = ref(false);
    const atEnd = computed(() => isEnd(infoRef.value, at.value));
    const atLabel = computed(() => (atEnd.value ? "全部读完" : at.value.paragraph === undefined ? `第 ${at.value.chapter} 章` : `第 ${at.value.chapter} 章第 ${at.value.paragraph} 段`));
    const pendingJump = ref<JumpTarget | null>(null);
    const tierRef = ref<"wide" | "tablet" | "phone">("wide");
    const pages = computed(() => allowedPages(infoRef.value.features));

    function viewState(): SavedView {
        const view = toView(details.value);
        return {page: page.value, entity: view.entity, tab: view.tab, entity2: view.entity2, tab2: view.tab2, perspective: perspectiveRef.value};
    }
    /** 进地址与存下的状态的那部分详情：只改“最近点过的那张”不算变化，不写地址、不存。 */
    const detailsView = computed(() => JSON.stringify(toView(details.value)));

    // ---- 地址 ----
    function routeTarget() {
        const view = viewState();
        const next: Record<string, string> = {at: formatAt(at.value)};
        // 视角总写进地址（含 reader）：地址没写的部分会用存下的状态补齐，省略读者视角就复现不了读者视角的画面。
        next.perspective = view.perspective;
        if (view.entity) next.entity = view.entity;
        if (view.entity && view.tab) next.tab = view.tab;
        if (view.entity2) next.entity2 = view.entity2;
        if (view.entity2 && view.tab2) next.tab2 = view.tab2;
        if (view.page === "source" && sourceChapter.value !== null) next.chapter = String(sourceChapter.value);
        if (view.page === "qa" && qaConversation.value !== null) next.c = qaConversation.value;
        return {path: `/book/${encodeURIComponent(bookId)}/${view.page}`, query: next};
    }
    function syncRoute(): void {
        const target = routeTarget();
        const current = router.currentRoute.value;
        const same = current.path === target.path && JSON.stringify(current.query) === JSON.stringify(target.query);
        if (!same) void router.replace(target);
    }
    const stopRoute = router.afterEach(to => {
        if (to.params.id !== bookId) return;
        if (isPage(to.params.page) && to.params.page !== page.value) {
            const closed = closedPage(infoRef.value.features, to.params.page);
            if (closed === null) page.value = to.params.page;
            else {
                notice.value = `${closed}，已打开全书总览`;
                // 页面没变时 watch 不会改写地址，这里直接改回去。
                if (page.value === "overview") syncRoute();
                else page.value = "overview";
            }
        }
        const nextAt = parseAt(to.query.at);
        if (validAt(infoRef.value, nextAt) && formatAt(nextAt) !== formatAt(at.value)) void moveTo(nextAt);
        if (typeof to.query.perspective === "string" && to.query.perspective !== perspectiveRef.value) perspectiveRef.value = to.query.perspective;
        const chapter = typeof to.query.chapter === "string" && /^\d+$/u.test(to.query.chapter) ? Number(to.query.chapter) : null;
        if (chapter !== sourceChapter.value && (chapter === null || chapter <= infoRef.value.chapters)) sourceChapter.value = chapter;
        const conversation = typeof to.query.c === "string" && to.query.c !== "" ? to.query.c : null;
        if (to.params.page === "qa" && conversation !== qaConversation.value) qaConversation.value = conversation;
    });

    // ---- 换阅读位置 ----
    // 视角人物在新位置还没出现（往回拨到他出场之前）时，查询会报 entity_not_found：先查一次，不存在就和位置一起换回
    // 读者视角并提示（输出 4 的规则用到位置变化上）。只认最后一次换位置的结果，前面在途的作废。
    let moveToken = 0;
    async function moveTo(next: PositionInput): Promise<void> {
        const token = ++moveToken;
        const current = perspectiveRef.value;
        let fallback = false;
        if (current !== "reader") {
            try {
                await client.call("entities.list", {book: bookId, at: next, perspective: current, limit: 1});
            } catch (error) {
                if (!(error instanceof StoryCallError) || error.code !== "entity_not_found") throw error;
                fallback = true;
            }
        }
        if (token !== moveToken) return;
        if (fallback && perspectiveRef.value === current) {
            perspectiveRef.value = "reader";
            const where = next.paragraph === undefined ? `第 ${next.chapter} 章` : `第 ${next.chapter} 章第 ${next.paragraph} 段`;
            notice.value = `这个视角的人物到${where}还没出现，已换回读者视角`;
        }
        at.value = next;
    }

    // ---- 保存 ----
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let dirty = false;
    function snapshot() {
        return {book: bookId, position: at.value, view: viewState()};
    }
    async function save(): Promise<void> {
        timer = null;
        if (inFlight) {
            dirty = true;
            return;
        }
        inFlight = true;
        dirty = false;
        try {
            await client.call("reading.set", snapshot());
            saveFailed.value = false;
        } catch (error) {
            console.warn({error}, "保存阅读状态失败");
            saveFailed.value = true;
        } finally {
            inFlight = false;
            if (dirty) void save();
        }
    }
    function scheduleSave(): void {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    }
    function flushOnHide(): void {
        if (timer === null && !dirty) return;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        dirty = false;
        sendKeepalive("reading.set", snapshot());
    }
    const onVisibility = () => {
        if (document.visibilityState === "hidden") flushOnHide();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushOnHide);

    // 原文页的章与问答页的对话只进地址，不进存下的状态；变了只同步地址。
    const stopChapter = watch([sourceChapter, qaConversation], () => syncRoute());
    const stopWatch = watch([at, page, perspectiveRef, detailsView], () => {
        syncRoute();
        scheduleSave();
    }, {deep: true});
    syncRoute();
    // 地址覆盖了存下的状态（或去掉了不存在的对象）时，打开的这一刻就已经是一次变化，照样存。
    if (JSON.stringify({position: at.value, view: viewState()}) !== JSON.stringify({position: saved.position, view: saved.view})) scheduleSave();

    // ---- 抽取中的书：进度与更新（输出 39） ----
    const dataVersion = ref(0);
    const ingest = shallowRef<IngestStatusView | null>(null);
    const behind = computed(() => ingest.value !== null && ingest.value.committed > infoRef.value.chapters);
    let refreshing: Promise<boolean> | null = null;
    function refresh(): Promise<boolean> {
        refreshing ??= (async () => {
            try {
                infoRef.value = await client.call("book.info", {book: bookId});
                dataVersion.value += 1;
                return true;
            } catch (error) {
                if (!(error instanceof StoryCallError)) throw error;
                notice.value = `没能换成新的数据（${error.message}），还是之前的内容`;
                return false;
            } finally {
                refreshing = null;
            }
        })();
        return refreshing;
    }
    /**
     * 要取新数据的操作（换位置、换页面、打开对象）经这里：不落后就立刻做；落后了先换成新数据再做，没换成就不做
     * （notice 已经说明）。所以换页面时不会先按旧数据取一轮、再被版本变化作废。
     */
    function afterFresh(action: () => void): void {
        if (!behind.value) {
            action();
            return;
        }
        void refresh().then(ok => {
            if (ok) action();
        });
    }
    // 没有抽取记录（导入数据文件得来的书）时停止轮询；有记录时一直查，抽完之后追加新章也看得到。
    let polling: ReturnType<typeof setInterval> | null = null;
    async function poll(): Promise<void> {
        try {
            ingest.value = (await client.call("ingest.status", {book: bookId})).books[0] ?? null;
        } catch (error) {
            if (!(error instanceof StoryCallError)) throw error;
            if (error.code === "book_not_found") {
                ingest.value = null;
                if (polling !== null) clearInterval(polling);
                polling = null;
                return;
            }
            // 一次没查到（例如服务暂时不通）不影响阅读，下一轮再查。
            console.warn({error}, "查抽取进度失败");
        }
    }
    const INGEST_POLL_MS = 5000;

    /** 打开都要取新数据，经 `afterFresh`：落后时先换数据再打开，回来时目标那张可能已经不在，`openIn` 按最近点过的那张。 */
    function openDetail(request: DetailRequest, target: DetailTarget): void {
        afterFresh(() => (details.value = openIn(details.value, request, target)));
    }
    polling = setInterval(() => void poll(), INGEST_POLL_MS);
    void poll();

    return {
        bookId,
        get info() {
            return infoRef.value;
        },
        pages,
        dataVersion,
        ingest,
        behind,
        refresh,
        at,
        atLabel,
        atEnd,
        perspective: perspectiveRef,
        page,
        details,
        drawer,
        notice,
        saveFailed,
        tier: tierRef,
        sourceChapter,
        qaConversation,
        wideRecords: ref(null),
        jump(next, target) {
            if (!pages.value.includes(next)) return;
            afterFresh(() => {
                pendingJump.value = target;
                page.value = next;
            });
        },
        takeJump(kind) {
            const target = pendingJump.value;
            if (target?.kind !== kind) return null;
            pendingJump.value = null;
            return target.id;
        },
        reopenDrawer() {
            details.value = expand(details.value);
        },
        setAt(next) {
            afterFresh(() => {
                const target = next === "end" ? {chapter: infoRef.value.extractedThrough.chapter} : next;
                if (validAt(infoRef.value, target)) void moveTo(target);
            });
        },
        goPage(next) {
            if (!pages.value.includes(next)) return;
            afterFresh(() => (page.value = next));
        },
        openCard(entityId, tabName) {
            openDetail(tabName === undefined ? {kind: "card", entity: entityId} : {kind: "card", entity: entityId, tab: tabName}, "active");
        },
        openSource(refText) {
            openDetail({kind: "source", ref: refText}, "active");
        },
        openParagraph(chapter, paragraph) {
            openDetail({kind: "para", chapter, paragraph}, "active");
        },
        openNode(id, label) {
            openDetail({kind: "node", id, label}, "active");
        },
        openDetail,
        openBeside(request) {
            // 窄档（平板、手机）只显示一张，看不出并排：等于普通打开（输出 67）。
            afterFresh(() => (details.value = tierRef.value === "wide" ? openBeside(details.value, request) : openIn(details.value, request, "active")));
        },
        closeDetail(key) {
            details.value = close(details.value, key);
        },
        touchDetail(key) {
            details.value = touch(details.value, key);
        },
        swapDetails(movedKey) {
            details.value = swap(details.value, movedKey);
        },
        closeDrawer() {
            details.value = collapse(details.value);
        },
        dispose() {
            if (polling !== null) clearInterval(polling);
            polling = null;
            stopWatch();
            stopChapter();
            stopRoute();
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("pagehide", flushOnHide);
            flushOnHide();
        },
    };
}
