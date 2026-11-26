/**
 * 第 4 轮第一幕的“手”（w00056 t06）：拖动时身后一道渐隐的金色尾迹，按下与松手处一圈金色涟漪。
 * 取代第 3 轮那支四角小星：@designer 说小星在密的界面里很难看见。画在舞台上的一张 Canvas 上，坐标是舞台坐标；
 * 有东西要画时才跑帧循环，画完就停。
 */
import {timeScale} from "./motion";
import type {Point} from "./desk";

export interface Trail {
    /** 尾迹往前长一点（拖影此刻的位置）。 */
    add(point: Point): void;
    /** 在这里漾开一圈（按下、松手、双击的每一下）。 */
    ripple(point: Point): void;
    clear(): void;
    /** 舞台换了大小：画布跟着换。 */
    resize(width: number, height: number): void;
    dispose(): void;
}

/** 尾迹里一个点活多久、涟漪漾多久（ms，探针放慢时跟着放慢）。 */
const TRAIL_LIFE = 520;
const RIPPLE_LIFE = 620;

export function createTrail(canvas: HTMLCanvasElement): Trail {
    const points: Array<Point & {readonly at: number}> = [];
    const ripples: Array<Point & {readonly at: number}> = [];
    let width = 0;
    let height = 0;
    let ratio = 1;
    let loop = 0;

    function draw(): void {
        loop = 0;
        const context = canvas.getContext("2d");
        if (context === null) return;
        const now = performance.now();
        const life = TRAIL_LIFE * timeScale();
        const rippleLife = RIPPLE_LIFE * timeScale();
        while (points.length > 0 && now - points[0]!.at > life) points.shift();
        while (ripples.length > 0 && now - ripples[0]!.at > rippleLife) ripples.shift();
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";
        for (let index = 1; index < points.length; index += 1) {
            const from = points[index - 1]!;
            const to = points[index]!;
            const fresh = 1 - (now - to.at) / life;
            if (fresh <= 0) continue;
            context.strokeStyle = `rgba(255, 214, 150, ${(0.85 * fresh ** 1.4).toFixed(3)})`;
            context.shadowColor = `rgba(225, 178, 133, ${fresh.toFixed(3)})`;
            context.shadowBlur = 14;
            context.lineWidth = 1 + 4.5 * fresh;
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
        }
        context.shadowBlur = 0;
        for (const ripple of ripples) {
            const age = (now - ripple.at) / rippleLife;
            const eased = 1 - (1 - age) ** 3;
            context.strokeStyle = `rgba(255, 220, 160, ${(0.95 * (1 - age)).toFixed(3)})`;
            context.lineWidth = 2;
            context.beginPath();
            context.arc(ripple.x, ripple.y, 5 + 24 * eased, 0, Math.PI * 2);
            context.stroke();
            context.fillStyle = `rgba(255, 228, 180, ${(0.7 * (1 - age) ** 2).toFixed(3)})`;
            context.beginPath();
            context.arc(ripple.x, ripple.y, 4, 0, Math.PI * 2);
            context.fill();
        }
        if (points.length > 0 || ripples.length > 0) loop = requestAnimationFrame(draw);
    }

    const wake = (): void => {
        if (loop === 0) loop = requestAnimationFrame(draw);
    };

    return {
        add(point) {
            points.push({...point, at: performance.now()});
            wake();
        },
        ripple(point) {
            ripples.push({...point, at: performance.now()});
            wake();
        },
        clear() {
            points.length = 0;
            ripples.length = 0;
            wake();
        },
        resize(nextWidth, nextHeight) {
            width = nextWidth;
            height = nextHeight;
            ratio = Math.min(2, globalThis.devicePixelRatio || 1);
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            wake();
        },
        dispose() {
            if (loop !== 0) cancelAnimationFrame(loop);
            loop = 0;
        },
    };
}
