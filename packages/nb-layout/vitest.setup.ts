/**
 * dom 测试的公共准备：nb-layout 读的时长在每个元素上都是 0ms。宿主没给时长时组件按缺省时长过渡（docs/specs/ui/nested-grid.md
 * 输出 142），happy-dom 里没有真实的过渡与动画帧，多数用例要的是“直接到位”。
 *
 * 用一条 `*` 规则而不是在根上设：happy-dom 不做自定义属性的继承（根上、父元素上的声明，子元素读到空串；2026-11-19 实测），
 * 只认命中元素自己的声明。要过渡的用例照旧在读时长的那个元素上行内设，行内声明压过这条规则。
 */

import {beforeEach} from "vitest";

import {NB_LAYOUT_THEME_VARS} from "./src/theme-vars";

const DURATIONS = NB_LAYOUT_THEME_VARS.map((entry) => entry.name).filter((name) => name.startsWith("--nb-layout-motion-"));
const RULE = `* { ${DURATIONS.map((name) => `${name}: 0ms;`).join(" ")} }`;

beforeEach(() => {
    if (document.head.querySelector("style[data-nb-layout-test-durations]") !== null) return;
    const style = document.createElement("style");
    style.dataset.nbLayoutTestDurations = "";
    style.textContent = RULE;
    document.head.append(style);
});
