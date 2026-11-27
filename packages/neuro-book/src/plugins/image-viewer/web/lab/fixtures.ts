import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type ImageViewer from "../components/ImageViewer.vue";

export const fixtures: LabFixture[] = [
    defineLabFixture<typeof ImageViewer>({
        component: "ImageViewer",
        // 字节绑定与图片由夹具生成（这里登记的 binding、host 只占位，夹具换成自己的）；可调的是文件名与界面语言。
        scenes: (() => {
            const base = {binding: null, host: {state: null, dispose: null}, readonly: true, visible: true};
            return [
                {id: "small", label: "比舞台小的图：原尺寸居中", input: {props: {...base, label: "插图.png", locale: "zh-CN" as const}}},
                {id: "large", label: "比舞台大的图：适应、点一下 100%", input: {props: {...base, label: "地图.png", locale: "zh-CN" as const}}},
                {id: "svg", label: "带透明的 SVG：棋盘格", input: {props: {...base, label: "图标.svg", locale: "zh-CN" as const}}},
                {id: "broken", label: "不是图片：说明与重试", input: {props: {...base, label: "坏图.png", locale: "en-US" as const}}},
            ];
        })(),
        load: async () => (await import("./ImageViewerFixture.vue")).default,
    }),
];
