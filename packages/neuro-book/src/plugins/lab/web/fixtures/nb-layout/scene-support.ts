/**
 * Lab 网格场景（`GridStructureScene`、`GridPanelsScene`）共用的两个小工具：叶内容的实例计数与 F6 切换焦点。
 * 产品里 F6 是工作台的两条命令；场景不接命令系统，直接调。
 */
import {moveGridFocus} from "@notnotype/nb-layout/vue";

/**
 * 叶内容的实例编号（`GridStructureLeaf` 显示它，e2e 据此判断内容有没有被重建）。每个场景实例在自己的 setup 里建一个，
 * 重新挂载场景时从 1 重新数：不要放到模块顶层。
 */
export function createInstanceCounter(): () => number {
    let count = 0;
    return () => {
        count += 1;
        return count;
    };
}

/** F6、Shift+F6 在 `container` 里的网格之间移动焦点；移动了才吃掉按键。 */
export function moveFocusOnF6(event: KeyboardEvent, container: HTMLElement | null): void {
    if (event.key === "F6" && moveGridFocus(container, event.shiftKey ? "previous" : "next")) event.preventDefault();
}
