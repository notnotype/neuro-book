import {computed, hasInjectionContext, inject, toValue, type ComputedRef, type MaybeRefOrGetter} from "vue";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../theme/z-index";

/**
 * 下拉菜单/选择器高精度立体磨砂 Surface 材质契约 Composable。
 *
 * 规范职责：
 * 1. 唯一真相源材质：以 FormSelect 调优的黄金标准为唯一样式规范，提供
 *    4 层立体微反光环境投影（外发散 + 内边沿微光）与 130% 饱和度滤波；
 * 2. 几何与同心律：严格保证四周 6px 等宽对齐（p-1.5），视口圆角严格绑定 --nb-popover-inner-radius；
 * 3. 规避遮挡与防闪烁：默认 7px side-offset 避让 Trigger 发光圈，提供 closeAutoFocus 阻止二次弹焦；
 * 4. 动态层级：感知 DialogWindow 注入的 NB_POPOVER_Z_INDEX，未挂载于弹窗时平滑回退到系统 popover 层级。
 */

export interface DropdownSurfaceOptions {
    /** 浮层尺寸档位（'sm' 时内边距紧凑化为 p-1） */
    size?: MaybeRefOrGetter<"sm" | "default" | undefined>;
    /** 外部自定义的补充样式（将合并至 Popover 浮层） */
    popoverStyle?: MaybeRefOrGetter<Record<string, string | number> | undefined>;
    /** 浮层距离触发器的偏移（像素，默认 7px，防止遮挡聚焦发光环） */
    sideOffset?: MaybeRefOrGetter<number | undefined>;
    /** 对齐方式（默认 'start'） */
    align?: MaybeRefOrGetter<"start" | "center" | "end" | undefined>;
    /** 弹出方向（默认 'bottom'） */
    side?: MaybeRefOrGetter<"top" | "right" | "bottom" | "left" | undefined>;
    /** 是否自动躲避碰撞边界（默认 true） */
    avoidCollisions?: MaybeRefOrGetter<boolean | undefined>;
    /** 碰撞检测边界安全边距（像素，默认 8px） */
    collisionPadding?: MaybeRefOrGetter<number | undefined>;
}

export interface DropdownSurfaceReturn {
    /** 当前生效的 Popover z-index（已注入窗口上下文感知） */
    popoverZIndex: number;
    /** 4 层高精度立体微反光磨砂与滤波样式对象（直接绑定至 DropdownMenuContent / SelectContent :style） */
    popoverStyle: ComputedRef<Record<string, string | number>>;
    /** 统一外层浮层容器类名（包含 .nb-ui-popover-surface 与 p-1.5 对称留白） */
    popoverClasses: string;
    /** 统一视口容器类名（包含 .nb-ui-popover-scroll） */
    viewportClasses: string;
    /** 视口同心内圆角样式（直接绑定至 Viewport :style） */
    viewportBaseStyle: Record<string, string>;
    /** 菜单列表项基础几何与留白类名（保证贴边同心圆角与 mb-1 last:mb-0） */
    itemBaseClass: string;
    /** 统一 Popper 定位与行为参数（用于 v-bind 或逐项绑定） */
    popperProps: ComputedRef<{
        position: "popper";
        sideOffset: number;
        align: "start" | "center" | "end";
        side: "top" | "right" | "bottom" | "left";
        avoidCollisions: boolean;
        collisionPadding: number;
        bodyLock: false;
        disableOutsidePointerEvents: false;
    }>;
    /** 阻止关闭时向原触发器强制弹焦闪烁的事件处理函数 */
    handleCloseAutoFocus: (event: Event) => void;
}

/** 4 层高精度立体微反光环境阴影（文字色微边 + 3 阶环境柔影） */
export const DROPDOWN_SURFACE_BOX_SHADOW =
    "0 0 0 1px color-mix(in srgb, var(--text-main) 8%, transparent), " +
    "0 6px 16px -2px color-mix(in srgb, var(--shadow-color) 16%, transparent), " +
    "0 20px 48px -4px color-mix(in srgb, var(--shadow-color) 28%, transparent), " +
    "0 36px 80px -8px color-mix(in srgb, var(--shadow-color) 20%, transparent)";

/** 8px 高斯模糊 + 130% 饱和度 + 1.0 亮度高阶微滤波 */
export const DROPDOWN_SURFACE_BACKDROP_FILTER = "blur(8px) saturate(130%) brightness(1.0)";

export function useDropdownSurfaceStyle(options: DropdownSurfaceOptions = {}): DropdownSurfaceReturn {
    const popoverZIndex = hasInjectionContext()
        ? inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover)
        : NB_Z_INDEX.popover;

    const popoverStyle = computed<Record<string, string | number>>(() => ({
        zIndex: popoverZIndex,
        backgroundColor: "var(--overlay-surface)",
        backdropFilter: DROPDOWN_SURFACE_BACKDROP_FILTER,
        WebkitBackdropFilter: DROPDOWN_SURFACE_BACKDROP_FILTER,
        boxShadow: DROPDOWN_SURFACE_BOX_SHADOW,
        ...toValue(options.popoverStyle),
    }));

    const popperProps = computed(() => ({
        position: "popper" as const,
        sideOffset: toValue(options.sideOffset) ?? 7,
        align: toValue(options.align) ?? "start",
        side: toValue(options.side) ?? "bottom",
        avoidCollisions: toValue(options.avoidCollisions) ?? true,
        collisionPadding: toValue(options.collisionPadding) ?? 8,
        bodyLock: false as const,
        disableOutsidePointerEvents: false as const,
    }));

    const handleCloseAutoFocus = (event: Event): void => {
        event.preventDefault();
    };

    const isSm = toValue(options.size) === "sm";
    const popoverClasses = `nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion relative overflow-hidden ${isSm ? "p-1" : "p-1.5"}`;

    return {
        popoverZIndex,
        popoverStyle,
        popoverClasses,
        viewportClasses: "nb-ui-popover-scroll w-full",
        viewportBaseStyle: {
            borderRadius: "var(--nb-popover-inner-radius)",
        },
        itemBaseClass: "nb-ui-popover-item mb-1 last:mb-0",
        popperProps,
        handleCloseAutoFocus,
    };
}
