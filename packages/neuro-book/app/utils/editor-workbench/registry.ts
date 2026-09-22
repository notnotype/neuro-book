import type {EditorContribution, EditorResource} from "nbook/app/components/editor-workbench/editor-view.types";
import {resolveWorkspaceFileExtension} from "nbook/shared/editor-workbench";

export type EditorRegistry = Readonly<{
    get(id: string): EditorContribution | null;
    available(resource: EditorResource): readonly EditorContribution[];
}>;

/** 注册来自产品代码；配置只引用 ID，不能装载可执行模块。 */
export function createEditorRegistry(contributions: readonly EditorContribution[]):
    {ok: true; value: EditorRegistry} | {ok: false; reason: string} {
    const entries = new Map<string, EditorContribution>();
    for (const contribution of contributions) {
        if (!contribution.id || /\s/u.test(contribution.id) || entries.has(contribution.id)) {
            return {ok: false, reason: `编辑器标识无效或重复：${contribution.id}`};
        }
        entries.set(contribution.id, contribution);
    }
    if (!entries.has("code")) return {ok: false, reason: "缺少源码编辑器。"};
    return {ok: true, value: {
        get: (id) => entries.get(id) ?? null,
        available: (resource) => Array.from(entries.values()).filter((entry) => entry.supports(resource)),
    }};
}

export function resolveEditorAssociation(input: {
    resource: EditorResource;
    requestedId: string | null;
    associations: Readonly<Record<string, string>>;
    registry: EditorRegistry;
}): {editor: EditorContribution | null; diagnosis: string | null} {
    if (!input.resource.editable) return {editor: null, diagnosis: null};
    const id = input.requestedId ?? input.associations[resolveWorkspaceFileExtension(input.resource.path)] ?? "code";
    const requested = input.registry.get(id);
    if (requested?.supports(input.resource)) return {editor: requested, diagnosis: null};
    const code = input.registry.get("code");
    return {
        editor: code?.supports(input.resource) ? code : null,
        diagnosis: `打开方式“${id}”不可用，当前使用源码编辑器。`,
    };
}
