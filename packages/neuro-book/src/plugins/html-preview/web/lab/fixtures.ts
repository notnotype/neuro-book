import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type HtmlPreview from "../components/HtmlPreview.vue";

export const fixtures: LabFixture[] = [
    defineLabFixture<typeof HtmlPreview>({
        component: "HtmlPreview",
        // 文本绑定、令牌服务与时钟由夹具给出（这里登记的 binding、host 只占位）；界面语言由场景 id 决定（`-english` 结尾用英文）。
        scenes: (() => {
            const base = {binding: null, host: {state: null, dispose: null}, readonly: true, visible: true, label: "index.html"};
            return [
                {id: "page", label: "预览一张带脚本的页面", input: {props: base}},
                {id: "user", label: "不是作品里的文件", input: {props: base}},
                {id: "denied", label: "令牌申请失败：说明与重试", input: {props: base}},
                {id: "denied-english", label: "令牌申请失败：英文界面", input: {props: base}},
            ];
        })(),
        load: async () => (await import("./HtmlPreviewFixture.vue")).default,
    }),
];
