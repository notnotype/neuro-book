/**
 * 就地改（docs/specs/canon/author-ui.md 输出 16、29 与“状态与转换”）：条目页的确认条背后的状态与写入。
 *
 * 填了一半的输入（改哪个字段、填的值、意图、读到的值与版本、请求 id）在标签状态里（`state.edit`），切走再回来还在；预览、
 * 原因、保存中这些随组件，回来时重取预览。
 *
 * 预览只对它基于的版本有效：填的值或意图变了，停 300 毫秒再预览；世界版本变了，这个值没变就重取预览，变了就写“这个值刚刚
 * 变了”并换上新读到的值（不等作者点保存）。保存用 `editInPlace`，请求 id 在打开确认条时定；结局不明时“再查一次”用同一个
 * 请求 id 与同一个输入重发（canon.revisions 输出 24），被明确拒收以后输入会变（读到的值换了），换一个新的请求 id。
 */

import {computed, onScopeDispose, shallowRef, watch} from "vue";
import type {ComputedRef} from "vue";

import type {FieldDeclaration, FieldState, Placement, ReadPosition} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import type {CanonClient, CanonOutputs, Published} from "../shared/contracts";
import type {ConfirmBarKind, EditIntent} from "./components/confirm-bar";
import {namespaceField} from "./entry-heads";
import {failureText} from "./failures";
import {impactIsQuiet, impactLines} from "./impact";
import {parseDecimal} from "./numbers";
import type {CanonBoundText} from "./positions";
import type {CanonWorld} from "./world";

/** 存在标签状态里的那部分。 */
export interface EditDraft {
    /** `<命名空间>.<字段>`。 */
    path: string;
    /** 填的值：数、文字、选项是字符串，是否是布尔，引用是条目 id（没选是 null），图片是 `{图片, 说明}`（未知是 null）。 */
    value: unknown;
    intent: EditIntent;
    read: {value: unknown; version: number};
    requestId: string;
    /** 在专门界面里就地改（输出 51）：挂着这条路径的 `FieldEditor` 时由它画，没有时照旧出确认条。 */
    inline?: boolean;
    /** 选着剧情里变了时作者写的“发生了什么”（选填，输出 16）：这次的修订标题与那一条剧情变更的文字。 */
    note?: string;
}

/** 确认条要画的东西（`ConfirmBar` 的 props）。 */
export interface ConfirmBarModel {
    readonly label: string;
    readonly kind: ConfirmBarKind;
    readonly options: readonly string[];
    readonly unit: string;
    readonly value: unknown;
    /** 引用字段可以指向的种类（`targets`）；别的字段为空。 */
    readonly targets: readonly string[];
    readonly intents: readonly EditIntent[];
    readonly intent: EditIntent;
    /** 两项意图的写法：“从最初起”“从第 3 章起”这一类（输出 16）。 */
    readonly intentLabels: {readonly creative: string; readonly story: string};
    /** “发生了什么”；不填时用 `noteFallback`。 */
    readonly note: string;
    readonly noteFallback: string;
    /** 没有别的变化时 `impact` 是空的（编辑卡不写预览，输出 16）。 */
    readonly preview: {readonly route: string; readonly impact: readonly string[]} | null;
    readonly previewing: boolean;
    readonly error: string;
    readonly recheck: boolean;
    readonly saving: boolean;
    readonly locked: boolean;
}

