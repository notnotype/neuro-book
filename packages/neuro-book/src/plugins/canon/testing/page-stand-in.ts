/**
 * 组件测试里扮演编辑器与工作台的测试插件：定义 `editor.pages`、`workbench.overlays`、`workbench.views` 与
 * `workbench.statusbar-items` 四个贡献点，收下 canon 交来的实现，与产品里编辑器、工作台收下它们是同一条贡献通路（页面声明的
 * 补全与校验用产品的那份；视图与条目只收，不校验）。只收，不画：测试自己挂组件，按编辑器的做法给每个标签一份 `context`，按
 * 工作台的做法给每个视图一份 `context`。
 */

import type {ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {completeEditorPageDeclaration, EDITOR_PAGES_POINT, validateEditorPageContribution} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {WORKBENCH_OVERLAYS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ItemDeclaration, ViewDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {ItemImplementation, ViewImplementation, WorkbenchOverlayImplementation} from "nbook/plugins/workbench/web/contracts";

export interface PageStandIn {
    readonly plugin: PluginDefinition;
    /** 交来的页面实现；没交时抛错。 */
    page<State extends object = Record<string, unknown>>(id: string): EditorPageImplementation<State>;
    /** 交来的浮层实现；没交时抛错。 */
    overlay(id: string): WorkbenchOverlayImplementation;
    /** 交来的视图的声明与实现；没交时抛错。 */
    view(id: string): {readonly declaration: ViewDeclaration; readonly implementation: ViewImplementation};
    /** 交来的状态栏条目的声明与实现；没交时抛错。 */
    statusItem(id: string): {readonly declaration: ItemDeclaration; readonly implementation: ItemImplementation};
}

export function pageStandIn(): PageStandIn {
    const pages = new Map<string, ContributionHandle<EditorPageDeclaration, EditorPageImplementation>>();
    const overlays = new Map<string, ContributionHandle<unknown, WorkbenchOverlayImplementation>>();
    const views = new Map<string, ContributionHandle<ViewDeclaration, ViewImplementation>>();
    const items = new Map<string, ContributionHandle<ItemDeclaration, ItemImplementation>>();
    const keep = <D, I>(map: Map<string, ContributionHandle<D, I>>) => ({published: (handle: ContributionHandle<unknown, unknown>) => void map.set(handle.id, handle as never), revoke: (handle: ContributionHandle<unknown, unknown>) => void map.delete(handle.id)});
    const take = <D, I>(map: Map<string, ContributionHandle<D, I>>, what: string, id: string): ContributionHandle<D, I> => {
        const handle = map.get(id);
        if (handle === undefined) throw new Error(`canon 没有交${what} ${id}`);
        return handle;
    };
    const points = [EDITOR_PAGES_POINT, WORKBENCH_OVERLAYS_POINT, WORKBENCH_VIEWS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT];
    return {
        plugin: {
            id: "test.editor",
            contributionPoints: [
                {id: EDITOR_PAGES_POINT, implementation: "required", complete: completeEditorPageDeclaration, validate: validateEditorPageContribution},
                {id: WORKBENCH_OVERLAYS_POINT, implementation: "required"},
                {id: WORKBENCH_VIEWS_POINT, implementation: "required"},
                {id: WORKBENCH_STATUSBAR_ITEMS_POINT, implementation: "required"},
            ],
            entries: [{
                id: "browser", location: "browser", activationEvents: ["onStartup"], receives: points,
                activate: () => ({
                    receivers: {
                        [EDITOR_PAGES_POINT]: keep(pages),
                        [WORKBENCH_OVERLAYS_POINT]: keep(overlays),
                        [WORKBENCH_VIEWS_POINT]: keep(views),
                        [WORKBENCH_STATUSBAR_ITEMS_POINT]: keep(items),
                    },
                }),
            }],
        },
        page: <State extends object>(id: string) => take(pages, "页面", id).implementation() as unknown as EditorPageImplementation<State>,
        overlay: (id) => take(overlays, "浮层", id).implementation(),
        view: (id) => {
            const handle = take(views, "视图", id);
            return {declaration: handle.declaration, implementation: handle.implementation()};
        },
        statusItem: (id) => {
            const handle = take(items, "状态栏条目", id);
            return {declaration: handle.declaration, implementation: handle.implementation()};
        },
    };
}
