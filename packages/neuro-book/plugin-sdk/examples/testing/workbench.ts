/**
 * 场地里的工作台替身：只拥有视图、状态栏条目、主题与场景提供者四个贡献点，把交来的实现收进表，场景直接读条目的 `text()`、视图的 `load()`、提供者的 `scene()`。
 * 场地不装真正的工作台（`nbook.workbench`）：它要页面与布局，Bun 里起不来。
 *
 * 替身与真实工作台的合同对齐：这些贡献点直接用产品里同一份定义（`shared/views.ts`、`shared/items.ts`、`shared/themes.ts`），id、要求实现、
 * id 前缀、没写 `title` 时补约定键（docs/specs/ui/i18n.md 的“约定键”）与声明校验都相同，所以替身接受的声明，真实工作台也接受。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {statusbarItemsPoint, WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/items";
import {themeScenesPoint, themesPoint} from "nbook/plugins/workbench/shared/themes";
import {WORKBENCH_THEME_SCENES_POINT} from "nbook/plugins/workbench/shared/theme-points";
import type {SceneProviderImplementation} from "nbook/plugins/workbench/shared/theme-points";
import {viewsPoint, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewImplementation} from "nbook/plugins/workbench/web/contracts";

export interface WorkbenchStandIn {
    readonly definition: PluginDefinition;
    /** 此刻交到的状态栏条目的实现；贡献方停止后撤回。 */
    item(id: string): ItemImplementation | null;
    view(id: string): ViewImplementation | null;
    /** 此刻交到的场景提供者的实现（`workbench.theme-scenes`）；贡献方停止后撤回。 */
    sceneProvider(id: string): SceneProviderImplementation | null;
}

export function workbenchStandIn(): WorkbenchStandIn {
    const items = new Map<string, ContributionHandle<unknown, ItemImplementation>>();
    const views = new Map<string, ContributionHandle<unknown, ViewImplementation>>();
    const sceneProviders = new Map<string, ContributionHandle<unknown, SceneProviderImplementation>>();
    const receiver = <T>(table: Map<string, ContributionHandle<unknown, T>>) => ({
        published: (handle: ContributionHandle<unknown, T>) => void table.set(handle.id, handle),
        revoke: (handle: ContributionHandle<unknown, T>) => {
            if (table.get(handle.id) === handle) table.delete(handle.id);
        },
    });
    return {
        definition: {
            id: "nbook.workbench",
            contributionPoints: [viewsPoint, statusbarItemsPoint, themeScenesPoint, themesPoint],
            entries: [defineEntry({
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                receives: [WORKBENCH_VIEWS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_THEME_SCENES_POINT],
                activate: () => ({receivers: {[WORKBENCH_VIEWS_POINT]: receiver(views), [WORKBENCH_STATUSBAR_ITEMS_POINT]: receiver(items), [WORKBENCH_THEME_SCENES_POINT]: receiver(sceneProviders)}}),
            })],
        },
        item: (id) => items.get(id)?.implementation() ?? null,
        view: (id) => views.get(id)?.implementation() ?? null,
        sceneProvider: (id) => sceneProviders.get(id)?.implementation() ?? null,
    };
}
