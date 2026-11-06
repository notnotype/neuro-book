/**
 * `example.scene-clock` 的浏览器入口：向 `workbench.theme-scenes` 贡献一个场景提供者，用画布画天空。读这个文件学三件事：
 *
 * 1. **提供者是浏览器入口的贡献**：主题（`../plugin.ts`）只在 `sceneProvider` 里写提供者的贡献 id，场景图由这里的 `scene()` 画。
 *    工作台把对象 URL 写进主题的场景变量，各个位置照常裁切（docs/specs/theme/skins.md 输出 18）。
 * 2. **入口要在启动时激活**：实现要等入口激活才交到工作台，工作台不替提供者激活入口；写 `activationEvents: ["onStartup"]`。
 *    代价是每个窗口启动时都下载、执行这个入口。入口没激活时，用这个提供者的主题就没有场景图（有后备的 `scene` 就用后备）。
 * 3. **会过期的图**：`expiresAt` 告诉工作台到点重新请求；新图在浏览器解码成功之后才替换旧图，期间旧图继续显示。请求被取消时
 *    （切了主题、入口停止）`signal` 会中止，别再往下画。图要是 `image/*`、不超过 4 MB，否则工作台用后备图并记一条诊断。
 *
 * 对应的场景：`scenarios/08-scene-provider.test.ts`。
 */

import {sceneProvider} from "@notnotype/nb-plugin-sdk/workbench";
import type {SceneRequest, SceneResult} from "@notnotype/nb-plugin-sdk/workbench";

import {plugin, SKY_PROVIDER_NAME} from "../shared/contracts";
import {nextHour, skyAt} from "./sky";

/** 提供者：贡献 id 是 `example.scene-clock.sky-painter`（`SKY_PROVIDER`），主题的 `sceneProvider` 写它。 */
const painter = sceneProvider(plugin, {name: SKY_PROVIDER_NAME});

const WIDTH = 1600;
const HEIGHT = 900;

/**
 * 用到的那一小块画布接口。场景测试在 Bun 里导入这个文件，节点侧的类型检查没有 DOM 库，所以不直接写 `document` 与 `HTMLCanvasElement`，
 * 经 `globalThis` 取，类型写成够用的最小形状；浏览器里它们就是真的画布。
 */
interface Canvas {
    width: number;
    height: number;
    getContext(kind: "2d"): {
        createLinearGradient(x0: number, y0: number, x1: number, y1: number): {addColorStop(offset: number, color: string): void};
        fillStyle: unknown;
        fillRect(x: number, y: number, width: number, height: number): void;
    } | null;
    toBlob(callback: (blob: Blob | null) => void, type: string): void;
}

/** 在画布上画一幅渐变的天空，导出 PNG。 */
async function paint(request: SceneRequest, now: number, signal: AbortSignal): Promise<Blob> {
    const {top, horizon} = skyAt(new Date(now).getHours(), request.appearance, request.working);
    const canvas = (globalThis as unknown as {document: {createElement(tag: "canvas"): Canvas}}).document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("画布不可用");
    const gradient = context.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, horizon);
    context.fillStyle = gradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    return new Promise<Blob>((resolve, reject) => {
        // 画布导出是异步的，期间被取消就不要再交结果。
        canvas.toBlob((blob) => {
            if (signal.aborted) reject(new Error("已取消"));
            else if (blob === null) reject(new Error("导出图片失败"));
            else resolve(blob);
        }, "image/png");
    });
}

export const sceneClockBrowserPlugin = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    contributions: {painter},
    activate: () => ({
        contributions: {
            painter: painter.implement({
                scene: async (request, signal): Promise<SceneResult> => {
                    const now = Date.now();
                    return {image: await paint(request, now, signal), expiresAt: nextHour(now)};
                },
            }),
        },
    }),
})]);
