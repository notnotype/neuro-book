/**
 * 说明框、描边框与压暗层的样式（docs/specs/agent/page-agent.md 输出 10；外观按 w00033 t03 评审板第 1 轮的静态稿）。都在
 * shadow root 里，页面的样式进不来、这里的也出不去；颜色、字号与圆角取 `:host` 上的 `--pa-*`（`theme.ts`）。
 *
 * 位置由脚本写 `left`、`top`、`width`、`height`；出现时的动画用独立的 `scale`、`translate` 属性，不与位置抢 `transform`。
 */

import {OUTLINE_GLOW, OUTLINE_RING} from "./geometry";

export const GUIDE_STYLES = `
:host {
    color-scheme: inherit;
}

[data-nb-page-agent="outline"],
[data-nb-page-agent="dim"],
[data-nb-page-agent="callout"] {
    position: fixed;
    left: 0;
    top: 0;
    box-sizing: border-box;
}

[data-nb-page-agent="outline"] {
    pointer-events: none;
    box-shadow:
        0 0 0 ${String(OUTLINE_RING)}px var(--pa-accent),
        0 0 0 ${String(OUTLINE_RING + OUTLINE_GLOW)}px color-mix(in srgb, var(--pa-accent) 18%, transparent);
    transition: opacity 150ms ease;
    animation: pa-settle 220ms ease-out;
}

[data-nb-page-agent="outline"][data-inside] {
    box-shadow: inset 0 0 0 ${String(OUTLINE_RING)}px var(--pa-accent);
}

[data-nb-page-agent="dim"] {
    pointer-events: none;
    box-shadow: 0 0 0 200vmax var(--pa-dim);
    transition: opacity 180ms ease;
    animation: pa-fade 180ms ease-out;
}

[data-nb-page-agent="outline"][data-hidden],
[data-nb-page-agent="dim"][data-hidden] {
    opacity: 0;
}

[data-nb-page-agent="callout"] {
    display: flex;
    width: 300px;
    max-width: calc(100vw - 16px);
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--pa-outline);
    border-radius: var(--pa-radius);
    background: var(--pa-surface);
    box-shadow: var(--pa-shadow);
    -webkit-backdrop-filter: var(--pa-blur);
    backdrop-filter: var(--pa-blur);
    color: var(--pa-text);
    font-family: var(--pa-font);
    font-size: var(--pa-font-size);
    line-height: 1.5;
    pointer-events: auto;
    transition: opacity 120ms ease;
    animation: pa-rise 180ms ease-out;
}

:host([data-closing]) [data-nb-page-agent="outline"],
:host([data-closing]) [data-nb-page-agent="dim"],
:host([data-closing]) [data-nb-page-agent="callout"] {
    opacity: 0;
    pointer-events: none;
}

.head {
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.title {
    min-width: 0;
    flex: 1;
    font-weight: 600;
    overflow-wrap: anywhere;
}

.progress {
    flex: none;
    margin-left: auto;
    color: var(--pa-text-muted);
    font-size: var(--pa-font-size-tiny);
}

.message {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

/* 按钮行与提问行叠在同一格里：换来换去时说明框的高度不变，别的内容不动。 */
.rows {
    display: grid;
}

.row {
    display: flex;
    min-width: 0;
    min-height: var(--pa-control-height);
    grid-area: 1 / 1;
    align-items: center;
    gap: 4px;
    transition: opacity 150ms ease, visibility 0s linear 150ms;
}

.row[data-active] {
    transition: opacity 150ms ease, visibility 0s;
}

.row:not([data-active]) {
    opacity: 0;
    visibility: hidden;
}

.fill {
    flex: 1;
}

button {
    all: unset;
    display: inline-flex;
    box-sizing: border-box;
    height: var(--pa-control-height);
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 10px;
    border-radius: var(--pa-control-radius);
    font-family: inherit;
    font-size: var(--pa-font-size-small);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
}

button:focus-visible,
input:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--pa-accent) 60%, transparent);
    outline-offset: 1px;
}

.ghost,
.icon {
    color: var(--pa-text-secondary);
}

.ghost:hover,
.icon:hover {
    background: color-mix(in srgb, var(--pa-text) 10%, transparent);
    color: var(--pa-text);
}

.secondary {
    background: color-mix(in srgb, var(--pa-text) 8%, transparent);
    color: var(--pa-text);
}

.secondary:hover {
    background: color-mix(in srgb, var(--pa-text) 18%, transparent);
}

.primary {
    background: var(--pa-accent);
    color: var(--pa-on-accent);
}

.primary:hover {
    background: color-mix(in srgb, var(--pa-accent) 86%, var(--pa-text));
}

.icon {
    width: var(--pa-control-height);
    padding: 0;
}

svg {
    width: 1.15em;
    height: 1.15em;
    flex: none;
}

input {
    all: unset;
    box-sizing: border-box;
    height: var(--pa-control-height);
    min-width: 0;
    flex: 1;
    padding: 0 8px;
    border-radius: var(--pa-control-radius);
    background: color-mix(in srgb, var(--pa-text) 6%, transparent);
    color: var(--pa-text);
    font-family: inherit;
    font-size: var(--pa-font-size-small);
    cursor: text;
}

input::placeholder {
    color: var(--pa-text-muted);
}

@keyframes pa-settle {
    from {
        opacity: 0;
        scale: 1.06;
    }
}

@keyframes pa-fade {
    from {
        opacity: 0;
    }
}

@keyframes pa-rise {
    from {
        opacity: 0;
        translate: 0 4px;
    }
}

/* 减弱动效只收掉位移与缩放，淡入淡出照旧（输出 10；nb-ui 设计语言“六、无障碍”）：出现时换成只改透明度的关键帧。
   别的过渡本来只改透明度与颜色，不用动。 */
@media (prefers-reduced-motion: reduce) {
    [data-nb-page-agent="outline"],
    [data-nb-page-agent="callout"] {
        animation-name: pa-fade;
    }
}
`;
