/**
 * 保存后的提示（docs/specs/canon/author-ui.md 输出 18）：本窗口每次发布成功给一条，同一时间只有一条，新的顶掉旧的。
 *
 * 窗口里一份。条目页、回执页、变更详情页挂着时（页面标签只在前台时挂载，所以“挂着”就是“在前台”），提示浮在页面下方，切到
 * 另一个这样的页面时它跟过去（各页读的是同一份）。没有这样的页面挂着时（例如在改动记录里还原，编辑区开着章节正文），提示是一条
 * 工作台通知，动作是“查看详情”：工作台通知只有一个动作，“还原”从回执页做（与 Spec 的出入记在 t31 的待确认清单里）；它按工作台
 * 通知自己的限时收起。窗口里没有工作台通知时，提示照样留给页面那一份。
 *
 * 页面那一份自己收起的计时也在这里，不在各页的宿主里：拆分以后两个页面同时挂着，各自计时会互相清掉对方正指着的提示，
 * 宿主卸载再挂上也会让已经收起的提示带着新的计时回来。暂停的来源（哪个页面上指针停着、焦点在提示里、还原的确认框开着）
 * 各自 `hold()`，都放开以后再计。
 *
 * Agent 改了设定（读取层的 `onRevision` 交来写入者是 Agent 的修订）另占一格 `agent`：不顶掉作者自己的提示，也不发工作台通知。
 * 它记最近一次的修订与这之后又改了几次；“查看详情”“还原”指最近一次。关掉之前再来的 Agent 修订接着计数。
 */

