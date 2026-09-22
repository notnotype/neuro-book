import {computed, type ComputedRef} from "vue";
import {useFloatingScrollbar, type FloatingScrollbarOptions} from "./useFloatingScrollbar";
import {
    useDropdownTruncatedHeight,
    type DropdownTruncatedHeightOptions,
    type DropdownTruncatedHeightReturn,
} from "./useDropdownTruncatedHeight";
import {
    useDropdownSurfaceStyle,
    type DropdownSurfaceOptions,
    type DropdownSurfaceReturn,
} from "./useDropdownSurfaceStyle";

/**
 * Dropdown 浮层一站式装配 Composable。
 *
 * 整合三大基础能力：
 * 1. Surface 材质（useDropdownSurfaceStyle · FormSelect 4 层微反光立体投影 + 130% 滤波）；
 * 2. 齐腰截半露底高度计算（useDropdownTruncatedHeight · 53%~64% 黄金截断线索）；
 * 3. macOS 4px 悬浮胶囊滚动条与自适应渐隐（useFloatingScrollbar · 挂载即时感知）。
 */
export interface DropdownFloatingOptions
    extends DropdownSurfaceOptions,
        DropdownTruncatedHeightOptions,
        FloatingScrollbarOptions {}

export interface DropdownFloatingReturn {
    /** 浮层容器样式（已包含 zIndex、4 阶环境阴影与滤波） */
    popoverStyle: ComputedRef<Record<string, string | number>>;
    /** 浮层容器类名（包含 .nb-ui-popover-surface、.nb-ui-menu-surface 与 p-1.5 对称留白） */
    popoverClasses: string;
    /** 浮层 Popper 基础属性对象 */
    popperProps: DropdownSurfaceReturn["popperProps"];
    /** 阻止关闭弹焦闪烁的事件处理函数 */
    handleCloseAutoFocus: (event: Event) => void;
    /** 窗口/页面 z-index */
    popoverZIndex: number;

    /** 滚动视口绑定 ref 函数（用于挂载即时感知尺寸与滚动） */
    setViewportRef: (el: unknown) => void;
    /** 视口完整计算样式（包含同心内圆角与计算后的黄金截断高度） */
    viewportStyle: ComputedRef<Record<string, string>>;
    /** 视口动态类名数组（包含 .nb-ui-popover-scroll、自适应双向渐隐类与滚动条右侧避让 padding） */
    viewportClasses: ComputedRef<string[]>;
    /** 视口滚动事件处理函数 */
    handleViewportScroll: (e: Event) => void;
    /** 视口最大截断高度计算值（如 "238px" / "168px"） */
    viewportMaxHeight: ComputedRef<string>;

    /** 是否出现滚动溢出（内容高度 > 视口高度） */
    isScrollable: ComputedRef<boolean>;
    /** 滑块是否处于拖拽状态 */
    isDragging: ComputedRef<boolean>;
    /** macOS 悬浮滑块顶部偏移（像素） */
    scrollThumbTop: ComputedRef<number>;
    /** macOS 悬浮滑块高度（像素） */
    scrollThumbHeight: ComputedRef<number>;
    /** macOS 悬浮滑块鼠标按住事件处理函数 */
    handleThumbMouseDown: (e: MouseEvent) => void;

    /** 项级同心圆角与垂直留白类名 */
    itemBaseClass: string;

    /** 原始子 Composable 句柄（供需要精细定制时取用） */
    surface: DropdownSurfaceReturn;
    height: DropdownTruncatedHeightReturn;
    scrollbar: ReturnType<typeof useFloatingScrollbar>;
}

export function useDropdownFloating(options: DropdownFloatingOptions = {}): DropdownFloatingReturn {
    const surface = useDropdownSurfaceStyle(options);
    const height = useDropdownTruncatedHeight(options);
    const scrollbar = useFloatingScrollbar(options);

    const viewportStyle = computed<Record<string, string>>(() => ({
        ...surface.viewportBaseStyle,
        maxHeight: height.viewportMaxHeight.value,
    }));

    const viewportClasses = computed<string[]>(() => [
        surface.viewportClasses,
        scrollbar.scrollFadeClass.value,
        scrollbar.isScrollable.value ? "pr-1.5" : "",
    ].filter(Boolean));

    return {
        popoverStyle: surface.popoverStyle,
        popoverClasses: surface.popoverClasses,
        popperProps: surface.popperProps,
        handleCloseAutoFocus: surface.handleCloseAutoFocus,
        popoverZIndex: surface.popoverZIndex,

        setViewportRef: scrollbar.setViewportRef,
        viewportStyle,
        viewportClasses,
        handleViewportScroll: scrollbar.handleViewportScroll,
        viewportMaxHeight: height.viewportMaxHeight,

        isScrollable: computed(() => scrollbar.isScrollable.value),
        isDragging: computed(() => scrollbar.isDragging.value),
        scrollThumbTop: computed(() => scrollbar.scrollThumbTop.value),
        scrollThumbHeight: computed(() => scrollbar.scrollThumbHeight.value),
        handleThumbMouseDown: scrollbar.handleThumbMouseDown,

        itemBaseClass: surface.itemBaseClass,

        surface,
        height,
        scrollbar,
    };
}