export interface InPlaceEditOptions {
    readonly world: CanonWorld;
    readonly call: CanonClient["call"];
    readonly entry: string;
    readonly draft: () => EditDraft | null;
    readonly setDraft: (draft: EditDraft | null) => void;
    readonly position: () => ReadPosition;
    /** 世界版本（条目读取的版本）。 */
    readonly version: () => number;
    readonly field: (path: string) => {readonly state: FieldState | undefined; readonly declaration: FieldDeclaration | undefined};
    readonly place: (at: Placement) => string;
    /** 一章写在界面上（“第 3 章”）：二选一里“从第 3 章起”的那一章。 */
    readonly chapter: (id: string) => string;
    /** 写入不可用的原因（`writable.ts`）；可以写时为 null。 */
    readonly blocked: () => Text | null;
    readonly text: CanonBoundText;
    readonly resolve: (text: Text) => string;
    /** 保存成功：给提示。`where` 是这次写回的位置（“最初”“第 3 章”“前史”），预览给出的路由没有位置时不给。 */
    readonly saved: (published: Published, title: string, where?: string) => void;
    /** 累出来的数：展开这个值的来历。 */
    readonly accumulated: (path: string) => void;
    /** 保存或取消以后，焦点回到这个字段的“改”按钮（输出 16、30）。 */
    readonly refocus: (path: string) => void;
}

/** 打开就地改时预先填的（换装：填好这一套的名字、预选“从这一章起”）。 */
export interface EditOpenOptions {
    readonly inline?: boolean;
    readonly value?: unknown;
    readonly intent?: EditIntent;
}

export interface InPlaceEdit {
    readonly bar: ComputedRef<ConfirmBarModel | null>;
    open(path: string, options?: EditOpenOptions): void;
    update(value: unknown): void;
    setIntent(intent: EditIntent): void;
    setNote(note: string): void;
    save(): void;
    recheck(): void;
    cancel(): void;
}

const PREVIEW_DELAY_MS = 300;

export const kindOf = (declaration: FieldDeclaration | undefined): ConfirmBarKind => {
    const kind = declaration?.kind;
    if (kind === "text" && declaration?.precision !== "semantic" && (declaration?.suggestions?.length ?? 0) > 0) return "suggest";
    return kind === "number" || kind === "enum" || kind === "boolean" || kind === "ref" || kind === "image" ? kind : "text";
};

/** 填的值换成字段的值；填得不成形（数里有字母）时为 undefined，不预览。引用写成 `{ref: id}`，清空是未知（null）。 */
export function parsed(value: unknown, kind: ConfirmBarKind): unknown {
    if (kind === "boolean") return value === true;
    if (kind === "ref") return typeof value === "string" && value !== "" ? {ref: value} : null;
    if (kind === "image") return value ?? null;
    if (kind !== "number") return String(value);
    return parseDecimal(String(value));
}

/** 字段的值换成填的值；语义档用起点（`unreduced.anchor`），不用显示的归纳文字：照着显示的改会把“起点；之后：……”写成新起点。 */
export const draftText = (state: Pick<FieldState, "value" | "unreduced"> | undefined, kind: ConfirmBarKind): unknown => {
    const value = state?.unreduced?.anchor ?? state?.value;
    if (kind === "boolean") return value === true;
    if (kind === "ref") return typeof value === "object" && value !== null && typeof (value as {ref?: unknown}).ref === "string" ? (value as {ref: string}).ref : null;
    if (kind === "image") return value ?? null;
    return value === null || value === undefined ? "" : String(value);
};

const newRequestId = (): string => `edit-${crypto.randomUUID()}`;