import {onScopeDispose, shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {Notifications} from "nbook/plugins/workbench/shared/contracts";

import {canonText} from "../shared/text";
import type {RevertRequests} from "./revert";

export interface CanonNotice {
    /** 这次修订的 id：“查看详情”打开它的回执页，“还原”打开还原它的对话框。 */
    readonly revision: string;
    readonly title: string;
    /** 这次写回的位置（“最初”“第 3 章”“前史”）：就地改与记一笔给，改条目本身（删除、加一组设定、别名）与正文不给。 */
    readonly where?: string;
}

/** Agent 的提示：最近一次修订，与它之前、这条提示还没关时 Agent 又改了几次（不算最近这次）。 */
export interface AgentNotice extends CanonNotice {
    readonly earlier: number;
    /** 这次修订已经被还原：“还原”不再能点（再点会进“连同依赖一起还原”，等于把 Agent 的改动重做回来）。 */
    readonly undone?: true;
}

export interface CanonNotices {
    readonly current: Readonly<ShallowRef<CanonNotice | null>>;
    /** Agent 改了设定的提示；没有时为 null。 */
    readonly agent: Readonly<ShallowRef<AgentNotice | null>>;
    /** 记一次 Agent 的修订（读取层的 `onRevision` 里调用）。 */
    agentRevised(notice: CanonNotice): void;
    dismissAgent(): void;
    /** 一次修订被还原了（还原对话框成功时调用）：它是 Agent 提示的那一次时，提示标成已还原。 */
    reverted(revision: string): void;
    /** 打开改动记录视图（Agent 提示的“看改动记录”）。 */
    openRevisions(): void;
    /** `page`：调用方随即打开一个条目页（新建条目），提示留给那一页，不看现在有没有页面挂着。 */
    show(notice: CanonNotice, options?: {readonly page?: boolean}): void;
    dismiss(): void;
    /** 三种页面挂上时调用，卸载时调用它返回的函数。 */
    attach(): () => void;
    /**
     * 暂停作者提示自己收起，调用返回的函数放开（重复调用无效）。各来源都放开以后按剩下的时间继续，至少再留
     * `NOTICE_MIN_AFTER_HOLD_MS`；暂停期间换了新的提示，放开后从头计。
     */
    hold(): () => void;
}

/** 作者的提示浮在页面上多久自己收起（author-ui.md 输出 18）。 */
export const NOTICE_CLOSE_MS = 6000;
/** 暂停放开以后至少再留多久：与工作台通知相同（workbench/notifications.md 输出 3）。 */
export const NOTICE_MIN_AFTER_HOLD_MS = 800;

/** 计时的来源：缺省是窗口的时钟与 `setTimeout`，测试注入手动的。 */
export interface NoticeClock {
    now(): number;
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

const windowClock: NoticeClock = {
    now: () => Date.now(),
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface NoticeRoutes {
    /** 工作台的通知；窗口里没有时为 null。 */
    readonly workbench: Pick<Notifications, "notify"> | null;
    /** 打开一次修订的回执页（工作台通知的动作）。 */
    readonly receipt: (revision: string) => void;
    /** 打开改动记录视图；没有时什么也不做。 */
    readonly revisions?: () => void;
    readonly clock?: NoticeClock;
}

export function createNotices(routes: NoticeRoutes = {workbench: null, receipt: () => undefined}): CanonNotices {
    const current = shallowRef<CanonNotice | null>(null);
    const agent = shallowRef<AgentNotice | null>(null);
    let attached = 0;
    const clock = routes.clock ?? windowClock;
    // 作者提示的计时：`deadline` 是到点的时刻，暂停时清掉计时器、留着剩下的时间；`holds` 是还没放开的暂停来源数。
    let timer: unknown = null;
    let deadline = 0;
    let remaining = 0;
    let holds = 0;
    const stop = (): void => {
        if (timer !== null) clock.clear(timer);
        timer = null;
    };
    const run = (ms: number): void => {
        stop();
        deadline = clock.now() + ms;
        timer = clock.set(() => {
            timer = null;
            current.value = null;
        }, ms);
    };
    const setCurrent = (notice: CanonNotice | null): void => {
        current.value = notice;
        stop();
        remaining = NOTICE_CLOSE_MS;
        if (notice !== null && holds === 0) run(NOTICE_CLOSE_MS);
    };
    return {
        current,
        agent,
        agentRevised: (notice) => {
            agent.value = {...notice, earlier: agent.value === null ? 0 : agent.value.earlier + 1};
        },
        dismissAgent: () => {
            agent.value = null;
        },
        reverted: (revision) => {
            if (agent.value !== null && agent.value.revision === revision) agent.value = {...agent.value, undone: true};
        },
        openRevisions: () => routes.revisions?.(),
        show: (notice, options) => {
            if (attached > 0 || routes.workbench === null || options?.page === true) {
                setCurrent(notice);
                return;
            }
            // 新的提示顶掉旧的：页面上那一条也不再留着。带动作的工作台通知缺省常驻，这里给 `sticky: false`，同一次保存的提示
            // 不论走哪条路都自己收起。
            setCurrent(null);
            routes.workbench.notify({tone: "success", title: canonText("notice.label"), message: notice.where === undefined ? notice.title : canonText("notice.withWhere", {title: notice.title, where: notice.where}), sticky: false, action: {label: canonText("notice.receipt"), run: () => routes.receipt(notice.revision)}});
        },
        dismiss: () => {
            setCurrent(null);
        },
        hold: () => {
            holds += 1;
            if (holds === 1 && timer !== null) {
                remaining = Math.max(0, deadline - clock.now());
                stop();
            }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                holds -= 1;
                if (holds === 0 && current.value !== null) run(Math.max(remaining, NOTICE_MIN_AFTER_HOLD_MS));
            };
        },
        attach: () => {
            attached += 1;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                attached -= 1;
            };
        },
    };
}

/**
 * 三种页面的宿主在 setup 里调用：挂着就算这个页面在前台（向提示登记，作用域结束时撤掉）。返回浮动提示要的三样：
 * “还原”打开窗口里那一个还原对话框，关闭收起提示，`hold` 交给 `PageNotices` 在指针停着、焦点在里面时暂停收起。
 *
 * 点“还原”时提示先留着：还原成功后换成还原的那一条，取消则还在。这样焦点有地方回：对话框关闭时把焦点还给“还原”按钮，
 * 按钮还在（成功时是同一条提示条换了标题）；先收起提示，键盘用户的焦点会掉到页面外。
 */
export function usePageNotice(notices: CanonNotices, revert: RevertRequests): {undo(notice: CanonNotice): void; close(): void; hold(): () => void} {
    onScopeDispose(notices.attach());
    return {
        undo: (notice) => revert.open(notice.revision, notice.title),
        close: () => notices.dismiss(),
        hold: () => notices.hold(),
    };
}
