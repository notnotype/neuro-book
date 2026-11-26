/**
 * 视图的位置限制（docs/specs/workbench/views.md 输出 22）：一个关卡判一整份文档，store 的提交出口、拖放的落点与预览、“移动到”的目标表都问它，
 * 不在各个操作的入口上各判一遍：入口上的判断会漏掉经别的操作（相邻入口并入、整容器搬移、整窗停靠）绕过去的路径。
 *
 * 受限的视图（声明写了 `confinedTo`）只有两种合法的样子：在限定区域里、自己的隐式容器的一节（那一节只有它）；或浮动窗里唯一的标签。
 * 它的隐式容器里也不能有别的视图。不在文档里不算违反：补位（`reconcileViews`）会把它放回去。
 *
 * 判定只读声明目录：目录里还没有这个视图时不知道它受限，什么都不判、不改（声明目录没就绪时不按未知的限制写回）。
 */

import {findTab, isFloating, moveTabToEdge, regionOf} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutPolicy, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";

import {CUSTOM_CONTAINER_PREFIX} from "../../shared/views";
import type {ViewCatalog} from "../views/registry";
import {implicitContainerOf, sectionLanding} from "./containers";
import {viewKey} from "./layout-present";

/** 搬动视图 `viewId` 进 `region` 时用的策略：`newId` 要按此刻的文档给确定的 id（见 `settlePlacements`）。 */
export type PlacementPolicy = (doc: LayoutDoc, viewId: string, region: PanelName) => LayoutPolicy;

/** 目录里受限的视图与它限定的区域。 */
function confinedViews(catalog: ViewCatalog): ReadonlyArray<readonly [string, "auxiliarybar"]> {
    return [...catalog].flatMap(([viewId, declaration]) => (declaration.confinedTo === undefined ? [] : [[viewId, declaration.confinedTo] as const]));
}

/** 目录里有没有受限的视图：没有时调用方可以省掉逐个模拟落点。 */
export const hasConfinedViews = (catalog: ViewCatalog): boolean => confinedViews(catalog).length > 0;

/** 受限视图自己的标签在不在合法的位置；不在文档里算合法。 */
function placedRightly(doc: LayoutDoc, viewId: string, region: "auxiliarybar"): boolean {
    const found = findTab(doc, viewKey(viewId));
    if (found === null) return true;
    const panel = doc.panels[found.panel];
    if (panel === undefined) return true;
    if (isFloating(doc, found.panel)) return panel.tabs.length === 1;
    return panel.container === implicitContainerOf(viewId) && panel.tabs.length === 1 && regionOf(doc, found.panel) === region;
}

/** 受限视图的隐式容器里别的视图（读入时要分出去的那些）。 */
function strangersIn(doc: LayoutDoc, viewId: string): ReadonlyArray<string> {
    const own = implicitContainerOf(viewId);
    return Object.values(doc.panels).flatMap((panel) => (panel.container !== own ? [] : panel.tabs.flatMap((tab) => (tab.kind === "view" && tab.viewId !== viewId ? [tab.viewId] : []))));
}

/**
 * 一个受限视图此刻违反的样子：它在哪（面板、所在区域、窗里有几个标签），它的隐式容器里混进了哪些视图。合法时是 null。
 * 关卡比的是这个，不只比视图 id：视图已经违反着（读入归整没能修好）时，再把别的视图移进它的容器是新的违反，要拒。
 */
function violationOf(doc: LayoutDoc, viewId: string, region: "auxiliarybar"): string | null {
    const strangers = strangersIn(doc, viewId);
    if (placedRightly(doc, viewId, region) && strangers.length === 0) return null;
    const found = findTab(doc, viewKey(viewId));
    const panel = found === null ? undefined : doc.panels[found.panel];
    const at = found === null || panel === undefined ? null : [found.panel, isFloating(doc, found.panel) ? "float" : regionOf(doc, found.panel), panel.container ?? null, panel.tabs.length];
    return JSON.stringify([viewId, at, [...strangers].sort()]);
}

/** 这份文档里违反位置限制的受限视图，按目录的顺序；空表是合法。 */
export function placementViolations(doc: LayoutDoc, catalog: ViewCatalog): ReadonlyArray<string> {
    return confinedViews(catalog).flatMap(([viewId, region]) => (violationOf(doc, viewId, region) === null ? [] : [viewId]));
}

/**
 * 提交出口与落点共用的一句：结果里有操作前没有的违反（`violationOf` 的样子不同也算），就换成拒绝（原文档不变）；别的结果原样返回。
 * 不拒原样留着的违反：读入归整（`settlePlacements`）被库拒绝而留下的违反不该让之后的每次写入都被拒，布局就整个动不了了。
 */
export function guardPlacement(base: LayoutDoc, result: LayoutResult, catalog: ViewCatalog): LayoutResult {
    if (!result.ok || result.doc === base) return result;
    const confined = confinedViews(catalog);
    if (confined.length === 0) return result;
    const before = new Set(confined.map(([viewId, region]) => violationOf(base, viewId, region)));
    const added = confined.flatMap(([viewId, region]) => {
        const now = violationOf(result.doc, viewId, region);
        return now === null || before.has(now) ? [] : [viewId];
    });
    return added.length === 0 ? result : {ok: false, code: "rejected", message: `Breaks the placement restriction of ${added.join(", ")}`};
}

/**
 * 读入归整（输出 22 的“读入时”）：旧记录里违反的，只把受限视图分离出来，其余原样。
 *
 * - 隐式容器里别的视图：按树序搬进同一区域里一个新的用户容器，它们彼此还在一起；容器 id 由受限视图定，每次读入算出同一个，`reconcileViews` 是 computed 里调的，不能每次生成新 id。
 * - 受限视图自己不在合法位置：搬成限定区域里自己隐式容器的最后一节（浮动窗里和别的标签在一起时也是搬回区域，不另开窗）。
 *
 * 哪一步被库拒绝就跳过那一步，文档照用；留下的违反不挡之后的写入（`guardPlacement` 只拒新的违反）。
 *
 * 搬动要新建面板与分支时，id 由 `policyFor` 给：这里在 computed 里跑（`reconcileViews`），每次重算必须得到同一份文档，id 不能随机，
 * 否则面板每次重算都换 id，DOM 重挂、当前面板失效。
 */
export function settlePlacements(doc: LayoutDoc, catalog: ViewCatalog, policyFor: PlacementPolicy): LayoutDoc {
    let next = doc;
    for (const [viewId, region] of confinedViews(catalog)) {
        const strangers = strangersIn(next, viewId);
        if (strangers.length > 0) {
            const split = `${CUSTOM_CONTAINER_PREFIX}split-${viewId}`;
            // 一个一个搬，下一个的落点按搬完上一个的文档求；搬到它们此刻所在的区域。
            for (const stranger of strangers) {
                const key = viewKey(stranger);
                const panel = findTab(next, key)?.panel;
                const home = panel === undefined ? null : regionOf(next, panel);
                const target = home === null ? null : sectionLanding(next, home, split);
                if (home === null || target === null) continue;
                const moved = moveTabToEdge(next, {tab: key, target, container: split}, policyFor(next, stranger, home));
                if (moved.ok) next = moved.doc;
            }
        }
        if (placedRightly(next, viewId, region)) continue;
        const target = sectionLanding(next, region, implicitContainerOf(viewId));
        if (target === null) continue;
        const moved = moveTabToEdge(next, {tab: viewKey(viewId), target, container: implicitContainerOf(viewId)}, policyFor(next, viewId, region));
        if (moved.ok) next = moved.doc;
    }
    return next;
}
