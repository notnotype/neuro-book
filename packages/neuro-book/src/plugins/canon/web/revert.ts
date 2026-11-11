/**
 * 还原（docs/specs/canon/author-ui.md 输出 22、29）：回执页的“还原这次修订”、保存后的提示里的“撤销”与改动记录里的“还原”都打开
 * 同一个对话框。对话框在窗口里一份（本插件交给工作台的页面浮层），哪里打开都一样：`createRevertRequests` 是窗口里那一份“要还原
 * 哪一次”，`useRevert` 是浮层里的对话框背后的状态与写入。
 *
 * 打开时先预览还原请求（canon.revisions 输出 11、12）：
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

    const start = async (target: RevertTarget): Promise<void> => {
        const mine = ++run;
        reset();
        title.value = target.title;
        if (target.title === null) {
            const read = await titleOf(target.revision);
            if (mine !== run) return;
            title.value = read;
        }
        const preview = await call("preview", {request: {revert: target.revision, withDependents: false, requestId, by: {kind: "author"}}});
        if (mine !== run) return;
        if (preview.ok) {
            if ((preview.value.needed?.length ?? 0) > 0) {
                phase.value = "blocked";
                reason.value = canonText("revert.authorSource");
                return;
            }
            impact.value = preview.value.revision.impact;
            phase.value = "ready";
            return;
        }
        if (preview.failure.code === "has-dependents" && Array.isArray(preview.failure.dependents)) {
            const ids = preview.failure.dependents as string[];
            dependents.value = ids;
            dependentTitles.value = ids.slice(0, DEPENDENTS_LISTED).map(() => null);
            phase.value = "dependents";
            const titles = await Promise.all(ids.slice(0, DEPENDENTS_LISTED).map(titleOf));
            if (mine !== run) return;
            dependentTitles.value = titles;
            return;
        }
        phase.value = "blocked";
        reason.value = blockedReason(preview.failure);
    };

    watch(() => requests.target.value, (target) => {
        if (target === null) {
            run += 1;
            reset();
            return;
        }
        void start(target);
    }, {immediate: true});

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
            options.notices.show({revision: result.value.revision, title: revertTitle});
            return;
        }
        const shown = failureText(result.failure);
        error.value = result.failure.code === "not-revertable" || result.failure.code === "author-source-required" ? blockedReason(result.failure) : shown.text;
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
