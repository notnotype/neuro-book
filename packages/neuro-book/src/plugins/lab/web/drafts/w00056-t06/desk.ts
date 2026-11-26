/**
 * 首页工作台（`HomepageDesk.vue`）对外的形状：开场动画要量的卡片、第一幕要记下的布局、指针要瞄的目标。
 * 单独成文件，页面只引类型与几何小函数，不必为了类型去引组件。
 */
import type {LayoutDoc} from "@notnotype/nb-workbench-layout";

import type {TabsSnapshot} from "nbook/plugins/editor/web/groups/groups";

/** 关掉再打开时要带回来的三样：布局文档、编辑器标签的属性、哪一块最大化着。 */
export interface DeskSnapshot {
    readonly doc: LayoutDoc;
    readonly tabs: TabsSnapshot;
    readonly maximized: string | null;
}

/** 一块矩形，普通对象（能写进 Lab 的场景数据）。 */
export interface Box {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** 一张卡片：开场动画拿它的位置与种类摆“页”或“线”。坐标相对工作台的根。 */
export interface DeskPlate {
    readonly id: string;
    /** 活动栏、编辑组、侧栏与右栏的视图、底部状态栏。 */
    readonly kind: "bar" | "editor" | "tool" | "status";
    readonly rect: Box;
    /** 卡片此刻算出来的底色、圆角与投影：开场画的替身照它画，换成真卡片时看不出接缝。 */
    readonly paint: {readonly background: string; readonly radius: string; readonly shadow: string};
}

/** 演示指针要瞄的地方。 */
export type DeskTarget = "chapter-two-tab" | "alice-tab" | "first-editor" | "first-editor-body" | "editor-head-blank" | "explorer-entry" | "auxiliarybar" | "float-landing";

/** 视口坐标的点与矩形：指针、拖影与落点预览都用视口坐标。 */
export interface Point {
    readonly x: number;
    readonly y: number;
}

export function centerOf(rect: DOMRectReadOnly): Point {
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}

/** 矩形换成落点预览要的四边写法。 */
export function dropRect(rect: {readonly left: number; readonly top: number; readonly width: number; readonly height: number}): {left: number; top: number; right: number; bottom: number} {
    return {left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height};
}
