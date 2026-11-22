/**
 * 名字上的右键菜单（docs/specs/story/viewer.md 输出 67）：书的外壳里只有一个，`NameLink` 经注入打开，不每个名字挂一个菜单。
 * 菜单里只有“在旁边打开”：窄档看不出并排，外壳不打开它，`open` 返回 false，名字照常走浏览器自己的右键菜单。
 */

import type {InjectionKey} from "vue";

import type {DetailRequest} from "./details";

export interface NameMenu {
    /** 在指针处打开菜单；打开了返回 true（调用方这时才拦掉浏览器的菜单）。 */
    open(at: {readonly x: number; readonly y: number}, request: DetailRequest): boolean;
}

export const NAME_MENU: InjectionKey<NameMenu> = Symbol("nb-story name menu");