export function useInPlaceEdit(options: InPlaceEditOptions): InPlaceEdit {
    const {text} = options;
    const preview = shallowRef<{readonly route: string; readonly impact: readonly string[]} | null>(null);
    const previewing = shallowRef(false);
    const error = shallowRef("");
    const recheck = shallowRef(false);
    const saving = shallowRef(false);
    const locked = shallowRef(false);
    // 最近一次预览给出的写回位置，保存成功时交给提示。预览收起或作废时清掉；填的值、意图、读取位置与世界版本变了都会重取预览，
    // 所以保存时它对应的就是这次发出的输入。
    let previewedWhere: string | undefined;
    /**
     * 预览还没回来时按了保存（短项的回车，输出 51）：先把预览立刻发出去，回来以后除了这个值本身没有别的变化（`impactIsQuiet`）就保存；
     * 有的话把预览显示出来，作者看过、再按一次才保存，不让人没看见带来的变化就写进去。预览失败或换了一份填写时不保存。
     */
    let saveWhenPreviewed = false;
    // 每次预览一个号，晚到的作废。
    let previewRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const intentsOf = (path: string): EditIntent[] => {
        const state = options.field(path).state;
        if (state?.incomplete !== undefined) return ["story"];
        return options.position().kind === "initial" ? ["creative"] : ["creative", "story"];
    };

    /**
     * 二选一的写法（输出 16）：改设定写“从<来源>起”，来源是这个值最近一次定下的地方（某一章、前史，没有就是最初）；剧情里变了写
     * “从<所选位置那一章>起”。来源就是所选的那一章时两项会同名，改写成“改第 3 章那一笔”“第 3 章里又变了”。来源只在计划里（未安放）
     * 时说不出从哪起，退回“改设定”。看最初时只有改设定，这一行不出，写法无所谓。
     */
    const intentLabelsOf = (path: string): {creative: string; story: string} => {
        const position = options.position();
        const changed = options.field(path).state?.changedAt;
        const here = position.kind === "chapter" ? options.chapter(position.chapter) : null;
        if (changed !== undefined && changed.at.kind === "chapter" && position.kind === "chapter" && changed.at.chapter === position.chapter) {
            return {creative: text("edit.patchHere", {place: here!}), story: text("edit.storyAgain", {place: here!})};
        }
        const creative = changed === undefined ? text("edit.since", {place: text("position.initial")}) : changed.at.kind === "unscheduled" ? text("edit.creative") : text("edit.since", {place: options.place(changed.at)});
        return {creative, story: here === null ? text("edit.story") : text("edit.since", {place: here})};
    };
    /** 不写“发生了什么”时剧情里变了的标题：值短就写“年龄变成 18 岁”，长的、引用、图片、是否写“性格变了”。 */
    const storyFallback = (draft: EditDraft): string => {
        const label = labelOf(draft.path);
        const declaration = options.field(draft.path).declaration;
        const kind = kindOf(declaration);
        const shown = kind === "ref" || kind === "image" || kind === "boolean" ? "" : `${String(draft.value ?? "").trim()}${kind === "number" && declaration?.unit !== undefined && declaration.unit !== "" ? ` ${declaration.unit}` : ""}`;
        return shown === "" || shown.length > 20 || shown.includes("\n") ? text("edit.storyTitleLong", {label}) : text("edit.storyTitle", {label, value: shown});
    };
    const titleOf = (draft: EditDraft): string => (draft.intent === "story" ? (draft.note?.trim() || storyFallback(draft)) : text("edit.heading", {label: labelOf(draft.path)}));

    const labelOf = (path: string): string => {
        const field = options.field(path);
        return field.declaration?.label ?? field.state?.label ?? path.slice(path.indexOf(".") + 1);
    };

    const resetFeedback = (): void => {
        preview.value = null;
        previewedWhere = undefined;
        error.value = "";
        recheck.value = false;
        locked.value = false;
    };

    /** 预览给作者看的两句：写回哪里、带来的变化。 */
    const describe = async (result: CanonOutputs["previewEdit"]): Promise<{route: string; where: string | undefined; impact: string[]; quiet: boolean}> => {
        const route = result.route;
        let routeText: string;
        let where: string | undefined;
        if (route.kind === "init") {
            routeText = text("edit.routeInit");
            where = text("position.initial");
        } else if (route.kind === "patch") {
            const read = await options.call("object", {ref: {kind: "change", id: route.change}});
            const change = read.ok ? (read.value.object as {readonly text?: string; readonly at?: Placement} | null) : null;
            const place = change?.at === undefined ? "" : options.place(change.at);
            // 没安放的（只在计划里的）那一笔不说记在哪：“记在未安放”读不通。
            where = change?.at === undefined || change.at.kind === "unscheduled" ? undefined : place;
            routeText = text("edit.routePatch", {place, text: change?.text ?? ""});
        } else if (route.kind === "change") {
            where = options.place(route.at);
            routeText = text("edit.routeChange", {position: where});
        }
        // 就地改不会给出这一种（它改的是一个字段）；路由是会再加种类的联合，不认识的也要有一句话。
        else routeText = text("edit.routeEntry");
        const draft = options.draft();
        const skip = (at: {readonly entry: string; readonly path: string}): boolean => at.entry === options.entry && at.path === draft?.path;
        const impact = impactLines(result.revision.impact, {
            values: "follows",
            skip,
            address: (at) => (at.entry === options.entry ? labelOf(at.path) : namespaceField(at.path).field),
        }, text);
        const quiet = impactIsQuiet(result.revision.impact, skip);
        // 没有别的变化时不写（编辑卡里那一行不占地方，输出 16）；写回哪里已经在二选一的写法里。
        return {route: routeText, where, impact: quiet ? [] : impact, quiet};
    };

    const inputOf = (draft: EditDraft): Record<string, unknown> | null => {
        const value = parsed(draft.value, kindOf(options.field(draft.path).declaration));
        if (value === undefined) return null;
        return {requestId: draft.requestId, by: {kind: "author"}, position: options.position(), at: {entry: options.entry, path: draft.path}, value, read: draft.read, intent: draft.intent, title: titleOf(draft)};
    };

    const runPreview = async (): Promise<void> => {
        const draft = options.draft();
        const mine = ++previewRun;
        if (draft === null) return;
        const input = inputOf(draft);
        if (input === null) {
            preview.value = null;
        previewedWhere = undefined;
            previewing.value = false;
            return;
        }
        previewing.value = true;
        const result = await options.call("previewEdit", {input: {kind: "edit", ...input}} as never);
        if (mine !== previewRun) return;
        previewing.value = false;
        if (result.ok) {
            const described = await describe(result.value as CanonOutputs["previewEdit"]);
            if (mine !== previewRun) return;
            preview.value = {route: described.route, impact: described.impact};
            previewedWhere = described.where;
            locked.value = false;
            const waiting = saveWhenPreviewed;
            saveWhenPreviewed = false;
            if (waiting && described.quiet) void submit();
            return;
        }
        saveWhenPreviewed = false;
        preview.value = null;
        previewedWhere = undefined;
        applyFailure(draft, result.failure);
    };

    const schedulePreview = (): void => {
        if (timer !== null) clearTimeout(timer);
        // 值又变了：先前按下的保存针对的是旧值，不再算数。
        saveWhenPreviewed = false;
        previewRun += 1;
        previewing.value = options.draft() !== null;
        timer = setTimeout(() => {
            timer = null;
            void runPreview();
        }, PREVIEW_DELAY_MS);
    };

    const applyFailure = (draft: EditDraft, failure: {readonly code: string; readonly [detail: string]: unknown}): void => {
        // 结果回来时这次填写已经放弃或换了一个（取消、点了浮层外面、改了别的字段）：不写回。还在的就在它现在的样子上改，
        // 不用发出请求那一刻的草稿（作者这期间可能又改了值）。
        const current = options.draft();
        if (current === null || current.requestId !== draft.requestId || current.path !== draft.path) return;
        const shown = failureText(failure);
        error.value = options.resolve(shown.text);
        recheck.value = shown.recheck;
        if (failure.code === "accumulated-value") {
            locked.value = true;
            options.accumulated(draft.path);
        }
        if (failure.code === "value-conflict") options.setDraft({...current, read: {value: failure.current, version: options.version()}, requestId: newRequestId()});
        else if (!shown.recheck) options.setDraft({...current, requestId: newRequestId()});
    };

    // 填的值、意图变了：停一下再预览。
    watch(() => {
        const draft = options.draft();
        return draft === null ? null : JSON.stringify([draft.path, draft.value, draft.intent, draft.read, options.position()]);
    }, (key) => {
        if (key === null) return;
        schedulePreview();
    }, {immediate: true});

    // 世界版本变了：这个值没变就重取预览；变了就写“这个值刚刚变了”并换上新值（输出 29）。
    watch(options.version, () => {
        const draft = options.draft();
        if (draft === null) return;
        const now = options.field(draft.path).state?.value;
        if (JSON.stringify(now) !== JSON.stringify(draft.read.value)) {
            options.setDraft({...draft, read: {value: now, version: options.version()}, requestId: newRequestId()});
            error.value = options.resolve(failureText({code: "value-conflict"}).text);
        } else options.setDraft({...draft, read: {value: draft.read.value, version: options.version()}});
    });

    onScopeDispose(() => {
        if (timer !== null) clearTimeout(timer);
        previewRun += 1;
    });

    const submit = async (): Promise<void> => {
        const draft = options.draft();
        if (draft === null || saving.value) return;
        const input = inputOf(draft);
        if (input === null) return;
        saving.value = true;
        const result = await options.world.write("editInPlace", input as never);
        saving.value = false;
        if (result.ok) {
            const label = labelOf(draft.path);
            options.saved(result.value as Published, String(input.title ?? text("edit.heading", {label})), previewedWhere);
            // 保存在途时作者开了别的字段（点了另一个值）：那一份草稿、它的预览与焦点都留着。只比路径：这次写入发布的新版本
            // 可能先于结果到达，版本的 watch 已经给同一份草稿换了 requestId。
            const current = options.draft();
            if (current !== null && current.path !== draft.path) return;
            options.setDraft(null);
            resetFeedback();
            options.refocus(draft.path);
            return;
        }
        applyFailure(draft, result.failure);
    };

    return {
        bar: computed(() => {
            const draft = options.draft();
            if (draft === null) return null;
            const declaration = options.field(draft.path).declaration;
            const blocked = options.blocked();
            return {
                label: labelOf(draft.path),
                kind: kindOf(declaration),
                options: kindOf(declaration) === "suggest" ? declaration?.suggestions ?? [] : declaration?.options ?? [],
                unit: declaration?.unit ?? "",
                value: draft.value,
                targets: declaration?.kind === "ref" ? declaration.targets ?? [] : [],
                intents: intentsOf(draft.path),
                intent: draft.intent,
                intentLabels: intentLabelsOf(draft.path),
                note: draft.note ?? "",
                noteFallback: storyFallback(draft),
                preview: preview.value,
                previewing: previewing.value,
                error: blocked !== null ? options.resolve(blocked) : error.value,
                recheck: recheck.value,
                saving: saving.value,
                locked: locked.value || blocked !== null,
            };
        }),
        open: (path, given = {}) => {
            const state = options.field(path).state;
            const kind = kindOf(options.field(path).declaration);
            const intents = intentsOf(path);
            resetFeedback();
            options.setDraft({
                path,
                value: given.value === undefined ? draftText(state, kind) : given.value,
                intent: given.intent !== undefined && intents.includes(given.intent) ? given.intent : intents[0]!,
                read: {value: state?.value ?? null, version: options.version()},
                requestId: newRequestId(),
                ...(given.inline === true ? {inline: true} : {}),
            });
        },
        update: (value) => {
            const draft = options.draft();
            if (draft !== null) options.setDraft({...draft, value});
            error.value = "";
            recheck.value = false;
        },
        setIntent: (intent) => {
            const draft = options.draft();
            if (draft !== null) options.setDraft({...draft, intent});
        },
        setNote: (note) => {
            const draft = options.draft();
            if (draft !== null) options.setDraft({...draft, note});
        },
        save: () => {
            if (!previewing.value) {
                if (preview.value !== null) void submit();
                return;
            }
            // 预览还在等（停顿计时没到，或请求在途）：计时没到的立刻发出去，回来以后照上面的规矩决定存不存。
            saveWhenPreviewed = true;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
                void runPreview();
            }
        },
        recheck: () => void submit(),
        cancel: () => {
            const draft = options.draft();
            options.setDraft(null);
            resetFeedback();
            if (draft !== null) options.refocus(draft.path);
        },
    };
}
