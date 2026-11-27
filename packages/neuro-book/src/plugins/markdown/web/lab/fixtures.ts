import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type MarkdownImageCard from "nbook/plugins/markdown/web/components/menus/MarkdownImageCard.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof MarkdownImageCard>({
        component: "MarkdownImageCard",
        // 卡片的数据来自夹具里的假文件服务；场景决定数据与宿主状态，`english` 用英文界面。需要的锚点、菜单文字与插图能力由夹具给出。
        scenes: [
            {id: "list", label: "存放目录里的图：缩略图、名字过长截中间、坏图画占位", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "loading", label: "读取中", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "empty", label: "没有图", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "error", label: "读不了：说明原因", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "truncated", label: "查到的比显示的多：末尾一行提示", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "no-library", label: "宿主没有提供插图能力：只能插入网址的图片，上传置灰", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "unbound", label: "没有绑定作品：列表为空，上传置灰", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
            {id: "english", label: "英文界面", input: {props: {open: true, session: 1, anchor: null, media: null, current: "project://卷一/第一章.md"}}},
        ],
        load: async () => (await import("./MarkdownImageCardFixture.vue")).default,
    }),
];
