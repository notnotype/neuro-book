/**
 * 变更详情页上的两种写入（docs/specs/canon/author-ui.md 输出 21、29）：改其中一处数的改动（“改这一笔”），与待定的变更“改成
 * 生效”。都不用专门的内核方法：读出这条变更、换掉那一处的值或生效状态，照普通写入先预览再发布（canon.revisions 输出 7、8、
 * 17）。`baseVersion` 是读出它时的版本，读出以后它被别处改过时得到 `version-conflict`：写“这个对象刚被改过”，以重读到的那一份
 * 为准重新预览，要作者再点一次保存。
 *
 * 填了一半的输入（改哪一处、填的值、读出时的版本、请求 id）在标签状态里，切走再回来还在；预览、原因、保存中这些随组件。
 * 请求 id 在打开时定；结局不明时“再查一次”用同一个，被明确拒收以后换一个。
 */

import {computed, onScopeDispose, shallowRef, watch} from "vue";
import type {ComputedRef} from "vue";

import type {StoryChange, WriteRequest} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import type {Published} from "../shared/contracts";
import {failureText} from "./failures";
import {impactLines} from "./impact";
import type {CanonBoundText} from "./positions";
import type {CanonWorld} from "./world";
import type {CanonClient, CanonFailure} from "../shared/contracts";

/** 存在标签状态里的那部分。 */
export type ChangeDraft =
    | {kind: "patch"; index: number; value: string; base: number; requestId: string}
    | {kind: "activate"; base: number; requestId: string};

export interface ChangeWriteFeedback {
    /** 预览：带来的变化，一句一行；还没填好、正在预览、预览失败时为 null。 */
    readonly preview: readonly string[] | null;
    readonly previewing: boolean;
    readonly error: string;
    readonly recheck: boolean;
    readonly saving: boolean;
    /** 保存不可用（世界写不了、校验不过）。 */
    readonly locked: boolean;
}

export interface ChangeWriteOptions {
    readonly world: CanonWorld;
    readonly call: CanonClient["call"];
    readonly id: string;
    readonly draft: () => ChangeDraft | null;
    readonly setDraft: (draft: ChangeDraft | null) => void;
    /** 读到的这条变更与读出它时的版本；还没读到时为 undefined，不存在时 `change` 为 null。 */
    readonly read: () => {readonly change: StoryChange | null; readonly version: number} | undefined;
    readonly address: (at: {readonly entry: string; readonly path: string}) => string;
    readonly blocked: () => Text | null;
    readonly text: CanonBoundText;
    readonly resolve: (text: Text) => string;
    readonly saved: (published: Published, title: string) => void;
    /** 改一处保存或取消以后，焦点回到那一处的“改”。 */
    readonly refocus: (index: number) => void;
}

export interface ChangeWrite {
    readonly feedback: ComputedRef<ChangeWriteFeedback | null>;
    editPatch(index: number): void;
    activate(): void;
    update(value: string): void;
    save(): void;
    cancel(): void;
}

const PREVIEW_DELAY_MS = 300;
const newRequestId = (): string => `change-${crypto.randomUUID()}`;

/** 填的数：可以带千位分隔与正负号（含减号 −）；不成形时为 undefined。 */
function parsedNumber(value: string): number | undefined {
    const trimmed = value.trim().replace(/,/gu, "").replace(/^−/u, "-");
    if (trimmed === "") return undefined;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : undefined;
}

