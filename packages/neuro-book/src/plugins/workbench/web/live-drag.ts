/**
 * 实时布局的预览（docs/specs/ui/workbench-layout.md“实时布局”）：判定照旧由 `layout-drag` 做，这里把候选变成预览。候选稳定不稳定要逐帧看：指针不动时手势不发布，所以这一场有自己的帧循环。
 *
 * 预览只是一份给渲染用的文档（store 的 `setLivePreview`），不写记录，不改可见性。撤预览由 `end` 做：手势的收场顺序里它先于提交，同一个同步段不渲染，不闪。
 */

import {initialLiveDrop, insideShownSlot, stepLiveDrop} from "@notnotype/nb-layout";
import type {GridDropPoint, LayoutDoc, LiveDropCandidate, LiveDropState} from "@notnotype/nb-layout";
import {readonly, shallowRef} from "vue";
import type {Ref} from "vue";

import type {LayoutDragDrop, LayoutTabSource} from "./layout-drag";

export interface LiveDragHost {
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
    /** 按这个落点摆的文档；null 是摆不出来（放回原处、不预览的落点），就用已提交的。 */
    candidateDoc(source: LayoutTabSource, drop: LayoutDragDrop): LayoutDoc | null;
    /** 摘掉来源后的文档。 */
    sourceRemovedDoc(source: LayoutTabSource): LayoutDoc | null;
    /** 来源在已提交文档里所在的面板。 */
    homeOf(source: LayoutTabSource): string | null;
    show(doc: LayoutDoc | null): void;
}

export interface LiveDrag {
    /** 这一场是实时布局。 */
    readonly active: Readonly<Ref<boolean>>;
    /** 此刻预览的是什么：`none`、`source-removed` 或候选的键。e2e 等它，不按时长等。 */
    readonly previewKey: Readonly<Ref<string>>;
    begin(source: LayoutTabSource): void;
    /** 这一刻判定的落点。 */
    offer(drop: LayoutDragDrop | null): void;
    /** 指针在已显示的空位里：候选不变，是这个落点。 */
    stickyDrop(point: GridDropPoint): LayoutDragDrop | null;
    end(): void;
}

const keyOf = (drop: LayoutDragDrop): string => (drop.inPlace ? "in-place" : JSON.stringify([drop.action, drop.part ?? null]));

export function createLiveDrag(host: LiveDragHost): LiveDrag {
    const active = shallowRef(false);
    const previewKey = shallowRef("none");
    let source: LayoutTabSource | null = null;
    let state: LiveDropState = initialLiveDrop(0);
    let started = false;
    let offered: LayoutDragDrop | null = null;
    let shown: LayoutDragDrop | null = null;
    let frame: number | null = null;

    function candidateOf(drop: LayoutDragDrop, from: LayoutTabSource): LiveDropCandidate {
        const {action} = drop;
        // 标签条内要跟手：已经在这条标签条里，或者就是来源自己那条。
        const inStrip = action.kind === "strip" && (host.homeOf(from) === action.panel || (shown?.action.kind === "strip" && shown.action.panel === action.panel));
        // 只有长出新面板的落点有空位：并进已有面板时空位就是它的整块正文，粘住了它自己的外缘就选不到了。
        const grows = !drop.inPlace && (action.kind === "edge" || action.kind === "reveal");
        return {key: keyOf(drop), immediate: inStrip, slot: grows ? drop.preview.areaRect : null};
    }

    function tick(now: number): void {
        frame = host.requestFrame(tick);
        if (source === null) return;
        if (!started) {
            started = true;
            state = initialLiveDrop(now);
        }
        const before = state.preview;
        state = stepLiveDrop(state, {now, candidate: offered === null ? null : candidateOf(offered, source)});
        if (state.preview === before) return;
        const {preview} = state;
        if (preview.kind === "candidate") {
            shown = offered;
            previewKey.value = preview.key;
            host.show(offered === null ? null : host.candidateDoc(source, offered));
        } else if (preview.kind === "source-removed") {
            shown = null;
            previewKey.value = "source-removed";
            host.show(host.sourceRemovedDoc(source));
        }
    }

    return {
        active: readonly(active),
        previewKey: readonly(previewKey),
        begin: (from) => {
            source = from;
            state = initialLiveDrop(0);
            started = false;
            offered = null;
            shown = null;
            previewKey.value = "none";
            active.value = true;
            frame = host.requestFrame(tick);
        },
        offer: (drop) => {
            offered = drop;
        },
        stickyDrop: (point) => (active.value && insideShownSlot(state, point) ? shown : null),
        end: () => {
            if (!active.value) return;
            if (frame !== null) host.cancelFrame(frame);
            frame = null;
            source = null;
            offered = null;
            shown = null;
            active.value = false;
            previewKey.value = "none";
            host.show(null);
        },
    };
}
