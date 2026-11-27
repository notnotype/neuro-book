/**
 * 侧轨展开时内侧边的轨宽手柄（docs/specs/ui/workbench-layout.md 输出 50 的“轨宽手柄”）：只改这个容器的轨宽。
 *
 * - 指针：按下记起点的宽与布局版本（`revision`），之后每帧至多交一次预览（`preview`，宿主按它重算预算与呈现，不写文档）；跟手、触界即停（夹进声明的范围）；
 *   松手交一次 `commit`。Esc、失去指针捕获、布局版本在手势中变了，整场取消：预览撤回、零写入。
 * - 键盘：左右方向键每次 10 像素，Home 回缺省；双击也回缺省。每次是一次提交。
 * - 和网格的分隔线手势互斥：网格手势进行中（根上有 `data-workbench-dragging`）时按下不起拖。
 *
 * 右轨的手柄在左边：往左拖是变宽。左轨（目前没有视图段）往右拖是变宽，`side` 给方向。
 */

import {onBeforeUnmount, ref, watch} from "vue";

/** 键盘每按一次改多少（卡片宽，CSS px）。 */
export const RAIL_HANDLE_STEP_PX = 10;

export interface RailHandleOptions {
    /** 此刻生效的卡片宽（没在拖时手柄的数值）。 */
    width(): number;
    bounds(): {readonly minimum: number; readonly maximum: number; readonly width: number};
    /** 手柄在侧轨哪一边：右轨是 `start`（左边），往左拖变宽。 */
    side(): "start" | "end";
    /** 布局版本：手势中变了就整场取消。 */
    revision(): unknown;
    disabled(): boolean;
    preview(width: number | null): void;
    commit(width: number): void;
}

export function useRailHandle(options: RailHandleOptions) {
    /** 拖动中的宽：手柄的 `aria-valuenow` 跟着它；没在拖时是 null。 */
    const dragging = ref<number | null>(null);
    let session: {readonly pointer: number; readonly startX: number; readonly startWidth: number; readonly revision: unknown; readonly element: HTMLElement} | null = null;
    let frame: number | null = null;
    let pending: number | null = null;

    const clamp = (width: number): number => {
        const {minimum, maximum} = options.bounds();
        return Math.round(Math.min(maximum, Math.max(minimum, width)));
    };

    function flush(): void {
        frame = null;
        if (pending !== null && session !== null) options.preview(pending);
    }

    function end(commit: boolean): void {
        const current = session;
        if (current === null) return;
        session = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        const width = dragging.value;
        pending = null;
        dragging.value = null;
        if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer);
        options.preview(null);
        if (commit && width !== null && width !== current.startWidth) options.commit(width);
    }

    function onPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || options.disabled() || session !== null) return;
        if (document.documentElement.hasAttribute("data-workbench-dragging")) return;
        const element = event.currentTarget as HTMLElement;
        event.preventDefault();
        // 焦点给手柄：Esc 挂在手柄上，按下时 `preventDefault` 拦掉了缺省的聚焦，不给的话拖动中按 Esc 没人接。
        element.focus({preventScroll: true});
        element.setPointerCapture(event.pointerId);
        session = {pointer: event.pointerId, startX: event.clientX, startWidth: options.width(), revision: options.revision(), element};
        dragging.value = session.startWidth;
    }

    function onPointerMove(event: PointerEvent): void {
        if (session === null || event.pointerId !== session.pointer) return;
        const delta = event.clientX - session.startX;
        const next = clamp(session.startWidth + (options.side() === "start" ? -delta : delta));
        if (next === dragging.value) return;
        dragging.value = next;
        pending = next;
        frame ??= requestAnimationFrame(flush);
    }

    function onPointerUp(event: PointerEvent): void {
        if (session !== null && event.pointerId === session.pointer) end(true);
    }

    function onLostCapture(event: PointerEvent): void {
        if (session !== null && event.pointerId === session.pointer) end(false);
    }

    function onKeydown(event: KeyboardEvent): void {
        if (options.disabled()) return;
        if (event.key === "Escape" && session !== null) {
            event.preventDefault();
            event.stopPropagation();
            end(false);
            return;
        }
        if (session !== null) return;
        const grow = options.side() === "start" ? "ArrowLeft" : "ArrowRight";
        const shrink = options.side() === "start" ? "ArrowRight" : "ArrowLeft";
        const width = options.width();
        const next = event.key === grow ? width + RAIL_HANDLE_STEP_PX : event.key === shrink ? width - RAIL_HANDLE_STEP_PX : event.key === "Home" ? options.bounds().width : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        const clamped = clamp(next);
        if (clamped !== width) options.commit(clamped);
    }

    function onDoubleClick(): void {
        if (options.disabled() || session !== null) return;
        const {width} = options.bounds();
        if (width !== options.width()) options.commit(width);
    }

    // 布局版本在手势中变了（别处提交了结构操作、窗口里换了容器）：整场取消。
    watch(() => options.revision(), (next) => {
        if (session !== null && next !== session.revision) end(false);
    });
    watch(() => options.disabled(), (disabled) => {
        if (disabled) end(false);
    });
    onBeforeUnmount(() => end(false));

    return {dragging, listeners: {pointerdown: onPointerDown, pointermove: onPointerMove, pointerup: onPointerUp, pointercancel: onLostCapture, lostpointercapture: onLostCapture, keydown: onKeydown, dblclick: onDoubleClick}};
}
