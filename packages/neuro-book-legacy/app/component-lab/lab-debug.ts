/**
 * Lab 的只读调试接口，挂在 `window.__nbLab`，给截图脚本和浏览器控制台用。
 *
 * 脚本只认这里和 `data-lab-stage` 标记，不认 Lab 外壳的按钮文字或 class：外壳改版时脚本不必跟着改。
 * 接口只读，改状态一律走 URL 参数（见 lab-url.ts），保证同一个 URL 永远是同一个起点。
 */
import {describeNode} from "./inspect";

export type LabDebugState = {
    component: string;
    scene: string;
    /** fixture 已加载并挂上舞台；截图前等它为 true。 */
    ready: boolean;
    /** fixture 加载失败的原因；没有失败时为空串。 */
    loadError: string;
    canvas: {width: number; height: number};
    themeId: string;
    colorwayId: string;
};

export type LabOverflowOffender = {
    /** 元素检查器同款选择器路径。 */
    selector: string;
    componentName: string;
    /** 越出舞台左右边缘的像素，取较大的一侧。 */
    overflow: number;
};

export type LabStageMeasure = {
    /** 舞台在视口中的位置与大小，截图按它裁剪。 */
    box: {x: number; y: number; width: number; height: number};
    /** 舞台内容比舞台宽出的像素；0 表示没有横向溢出。 */
    overflowX: number;
    /** 越出舞台左右边缘、且没有被某个滚动或裁剪容器挡住的元素，最多 20 个。 */
    offenders: LabOverflowOffender[];
};

export type LabDebugApi = {
    version: 1;
    state: () => LabDebugState;
    /** 某个组件（缺省为当前组件）登记的场景。 */
    scenes: (component?: string) => Array<{id: string; label: string}>;
    /** 没有舞台（组件不可挂载或还在加载）时为 null。 */
    measure: () => LabStageMeasure | null;
};

declare global {
    interface Window {
        __nbLab?: LabDebugApi;
    }
}

const TOLERANCE = 1;
const MAX_OFFENDERS = 20;

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
        if (overflow > TOLERANCE && !clipped(element, stage)) {
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
