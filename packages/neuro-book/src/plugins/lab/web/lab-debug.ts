/**
 * Lab 的只读调试接口，挂在 `window.__nbLab`，给截图脚本和浏览器控制台用。
 *
 * 脚本只认这里和 `data-lab-stage` 标记，不认 Lab 外壳的按钮文字或 class：外壳改版时脚本不必跟着改。
 * 接口只读，改状态一律走 URL 参数（见 lab-url.ts），保证同一个 URL 永远是同一个起点。
 */
import type {LabDebugApi, LabOverflowOffender, LabStageMeasure} from "../shared/debug-api";

import {describeNode} from "./inspect";

declare global {
    interface Window {
        __nbLab?: LabDebugApi;
    }
}

const TOLERANCE = 1;
const MAX_OFFENDERS = 20;

/**
 * 看不见的元素不算越界：读屏用的播报区（`opacity: 0`）、视觉隐藏的原生输入（`clip: rect(0 0 0 0)` 或
 * `clip-path: inset(50%)`）与 `visibility: hidden`。它们常被组件库放在盒子外面，算进来就是误报。
 */
function invisible(element: HTMLElement): boolean {
    const style = getComputedStyle(element);
    return style.opacity === "0" || style.visibility === "hidden" || style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
}

/** 元素和舞台之间有没有横向不外溢的容器把它挡住：挡住的越界看不见，也不会撑出滚动条。 */
function clipped(element: HTMLElement, stage: HTMLElement): boolean {
    for (let node = element.parentElement; node !== null && node !== stage; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX !== "visible") {
            return true;
        }
    }
    return false;
}

export function measureStage(stage: HTMLElement): LabStageMeasure {
    const rect = stage.getBoundingClientRect();
    const offenders: LabOverflowOffender[] = [];
    for (const element of stage.querySelectorAll<HTMLElement>("*")) {
        if (offenders.length >= MAX_OFFENDERS) {
            break;
        }
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
            continue;
        }
        const overflow = Math.max(box.right - rect.right, rect.left - box.left);
        if (overflow > TOLERANCE && !invisible(element) && !clipped(element, stage)) {
            const node = describeNode(element);
            offenders.push({selector: node.selector, componentName: node.componentName, overflow: Math.round(overflow)});
        }
    }
    return {
        box: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
        overflowX: Math.max(0, stage.scrollWidth - stage.clientWidth),
        offenders,
    };
}

export function installLabDebugApi(source: Omit<LabDebugApi, "version" | "measure">): () => void {
    window.__nbLab = {
        version: 1,
        ...source,
        measure: () => {
            const stage = document.querySelector<HTMLElement>("[data-lab-stage]");
            return stage === null ? null : measureStage(stage);
        },
    };
    return () => {
        delete window.__nbLab;
    };
}
