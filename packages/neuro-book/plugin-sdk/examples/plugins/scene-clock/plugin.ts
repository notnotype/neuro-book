/**
 * 插件描述（读法见 `../clock/plugin.ts`）。和别的示例不同，这份描述里放的是一个**主题**：主题是 `workbench.themes` 的顶层声明，
 * 只有数据、没有实现，宿主把它登记进每个运行实例，设置里的“主题”列表里就有它（docs/specs/theme/skins.md）。
 *
 * 主题没有写 `scene`（静态场景图），而是写 `sceneProvider` 指向本插件在浏览器入口里提供的场景提供者：场景图由代码画。提供者没发布
 * （入口没激活）或画不出来时，主题只有配色，没有场景。要后备图就在 `Look` 里再写一个 `scene`，素材放在插件目录里。
 *
 * 对应的场景：`scenarios/08-scene-provider.test.ts`。
 */

import {WORKBENCH_THEMES_POINT} from "@notnotype/nb-plugin-sdk/workbench";
import type {ThemeDeclaration} from "@notnotype/nb-plugin-sdk/workbench";

import {plugin, SKY_PROVIDER} from "./shared/contracts";

/** 主题 id 以插件 id 加 `.` 开头，否则这一条被拒。 */
export const SKY_THEME = "example.scene-clock.sky";

const sky: ThemeDeclaration = {
    title: {"zh-CN": "天空", "en-US": "Sky"},
    base: "nbook",
    sceneProvider: SKY_PROVIDER,
    // 只写这一个裁切：欢迎页与书架页取图的哪一部分。其它位置（正文两侧、侧栏下角）没写就不画。
    crop: {empty: {position: "center"}},
    light: {colors: {"--accent-main": "#2f6fb5", "--accent-text": "#245a96"}},
    dark: {colors: {"--accent-main": "#79b0e6", "--accent-text": "#79b0e6"}},
};

export const descriptor = plugin.descriptor([{capability: WORKBENCH_THEMES_POINT, id: SKY_THEME, declaration: sky}]);
