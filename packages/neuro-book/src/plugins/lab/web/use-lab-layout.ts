/**
 * Lab 两侧栏的布局（docs/specs/ui/component-lab.md 的输出“窄屏收起侧栏”）：开合、宽度、拖边与方向键、窄屏自动收起。
 *
 * 开合分两份：`leftCollapsed`、`rightCollapsed` 是此刻的布局，`preferred*` 是使用者在桌面宽度下的选择。窄屏自动收起
 * 只改前者，恢复宽屏不自动展开，也不覆盖偏好。
 */

import {onBeforeUnmount, onMounted, ref} from "vue";

import {LAB_PANEL_WIDTH_LIMITS} from "./lab-preferences-store";
import type {LabPanelSide} from "./lab-preferences-store";

/**
 * 侧栏默认宽度：左栏要放得下多级目录路径（最深五级），右栏要读得下文档正文。
 * 拖动后的值随偏好一起存，恢复默认配置时回到这里。
 */
export const LAB_PANEL_DEFAULT_WIDTH = {left: 300, right: 380} as const;
/** 拖到再窄也得给画布留出可用宽度，否则两侧栏会把中间的组件挤没。 */
const LAB_CANVAS_MIN_WIDTH = 560;
/** 与 CollapsibleSidePanel 的 collapsedWidth 缺省一致：收起后它只占一条导轨。 */
const LAB_PANEL_RAIL_WIDTH = 40;
const LAB_MOBILE_BREAKPOINT = 700;

export function useLabLayout(options: {
    /** 拖边松手：这一栏的宽度定下来了，由调用方写进偏好。 */
    readonly onDragEnd: (side: LabPanelSide) => void;
}) {
    const leftCollapsed = ref(false);
    const rightCollapsed = ref(false);
    const preferredLeftCollapsed = ref(false);
    const preferredRightCollapsed = ref(false);
    const leftWidth = ref<number>(LAB_PANEL_DEFAULT_WIDTH.left);
    const rightWidth = ref<number>(LAB_PANEL_DEFAULT_WIDTH.right);
    /** 正在拖动侧栏边：宽度只改显示，松手才写进偏好。 */
    const dragging = ref(false);

    // matchMedia 只在浏览器里有，挂载之后再接。
    let mobileQuery: MediaQueryList | null = null;

    function collapseForMobile(event: MediaQueryList | MediaQueryListEvent): void {
        if (event.matches) {
            leftCollapsed.value = true;
            rightCollapsed.value = true;
        }
    }

    onMounted(() => {
        mobileQuery = window.matchMedia(`(max-width: ${LAB_MOBILE_BREAKPOINT}px)`);
        collapseForMobile(mobileQuery);
        mobileQuery.addEventListener("change", collapseForMobile);
    });
    onBeforeUnmount(() => {
        mobileQuery?.removeEventListener("change", collapseForMobile);
        mobileQuery = null;
    });

    /** 夹到「这一栏自己的上下限」与「画布还站得住」两者的交集里。 */
    function clampPanelWidth(side: LabPanelSide, value: number): number {
        const limits = LAB_PANEL_WIDTH_LIMITS[side];
        const otherWidth = side === "left"
            ? (rightCollapsed.value ? LAB_PANEL_RAIL_WIDTH : rightWidth.value)
            : (leftCollapsed.value ? LAB_PANEL_RAIL_WIDTH : leftWidth.value);
        const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
        const max = Math.min(limits.max, Math.max(limits.min, viewport - otherWidth - LAB_CANVAS_MIN_WIDTH));
        return Math.round(Math.min(Math.max(value, limits.min), max));
    }

    function setPanelWidth(side: LabPanelSide, value: number): void {
        if (side === "left") {
            leftWidth.value = clampPanelWidth("left", value);
        } else {
            rightWidth.value = clampPanelWidth("right", value);
        }
    }

    let panelDragCleanup: (() => void) | null = null;

    /**
     * 拖这条边改这一栏的宽度。指针事件挂在 window 上而不是手柄自己：
     * 快速拖动时指针会跑出手柄，靠 pointercapture 之外还要能收到 move 才跟得住。
     */
    function startPanelDrag(side: LabPanelSide, event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        panelDragCleanup?.();
        const startX = event.clientX;
        const startWidth = side === "left" ? leftWidth.value : rightWidth.value;
        // 左栏的边向右拖是变宽，右栏的边向右拖是变窄
        const direction = side === "left" ? 1 : -1;
        const handle = event.currentTarget as HTMLElement;
        handle.dataset.dragging = "true";
        dragging.value = true;

        const onMove = (moveEvent: PointerEvent): void => {
            setPanelWidth(side, startWidth + (moveEvent.clientX - startX) * direction);
        };
        const onUp = (): void => {
            delete handle.dataset.dragging;
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            panelDragCleanup = null;
            dragging.value = false;
            options.onDragEnd(side);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        panelDragCleanup = onUp;
    }

    /** 方向键把这条边往按键方向推（Shift 步进 1px），与 DialogWindow 的缩放手柄同一套语义。 */
    function handlePanelKey(side: LabPanelSide, event: KeyboardEvent): void {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        event.preventDefault();
        const step = (event.shiftKey ? 1 : 10) * (event.key === "ArrowRight" ? 1 : -1);
        const current = side === "left" ? leftWidth.value : rightWidth.value;
        setPanelWidth(side, current + step * (side === "left" ? 1 : -1));
    }

    onBeforeUnmount(() => {
        panelDragCleanup?.();
    });

    return {
        leftCollapsed,
        rightCollapsed,
        preferredLeftCollapsed,
        preferredRightCollapsed,
        leftWidth,
        rightWidth,
        dragging,
        startPanelDrag,
        handlePanelKey,
        /** 使用者开合侧栏：布局与偏好一起改。 */
        setLeftCollapsed: (value: boolean): void => {
            leftCollapsed.value = value;
            preferredLeftCollapsed.value = value;
        },
        setRightCollapsed: (value: boolean): void => {
            rightCollapsed.value = value;
            preferredRightCollapsed.value = value;
        },
        /** 按当前窗口宽度重新收起侧栏（恢复默认之后）。 */
        applyResponsiveLayout: (): void => {
            collapseForMobile(mobileQuery ?? window.matchMedia(`(max-width: ${LAB_MOBILE_BREAKPOINT}px)`));
        },
    };
}
