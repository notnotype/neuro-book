/**
 * 还原（docs/specs/canon/author-ui.md 输出 22、29）：回执页的“还原这次修订”、保存后的提示与改动记录里的“还原”都打开
 * 同一个对话框。对话框在窗口里一份（本插件交给工作台的页面浮层），哪里打开都一样：`createRevertRequests` 是窗口里那一份“要还原
 * 哪一次”，`useRevert` 是浮层里的对话框背后的状态与写入。
 *
 * 打开时先预览还原请求（canon.revisions 输出 11、12），对话框开着时世界变了就原地重取：
 * - 没有依赖：写带来的变化，给“还原”；
 * - 有依赖（`has-dependents`）：从新到旧列出依赖它的修订的标题，给“连同这些一起还原”；
 * - 章序调整（`not-revertable`）、补偿里有对决定的修改要作者来源（预览给了 `needed`，或得到 `author-source-required`）：只写原因。
 * 确认后发 `revert`；结果回来之前对话框不关、按钮不可用，失败时原因写在对话框里，成功后关掉并给保存后的提示。请求 id 在打开
 * 时定；结局不明时“再查一次”用同一个，被明确拒收以后换一个。
 */

import {computed, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import type {Impact} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import {canonText} from "../shared/text";
import type {CanonClient, CanonFailure} from "../shared/contracts";
import {failureText} from "./failures";
import type {CanonNotices} from "./notices";
import {writeBlocked} from "./writable";
import type {CanonWorld} from "./world";

/** 依赖的修订最多列出这么多条的标题；更多的写“还有 N 次”。 */
export const DEPENDENTS_LISTED = 20;

export interface RevertTarget {
    readonly revision: string;
    /** 原来那次修订的标题；不知道时打开后去读。 */
    readonly title: string | null;
}

export interface RevertRequests {
    readonly target: Readonly<ShallowRef<RevertTarget | null>>;
    open(revision: string, title?: string): void;
    close(): void;
}

export function createRevertRequests(): RevertRequests {
    const target = shallowRef<RevertTarget | null>(null);
    return {
        target,
        open: (revision, title) => {
            target.value = {revision, title: title ?? null};
        },
        close: () => {
            target.value = null;
        },
    };
}

export type RevertPhase = "previewing" | "ready" | "dependents" | "blocked";

/** 对话框要画的东西。 */
export interface RevertModel {
    readonly title: string;
    readonly phase: RevertPhase;
    /** 没有依赖时：预览里带来的变化。 */
    readonly impact: Impact | null;
    /** 有依赖时：从新到旧，依赖它的修订的标题（读不到的为 null）。 */
    readonly dependents: readonly (string | null)[];
    /** 依赖的修订里没列出标题的条数。 */
    readonly moreDependents: number;
    /** 不能还原的原因（`blocked`），或世界写不了的原因。 */
    readonly reason: Text | null;
    readonly error: Text | null;
    readonly recheck: boolean;
    readonly saving: boolean;
}

export interface RevertOptions {
    readonly world: CanonWorld;
    readonly call: CanonClient["call"];
    readonly requests: RevertRequests;
    readonly notices: CanonNotices;
    /** 还原修订自己的标题（存进世界，用界面当时的语言）。 */
    readonly revertTitle: (original: string, dependents: number) => string;
}

export interface Revert {
    readonly model: ComputedRef<RevertModel | null>;
    confirm(): void;
    close(): void;
}

const newRequestId = (): string => `revert-${crypto.randomUUID()}`;

/** 预览得到的失败写成原因：章序调整、要作者来源、找不到，别的按写入失败的写法。 */
function blockedReason(failure: CanonFailure): Text {
    if (failure.code === "not-revertable") return canonText("revert.notRevertable");
    if (failure.code === "author-source-required") return canonText("revert.authorSource");
    if (failure.code === "not-found") return canonText("revert.notFound");
    return failureText(failure).text;
}

export function useRevert(options: RevertOptions): Revert {
    const {world, call, requests} = options;
    const title = shallowRef<string | null>(null);
    const phase = shallowRef<RevertPhase>("previewing");
    const impact = shallowRef<Impact | null>(null);
    const dependents = shallowRef<readonly string[]>([]);
    const dependentTitles = shallowRef<readonly (string | null)[]>([]);
    const reason = shallowRef<Text | null>(null);
    const error = shallowRef<Text | null>(null);
    const recheck = shallowRef(false);
    const saving = shallowRef(false);
    let requestId = newRequestId();
    // 每次打开一个号：关掉或换了一次修订以后，晚到的预览作废。
    let run = 0;

    const reset = (): void => {
        title.value = null;
        phase.value = "previewing";
        impact.value = null;
        dependents.value = [];
        dependentTitles.value = [];
        reason.value = null;
        error.value = null;
        recheck.value = false;
        saving.value = false;
        requestId = newRequestId();
    };

    const titleOf = async (id: string): Promise<string | null> => {
        const read = await call("revision", {id});
        return read.ok ? read.value.revision?.title ?? null : null;
    };

    /** 有依赖：从新到旧列出，标题随后读（读之前写“读取中…”）。 */
    const enterDependents = async (ids: readonly string[], mine: number): Promise<void> => {
        const listed = ids.slice(0, DEPENDENTS_LISTED);
        const same = phase.value === "dependents" && JSON.stringify(dependents.value) === JSON.stringify(ids);
        dependents.value = ids;
        if (!same) dependentTitles.value = listed.map(() => null);
        phase.value = "dependents";
        impact.value = null;
        reason.value = null;
        const titles = await Promise.all(listed.map(titleOf));
        if (mine !== run) return;
        dependentTitles.value = titles;
    };

    /** 不能还原、要作者来源、找不到：只写原因。 */
    const enterBlocked = (failure: CanonFailure): void => {
        phase.value = "blocked";
        impact.value = null;
        reason.value = blockedReason(failure);
    };

    /** 预览还原请求，按结果换阶段。预览不看请求 id，用的还是打开时定的那个。 */
    const preview = async (target: RevertTarget, mine: number): Promise<void> => {
        const result = await call("preview", {request: {revert: target.revision, withDependents: false, requestId, by: {kind: "author"}}});
        if (mine !== run) return;
        if (result.ok) {
            if ((result.value.needed?.length ?? 0) > 0) {
                enterBlocked({code: "author-source-required"});
                return;
            }
            impact.value = result.value.revision.impact;
            reason.value = null;
            phase.value = "ready";
            return;
        }
        if (result.failure.code === "has-dependents" && Array.isArray(result.failure.dependents)) {
            await enterDependents(result.failure.dependents as string[], mine);
            return;
        }
        enterBlocked(result.failure);
    };

    const start = async (target: RevertTarget): Promise<void> => {
        const mine = ++run;
        reset();
        title.value = target.title;
        if (target.title === null) {
            const read = await titleOf(target.revision);
            if (mine !== run) return;
            title.value = read;
        }
        await preview(target, mine);
    };

    watch(() => requests.target.value, (target) => {
        if (target === null) {
            run += 1;
            reset();
            return;
        }
        void start(target);
    }, {immediate: true});

    // 预览只对它基于的版本有效（author-ui.md“状态与转换”）：对话框开着时世界变了（例如别处发布了依赖它的修订），原地重取，
    // 不回到“正在预览”。保存中不重取：本窗口这次还原的结果回来之前版本也会变。
    watch(() => world.status.value.data?.version, () => {
        const target = requests.target.value;
        if (target === null || saving.value || phase.value === "previewing") return;
        void preview(target, ++run);
    });

    const submit = async (): Promise<void> => {
        const target = requests.target.value;
        if (target === null || saving.value || (phase.value !== "ready" && phase.value !== "dependents") || writeBlocked(world) !== null) return;
        const withDependents = phase.value === "dependents";
        const original = title.value ?? "";
        const revertTitle = options.revertTitle(original, withDependents ? dependents.value.length : 0);
        saving.value = true;
        error.value = null;
        recheck.value = false;
        const result = await world.write("revert", {revision: target.revision, withDependents, requestId, by: {kind: "author"}, title: revertTitle});
        saving.value = false;
        if (requests.target.value !== target) return;
        if (result.ok) {
            requests.close();
            options.notices.reverted(target.revision);
            options.notices.show({revision: result.value.revision, title: revertTitle});
            return;
        }
        // 写入时才知道的（预览之后世界变了）：有了依赖转到列出依赖的阶段，不能还原的转到只写原因，要作者再确认一次。
        if (result.failure.code === "has-dependents" && Array.isArray(result.failure.dependents)) {
            requestId = newRequestId();
            await enterDependents(result.failure.dependents as string[], ++run);
            return;
        }
        if (result.failure.code === "not-revertable" || result.failure.code === "author-source-required") {
            enterBlocked(result.failure);
            return;
        }
        const shown = failureText(result.failure);
        error.value = shown.text;
        recheck.value = shown.recheck;
        if (!shown.recheck) requestId = newRequestId();
    };

    return {
        model: computed(() => {
            if (requests.target.value === null) return null;
            const blocked = writeBlocked(world);
            return {
                title: title.value ?? "",
                phase: phase.value,
                impact: impact.value,
                dependents: dependentTitles.value,
                moreDependents: Math.max(0, dependents.value.length - dependentTitles.value.length),
                reason: phase.value === "blocked" ? reason.value : blocked,
                error: error.value,
                recheck: recheck.value,
                saving: saving.value,
            };
        }),
        confirm: () => void submit(),
        close: () => {
            // 结果回来之前不关（输出 22）。
            if (!saving.value) requests.close();
        },
    };
}
