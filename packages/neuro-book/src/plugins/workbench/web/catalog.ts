/**
 * 工作台的界面目录（docs/specs/workbench/views.md 输出 23，`workbenchCatalogKey`）：从视图与容器的目录、当前布局、活动栏与视图标题栏
 * 的声明拼出一份只读投影。每次 `read()` 现算：这些读取方一次只问一回（Agent 找界面入口），不值得为它维护一份随布局更新的缓存。
 */

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";

import type {TextResolver} from "nbook/shared/localized-text";

import type {WorkbenchCatalog, WorkbenchCatalogView} from "../shared/contracts";
import type {ActivityBarItemDeclaration} from "../shared/items";
import type {ViewTitleItemDeclaration} from "../shared/menus";
import {VIEW_ACTIONS_MAX, VIEW_LOCATIONS} from "../shared/views";
import {viewSection} from "./state/containers";
import type {ContainerCatalog} from "./state/containers";
import {regionEntries} from "./state/layout-present";
import type {ViewCatalog} from "./views/registry";

export interface WorkbenchCatalogSource {
    /** 当前布局；外壳还没挂载、布局没建出来时是 null。 */
    document(): LayoutDoc | null;
    readonly views: ViewCatalog;
    readonly containers: ContainerCatalog;
    readonly activityItems: ReadonlyArray<ContributionDescriptor<ActivityBarItemDeclaration>>;
    readonly viewTitleItems: ReadonlyArray<ContributionDescriptor<ViewTitleItemDeclaration>>;
    readonly text: TextResolver;
}

export function createWorkbenchCatalog(source: WorkbenchCatalogSource): WorkbenchCatalog {
    return {read: () => readCatalog(source)};
}

function readCatalog(source: WorkbenchCatalogSource): WorkbenchCatalogView {
    const doc = source.document();
    const contributed = new Map<string, string[]>();
    for (const {declaration} of source.viewTitleItems) {
        if (declaration.placement === "menu") continue;
        contributed.set(declaration.view, [...(contributed.get(declaration.view) ?? []), declaration.command]);
    }
    return {
        views: [...source.views].map(([id, declaration]) => ({
            id,
            title: source.text.t(declaration.title),
            container: doc === null ? null : (viewSection(doc, id)?.container ?? null),
            placed: doc !== null && Object.values(doc.panels).some((panel) => panel.tabs.some((tab) => tab.kind === "view" && tab.viewId === id)),
            // 视图自己的按钮在前、别的插件贡献的在后，同外壳画的顺序（views.md 输出 10、11）；同外壳一样至多 VIEW_ACTIONS_MAX 个，
            // 再多的进“⋯”，不算按钮。面板窄时外壳按宽度再少放几个，这里不跟（page-agent.md“不承诺”）。
            actions: [...(declaration.actions ?? []).filter((action) => action.placement !== "menu").map((action) => action.command), ...(contributed.get(id) ?? [])].slice(0, VIEW_ACTIONS_MAX),
        })),
        containers: doc === null ? [] : VIEW_LOCATIONS.flatMap((region) => regionEntries(doc, region, source.views, source.containers).map((entry) => ({
            id: entry.id,
            title: source.text.t(entry.label.title),
            region,
            views: entry.views,
        }))),
        activityItems: source.activityItems.map(({id, declaration}) => ({id, title: source.text.t(declaration.title), command: declaration.command?.id ?? null})),
    };
}
