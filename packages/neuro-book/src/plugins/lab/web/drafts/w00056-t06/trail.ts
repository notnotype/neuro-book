/**
 * 第 4 轮第一幕的“手”（w00056 t06）：拖动时身后一道渐隐的金色尾迹，按下与松手处一圈金色涟漪。
 * 取代第 3 轮那支四角小星：@designer 说小星在密的界面里很难看见。画在和舞台一样大的一张 Canvas 上，坐标是舞台坐标；
 * 有东西要画时才跑帧循环，画完就停。第 8 轮尾迹缩短成一小段残影、涟漪收快（@designer：拖动时只要极短的淡金残影）；
 * 夜里叠亮（金在暗处发光），白天底是亮的，叠亮看不见，换成古铜色正常叠上。
 */
import {timeScale} from "./motion";
import type {Point} from "./desk";

export interface Trail {
    /** 尾迹往前长一点（拖影此刻的位置）。 */
    add(point: Point): void;
    /** 在这里漾开一圈（按下、松手、双击的每一下）。 */
    ripple(point: Point): void;
    clear(): void;
    /** 白天（亮底）还是夜里。 */
    tone(day: boolean): void;
    /** 舞台换了大小：画布跟着换。 */
    resize(width: number, height: number): void;
    dispose(): void;
}

/** 尾迹里一个点活多久、涟漪漾多久（ms，探针放慢时跟着放慢）。 */
const TRAIL_LIFE = 360;
const RIPPLE_LIFE = 420;

export function createTrail(canvas: HTMLCanvasElement): Trail {
    const points: Array<Point & {readonly at: number}> = [];
    const ripples: Array<Point & {readonly at: number}> = [];
    let width = 0;
    let height = 0;
    let ratio = 1;
    let loop = 0;
    let day = false;

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
        context.globalCompositeOperation = day ? "source-over" : "lighter";
        context.lineCap = "round";
        const line = day ? "150, 102, 36" : "255, 214, 150";
        const halo = day ? "255, 240, 205" : "225, 178, 133";
        for (let index = 1; index < points.length; index += 1) {
            const from = points[index - 1]!;
            const to = points[index]!;
            const fresh = 1 - (now - to.at) / life;
            if (fresh <= 0) continue;
            context.strokeStyle = `rgba(${line}, ${(0.8 * fresh ** 1.4).toFixed(3)})`;
            context.shadowColor = `rgba(${halo}, ${fresh.toFixed(3)})`;
            context.shadowBlur = 12;
            context.lineWidth = 1 + 3.5 * fresh;
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
        }
        context.shadowBlur = 0;
        for (const ripple of ripples) {
            const age = (now - ripple.at) / rippleLife;
            const eased = 1 - (1 - age) ** 3;
            context.strokeStyle = day ? `rgba(150, 102, 36, ${(0.9 * (1 - age)).toFixed(3)})` : `rgba(255, 220, 160, ${(0.95 * (1 - age)).toFixed(3)})`;
            context.lineWidth = 1.4;
            context.beginPath();
            context.arc(ripple.x, ripple.y, 4 + 20 * eased, 0, Math.PI * 2);
            context.stroke();
            context.fillStyle = day ? `rgba(150, 102, 36, ${(0.55 * (1 - age) ** 2).toFixed(3)})` : `rgba(255, 228, 180, ${(0.7 * (1 - age) ** 2).toFixed(3)})`;
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
        tone(next) {
            day = next;
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
