/**
 * 截图（docs/specs/agent/page-agent.md 输出 8）：用 snapdom 按 DOM 重画视口或一个元素，缩到长边至多 `maxEdge`，编成 JPEG，
 * 超过 `maxBytes` 时先降质量、再缩小。这是近似图，不是屏幕像素；引擎自己的节点（描边框、说明框）不画。
 *
 * 编成 JPEG 而不是 WebP：模型的适配器对不收 WebP 的端点会转成 PNG，转出来常常超过大小上限。
 */

import {snapdom} from "@zumer/snapdom";

import {OWN_NODE_ATTRIBUTE} from "./api";

export interface CaptureOptions {
    readonly maxEdge: number;
    readonly maxBytes: number;
}

export interface Captured {
    readonly blob: Blob;
    readonly width: number;
    readonly height: number;
}

/** 依次试的 JPEG 质量；都超了就把尺寸缩到这个比例再试一轮。 */
const QUALITIES = [0.85, 0.72, 0.6, 0.45];
const SHRINK = 0.7;
const MIN_EDGE = 160;

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob === null ? reject(new Error("canvas 没能编成 JPEG")) : resolve(blob)), "image/jpeg", quality);
    });
}

/** 截 `target`；null 是整个视口。 */
export async function capturePage(document: Document, target: Element | null, options: CaptureOptions): Promise<Captured> {
    const view = document.defaultView;
    if (view === null) throw new Error("文档不在窗口里");
    const element = target ?? document.documentElement;
    const rect = target === null ? {width: view.innerWidth, height: view.innerHeight} : target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) throw new Error("要截的元素没有大小");
    let edge = Math.min(options.maxEdge, Math.max(rect.width, rect.height));
    for (;;) {
        const scale = edge / Math.max(rect.width, rect.height);
        const width = Math.max(1, Math.round(rect.width * scale));
        const height = Math.max(1, Math.round(rect.height * scale));
        const canvas = await snapdom.toCanvas(element, {
            width,
            height,
            ...(target === null ? {clip: "viewport" as const} : {}),
            exclude: `[${OWN_NODE_ATTRIBUTE}]`,
        });
        for (const quality of QUALITIES) {
            const blob = await encode(canvas, quality);
            if (blob.size <= options.maxBytes) return {blob, width: canvas.width, height: canvas.height};
        }
        if (edge <= MIN_EDGE) throw new Error("截图缩到最小仍超过大小上限");
        edge = Math.max(MIN_EDGE, Math.floor(edge * SHRINK));
    }
}