export function useChangeWrite(options: ChangeWriteOptions): ChangeWrite {
    const {text} = options;
    const preview = shallowRef<readonly string[] | null>(null);
    const previewing = shallowRef(false);
    const error = shallowRef("");
    const recheck = shallowRef(false);
    const saving = shallowRef(false);
    const invalid = shallowRef(false);
    let previewRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const titleOf = (draft: ChangeDraft, change: StoryChange): string => (draft.kind === "patch"
        ? text("change.patchSaved", {text: change.text, label: options.address(change.patches[draft.index]!.at)})
        : text("change.activateSaved", {text: change.text}));

    /** 照这份草稿要发的写入请求；读到的变更里已经没有那一处、填的数不成形时为 null。 */
    const requestOf = (draft: ChangeDraft): WriteRequest | null => {
        const change = options.read()?.change;
        if (change === null || change === undefined) return null;
        let after: StoryChange;
        if (draft.kind === "patch") {
            const value = parsedNumber(draft.value);
            if (change.patches[draft.index] === undefined || value === undefined) return null;
            after = {...change, patches: change.patches.map((patch, index) => (index === draft.index ? {...patch, value} : patch))};
        } else {
            const {held: _held, ...rest} = change;
            after = {...rest, status: "active"};
        }
        return {requestId: draft.requestId, by: {kind: "author"}, what: "edit", title: titleOf(draft, change), baseVersion: draft.base, puts: [{ref: {kind: "change", id: options.id}, after}]};
    };

    const applyFailure = (draft: ChangeDraft, failure: CanonFailure): void => {
        const shown = failureText(failure);
        error.value = options.resolve(shown.text);
        recheck.value = shown.recheck;
        invalid.value = failure.code === "validation-failed";
        if (shown.recheck) return;
        if (failure.code !== "version-conflict") {
            options.setDraft({...draft, requestId: newRequestId()});
            return;
        }
        // 被别处改过：以重读到的那一份为准，换成现在的版本重新预览（输出 29）。读取层还没读到那次改动时先不换，读到以后版本
        // 变了会再预览一次，那时再换。
        const version = options.read()?.version;
        if (version !== undefined && version > draft.base) options.setDraft({...draft, base: version, requestId: newRequestId()});
    };

    const runPreview = async (): Promise<void> => {
        const draft = options.draft();
        const mine = ++previewRun;
        if (draft === null) return;
        const request = requestOf(draft);
        if (request === null) {
            preview.value = null;
            previewing.value = false;
            return;
        }
        previewing.value = true;
        const result = await options.call("preview", {request});
        if (mine !== previewRun) return;
        previewing.value = false;
        if (result.ok) {
            preview.value = impactLines(result.value.revision.impact, {values: "change", address: options.address}, text);
            invalid.value = false;
            return;
        }
        preview.value = null;
        applyFailure(draft, result.failure);
    };

    const schedulePreview = (): void => {
        if (timer !== null) clearTimeout(timer);
        previewRun += 1;
        previewing.value = options.draft() !== null;
        timer = setTimeout(() => {
            timer = null;
            void runPreview();
        }, PREVIEW_DELAY_MS);
    };

    // 填的值、读出的版本变了，或世界变了（这一条可能被别处改过）：停一下再预览。只换了请求 id 不重新预览：预览不看请求 id，
    // 失败后换 id 再预览会一直失败下去。
    watch(() => {
        const draft = options.draft();
        return draft === null ? null : JSON.stringify([draft.kind, draft.kind === "patch" ? [draft.index, draft.value] : null, draft.base, options.read()?.version]);
    }, (key) => {
        if (key !== null) schedulePreview();
    }, {immediate: true});

    onScopeDispose(() => {
        if (timer !== null) clearTimeout(timer);
        previewRun += 1;
    });

    const reset = (): void => {
        preview.value = null;
        error.value = "";
        recheck.value = false;
        invalid.value = false;
    };

    const open = (draft: ChangeDraft): void => {
        reset();
        options.setDraft(draft);
    };

    const submit = async (): Promise<void> => {
        const draft = options.draft();
        if (draft === null || saving.value || options.blocked() !== null) return;
        const request = requestOf(draft);
        if (request === null) return;
        saving.value = true;
        const result = await options.world.write("publish", {request});
        saving.value = false;
        if (result.ok) {
            options.setDraft(null);
            reset();
            options.saved(result.value as Published, request.title);
            if (draft.kind === "patch") options.refocus(draft.index);
            return;
        }
        applyFailure(draft, result.failure);
    };

    return {
        feedback: computed(() => {
            if (options.draft() === null) return null;
            const blocked = options.blocked();
            return {
                preview: preview.value,
                previewing: previewing.value,
                error: blocked !== null ? options.resolve(blocked) : error.value,
                recheck: recheck.value,
                saving: saving.value,
                locked: blocked !== null || invalid.value,
            };
        }),
        editPatch: (index) => {
            const read = options.read();
            const patch = read?.change?.patches[index];
            if (read === undefined || patch === undefined) return;
            open({kind: "patch", index, value: String(patch.value), base: read.version, requestId: newRequestId()});
        },
        activate: () => {
            const read = options.read();
            if (read === undefined) return;
            open({kind: "activate", base: read.version, requestId: newRequestId()});
        },
        update: (value) => {
            const draft = options.draft();
            if (draft?.kind === "patch") options.setDraft({...draft, value});
            error.value = "";
            recheck.value = false;
        },
        save: () => void submit(),
        cancel: () => {
            const draft = options.draft();
            options.setDraft(null);
            reset();
            if (draft?.kind === "patch") options.refocus(draft.index);
        },
    };
}
