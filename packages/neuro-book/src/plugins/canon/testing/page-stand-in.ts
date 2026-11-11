/**
 * 组件测试里扮演编辑器与工作台的测试插件：定义 `editor.pages` 与 `workbench.overlays` 两个贡献点、收下 canon 交来的页面与浮层的
 * 实现，与产品里编辑器、工作台收下它们是同一条贡献通路（页面声明的补全与校验用产品的那份）。只收，不画：测试自己挂组件，按编辑器
 * 的做法给每个标签一份 `context`。
 */

import type {ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {completeEditorPageDeclaration, EDITOR_PAGES_POINT, validateEditorPageContribution} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {WORKBENCH_OVERLAYS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchOverlayImplementation} from "nbook/plugins/workbench/web/contracts";

export interface PageStandIn {
    readonly plugin: PluginDefinition;
    /** 交来的页面实现；没交时抛错。 */
    page<State extends object = Record<string, unknown>>(id: string): EditorPageImplementation<State>;
    /** 交来的浮层实现；没交时抛错。 */
    overlay(id: string): WorkbenchOverlayImplementation;
}

export function pageStandIn(): PageStandIn {
    const pages = new Map<string, ContributionHandle<EditorPageDeclaration, EditorPageImplementation>>();
    const overlays = new Map<string, ContributionHandle<unknown, WorkbenchOverlayImplementation>>();
    return {
        plugin: {
            id: "test.editor",
            contributionPoints: [{id: EDITOR_PAGES_POINT, implementation: "required", complete: completeEditorPageDeclaration, validate: validateEditorPageContribution}, {id: WORKBENCH_OVERLAYS_POINT, implementation: "required"}],
            entries: [{
                id: "browser", location: "browser", activationEvents: ["onStartup"], receives: [EDITOR_PAGES_POINT, WORKBENCH_OVERLAYS_POINT],
                activate: () => ({
                    receivers: {
                        [EDITOR_PAGES_POINT]: {published: (handle) => void pages.set(handle.id, handle as never), revoke: (handle) => void pages.delete(handle.id)},
                        [WORKBENCH_OVERLAYS_POINT]: {published: (handle) => void overlays.set(handle.id, handle as never), revoke: (handle) => void overlays.delete(handle.id)},
                    },
                }),
            }],
        },
        page: <State extends object>(id: string) => {
            const handle = pages.get(id);
            if (handle === undefined) throw new Error(`canon 没有交页面 ${id}`);
            return handle.implementation() as unknown as EditorPageImplementation<State>;
        },
        overlay: (id) => {
            const handle = overlays.get(id);
            if (handle === undefined) throw new Error(`canon 没有交浮层 ${id}`);
            return handle.implementation();
        },
    };
}
