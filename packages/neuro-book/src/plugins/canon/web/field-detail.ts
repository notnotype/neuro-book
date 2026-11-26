/**
 * 一个值的细节（docs/specs/canon/author-ui.md 输出 11、13、17、51）：来历按页读、语义档的各句、记一笔或记一句。通用字段表与
 * 专门界面的 `FieldDetail` 共用这一份，不写两套。
 *
 * 路径都是完整的 `<命名空间>.<字段>`。来历在世界版本、所选位置或模式变了以后重读（来历按位置算）。记一笔的草稿按字段存在分页
 * 状态（`context.state.records`）里，切走再回来还在；一次只记一笔：保存中展开别的字段，它的表单也是保存中。
 */

import {computed, shallowRef} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import type {ComponentViewContext} from "./component-views";
import {useOriginPagesMap} from "./origin-pages";
import type {OriginPages} from "./origin-pages";
import {isSemantic} from "./rows";
import {useCanonText} from "./text";

export interface RecordDraft {
    readonly delta: string;
    readonly text: string;
}

export interface FieldDetail {
    /** 要读来历的各个路径的分页读取。 */
    readonly pages: Readonly<ShallowRef<ReadonlyMap<string, OriginPages>>>;
    /** 写不了（只读、独占、按计划）时的原因；可以写时为空。 */
    readonly editReason: ComputedRef<string>;
    /** 记一笔不可用的原因（写不了，或所选位置是初值）；可以记时为空。 */
    readonly recordReason: ComputedRef<string>;
    /** 这个字段能不能记一笔：语义档与数。 */
    recordable(path: string): boolean;
    draftOf(path: string): RecordDraft;
    setDraft(path: string, patch: Partial<RecordDraft>): void;
    /** 失败的原因按字段记：保存中作者展开了别的字段，回来的原因仍写在记的那个字段下面。 */
    readonly recordErrors: ShallowRef<Readonly<Record<string, string>>>;
    readonly savingPath: ShallowRef<string | null>;
    submit(path: string): Promise<void>;
    clearErrors(): void;
}

export function useFieldDetail(context: ComponentViewContext, keys: () => readonly string[]): FieldDetail {
    const text = useCanonText();
    const port = useText();
    const prefix = `${context.namespace}.`;
    const fieldOf = (path: string): string => path.slice(prefix.length);
    const declarationOf = (path: string) => context.declarations.find((declaration) => declaration.id === fieldOf(path));
    // 版本、位置、模式任一变了都重读（来历按位置算）。
    const stamp = (): string => `${String(context.version)}|${JSON.stringify(context.position)}|${context.mode}`;
    const pages = useOriginPagesMap(keys, (path) => (cursor) => context.origins(fieldOf(path), cursor), stamp);

    const editReason = computed(() => (context.blocked === null ? "" : port.t(context.blocked)));
    const recordReason = computed(() => (editReason.value !== "" ? editReason.value : context.position.kind === "initial" ? text("blocked.initial") : ""));
    const recordErrors = shallowRef<Readonly<Record<string, string>>>({});
    const savingPath = shallowRef<string | null>(null);
    const drafts = computed(() => (context.state.records ?? {}) as Readonly<Record<string, RecordDraft>>);
    const draftOf = (path: string): RecordDraft => drafts.value[path] ?? {delta: "", text: ""};
    const setDraft = (path: string, patch: Partial<RecordDraft>): void => {
        context.state.records = {...drafts.value, [path]: {...draftOf(path), ...patch}};
        if (recordErrors.value[path] !== undefined) recordErrors.value = {...recordErrors.value, [path]: ""};
    };

    return {
        pages,
        editReason,
        recordReason,
        recordable: (path) => {
            const declaration = declarationOf(path);
            return isSemantic(declaration) || declaration?.kind === "number";
        },
        draftOf,
        setDraft,
        recordErrors,
        savingPath,
        submit: async (path) => {
            if (savingPath.value !== null) return;
            savingPath.value = path;
            const draft = draftOf(path);
            const delta = Number(draft.delta.trim().replace(/,/gu, ""));
            const result = await context.record(fieldOf(path), {text: draft.text.trim(), ...(isSemantic(declarationOf(path)) ? {} : {delta})});
            savingPath.value = null;
            if (result.ok) setDraft(path, {delta: "", text: ""});
            recordErrors.value = {...recordErrors.value, [path]: result.ok ? "" : port.t(result.reason)};
        },
        clearErrors: () => {
            recordErrors.value = {};
        },
    };
}
