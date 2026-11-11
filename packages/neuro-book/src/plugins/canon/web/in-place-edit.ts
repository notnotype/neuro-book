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

import {displayText} from "@notnotype/nb-canon/schema";
import type {FieldDeclaration, FieldState, Placement, ReadPosition} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import type {CanonClient, CanonOutputs, Published} from "../shared/contracts";
import type {ConfirmBarKind, EditIntent} from "./components/confirm-bar";
import {failureText} from "./failures";
import type {CanonBoundText} from "./positions";
import type {CanonWorld} from "./world";

/** 存在标签状态里的那部分。 */
export interface EditDraft {
    /** `<命名空间>.<字段>`。 */
    path: string;
    value: string | boolean;
    intent: EditIntent;
    read: {value: unknown; version: number};
    requestId: string;
}

/** 确认条要画的东西（`ConfirmBar` 的 props）。 */
export interface ConfirmBarModel {
    readonly label: string;
    readonly kind: ConfirmBarKind;
    readonly options: readonly string[];
    readonly unit: string;
    readonly value: string | boolean;
    readonly intents: readonly EditIntent[];
    readonly intent: EditIntent;
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
    /** 写入不可用的原因（`writable.ts`）；可以写时为 null。 */
    readonly blocked: () => Text | null;
    readonly text: CanonBoundText;
    readonly resolve: (text: Text) => string;
    /** 保存成功：给提示。 */
    readonly saved: (published: Published, title: string) => void;
    /** 累出来的数：展开这个值的来历。 */
    readonly accumulated: (path: string) => void;
    /** 保存或取消以后，焦点回到这个字段的“改”按钮（输出 16、30）。 */
    readonly refocus: (path: string) => void;
}

export interface InPlaceEdit {
    readonly bar: ComputedRef<ConfirmBarModel | null>;
    open(path: string): void;
    update(value: string | boolean): void;
    setIntent(intent: EditIntent): void;
    save(): void;
    recheck(): void;
    cancel(): void;
}

const PREVIEW_DELAY_MS = 300;

const kindOf = (declaration: FieldDeclaration | undefined): ConfirmBarKind => {
    const kind = declaration?.kind;
    return kind === "number" || kind === "enum" || kind === "boolean" ? kind : "text";
};

/** 填的值换成字段的值；填得不成形（数里有字母）时为 undefined，不预览。 */
function parsed(value: string | boolean, kind: ConfirmBarKind): unknown {
    if (kind === "boolean") return value === true;
    if (kind !== "number") return String(value);
    const trimmed = String(value).trim();
    if (trimmed === "") return undefined;
    const number = Number(trimmed.replace(/,/gu, ""));
    return Number.isFinite(number) ? number : undefined;
}

const draftText = (value: unknown, kind: ConfirmBarKind): string | boolean => {
    if (kind === "boolean") return value === true;
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
    // 每次预览一个号，晚到的作废。
    let previewRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const intentsOf = (path: string): EditIntent[] => {
        const state = options.field(path).state;
        if (state?.incomplete !== undefined) return ["story"];
        return options.position().kind === "initial" ? ["creative"] : ["creative", "story"];
    };

    const labelOf = (path: string): string => {
        const field = options.field(path);
        return field.declaration?.label ?? field.state?.label ?? path.slice(path.indexOf(".") + 1);
    };

    const resetFeedback = (): void => {
        preview.value = null;
        error.value = "";
        recheck.value = false;
        locked.value = false;
    };

    /** 预览给作者看的两句：写回哪里、带来的变化。 */
    const describe = async (result: CanonOutputs["previewEdit"]): Promise<{route: string; impact: string[]}> => {
        const route = result.route;
        let routeText: string;
        if (route.kind === "init") routeText = text("edit.routeInit");
        else if (route.kind === "patch") {
            const read = await options.call("object", {ref: {kind: "change", id: route.change}});
            const change = read.ok ? (read.value.object as {readonly text?: string; readonly at?: Placement} | null) : null;
            routeText = text("edit.routePatch", {place: change?.at === undefined ? "" : options.place(change.at), text: change?.text ?? ""});
        } else routeText = text("edit.routeChange", {position: options.place(route.at)});
        const impact = result.revision.impact;
        const lines: string[] = [];
        if (impact.pendingAdded.length > 0) lines.push(text("edit.pendingAdded", {count: impact.pendingAdded.length}));
        if (impact.pendingResolved.length > 0) lines.push(text("edit.pendingResolved", {count: impact.pendingResolved.length}));
        const draft = options.draft();
        for (const value of impact.values) {
            if (value.at.entry === options.entry && value.at.path === draft?.path) continue;
            const label = value.at.entry === options.entry ? labelOf(value.at.path) : value.at.path.slice(value.at.path.indexOf(".") + 1);
            lines.push(text("edit.valueFollows", {label, value: displayText(value.after)}));
        }
        if (lines.length === 0) lines.push(text("edit.noImpact"));
        return {route: routeText, impact: lines};
    };

    const inputOf = (draft: EditDraft): Record<string, unknown> | null => {
        const value = parsed(draft.value, kindOf(options.field(draft.path).declaration));
        if (value === undefined) return null;
        return {requestId: draft.requestId, by: {kind: "author"}, position: options.position(), at: {entry: options.entry, path: draft.path}, value, read: draft.read, intent: draft.intent, title: text("edit.heading", {label: labelOf(draft.path)})};
    };

    const runPreview = async (): Promise<void> => {
        const draft = options.draft();
        const mine = ++previewRun;
        if (draft === null) return;
        const input = inputOf(draft);
        if (input === null) {
            preview.value = null;
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
            preview.value = described;
            locked.value = false;
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

    const applyFailure = (draft: EditDraft, failure: {readonly code: string; readonly [detail: string]: unknown}): void => {
        const shown = failureText(failure);
        error.value = options.resolve(shown.text);
        recheck.value = shown.recheck;
        if (failure.code === "accumulated-value") {
            locked.value = true;
            options.accumulated(draft.path);
        }
        if (failure.code === "value-conflict") options.setDraft({...draft, read: {value: failure.current, version: options.version()}, requestId: newRequestId()});
        else if (!shown.recheck) options.setDraft({...draft, requestId: newRequestId()});
    };

    // 填的值、意图变了：停一下再预览。
    watch(() => {
        const draft = options.draft();
        return draft === null ? null : JSON.stringify([draft.path, draft.value, draft.intent, draft.read]);
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
            options.setDraft(null);
            resetFeedback();
            options.saved(result.value as Published, String(input.title ?? text("edit.heading", {label})));
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
                options: declaration?.options ?? [],
                unit: declaration?.unit ?? "",
                value: draft.value,
                intents: intentsOf(draft.path),
                intent: draft.intent,
                preview: preview.value,
                previewing: previewing.value,
                error: blocked !== null ? options.resolve(blocked) : error.value,
                recheck: recheck.value,
                saving: saving.value,
                locked: locked.value || blocked !== null,
            };
        }),
        open: (path) => {
            const state = options.field(path).state;
            const kind = kindOf(options.field(path).declaration);
            resetFeedback();
            options.setDraft({path, value: draftText(state?.value, kind), intent: intentsOf(path)[0]!, read: {value: state?.value ?? null, version: options.version()}, requestId: newRequestId()});
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
        save: () => void submit(),
        recheck: () => void submit(),
        cancel: () => {
            const draft = options.draft();
            options.setDraft(null);
            resetFeedback();
            if (draft !== null) options.refocus(draft.path);
        },
    };
}
