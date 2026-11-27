import {createSubjectFixture, defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type StickerPacksPage from "nbook/plugins/stickers/web/components/StickerPacksPage.vue";
import {SAMPLES, summaryOf, detailOf, sampleById} from "./samples";
import {stickerKey, extraKey, railGroups} from "nbook/plugins/stickers/web/pack-view";
import {withStickersPageText} from "./stickers-text";
import {SHELF_ITEMS, SHELF_NOW} from "nbook/plugins/projects/web/lab/shelf-fixture-data";
import type StickerPackRail from "nbook/plugins/stickers/web/components/StickerPackRail.vue";
import type StickerGrid from "nbook/plugins/stickers/web/components/StickerGrid.vue";
import type StickerFields from "nbook/plugins/stickers/web/components/StickerFields.vue";
import type {GridItem} from "nbook/plugins/stickers/web/pack-view";
import type StickerSlot from "nbook/plugins/stickers/web/components/StickerSlot.vue";
import type StickerPickerPanel from "nbook/plugins/stickers/web/components/StickerPickerPanel.vue";
import type PackFields from "nbook/plugins/stickers/web/components/PackFields.vue";
import type StickerPackNameDialog from "nbook/plugins/stickers/web/components/StickerPackNameDialog.vue";
import type ImportConflictDialog from "nbook/plugins/stickers/web/components/ImportConflictDialog.vue";

function stickersFixtures(): LabFixture[] {
    const page = {status: "ready" as const, items: SHELF_ITEMS, now: SHELF_NOW, library: "/home/writer/Documents/NeuroBook"};
    return [
        defineLabFixture<typeof StickerPacksPage>({
            component: "StickerPacksPage",
            scenes: (() => {
                const packs = SAMPLES.map(summaryOf);
                const page = (selected: string, extra: {initialSticker?: string | null; uploads?: Array<{id: number; packId: string; name: string; state: "running" | "waiting"}>} = {}) => ({
                    state: "ready" as const, packs, selected, detail: detailOf(sampleById(selected)!), uploads: extra.uploads ?? [], initialSticker: extra.initialSticker ?? null,
                });
                const lyraKey = (name: string): string => stickerKey(`${name}.png`, name);
                return [
                    {id: "pack", label: "没选表情：表情包自己的属性", input: {props: page("user.lyra")}},
                    {id: "sticker", label: "选中一个表情：属性栏", input: {props: page("user.lyra", {initialSticker: lyraKey("开心")})}},
                    {id: "problem", label: "没有清单的包：认不出的图要先改名", input: {props: page("user.cat", {initialSticker: extraKey("1.png")})}},
                    {id: "unlisted", label: "有清单的包：文件夹里没加进来的图", input: {props: page("user.lyra", {initialSticker: extraKey("摸摸头.png")})}},
                    {id: "plugin", label: "插件的包：只读、复制到我的", input: {props: page("acme.cute.mochi", {initialSticker: stickerKey("好耶.png", "好耶")})}},
                    {id: "builtin-shadowed", label: "内置的包：只读，被我的同名包盖住", input: {props: page("builtin.lyra")}},
                    {id: "builtin-shadowed-narrow-english", label: "内置的包被盖住：480px 宽、英文界面", input: {props: page("builtin.lyra")}},
                    {id: "empty-pack", label: "还没有表情的包：整个网格是落点", input: {props: page("user.empty")}},
                    {id: "uploading", label: "上传中：占位格", input: {props: page("user.lyra", {uploads: [{id: 1, packId: "user.lyra", name: "新图.png", state: "running"}, {id: 2, packId: "user.lyra", name: "另一张.jpg", state: "waiting"}]})}},
                    {id: "many", label: "很多表情：网格折行", input: {props: page("user.many")}},
                    {id: "invalid", label: "无效的表情包：写原因", input: {props: {...page("user.broken"), detail: null}}},
                    {id: "no-packs", label: "还没有任何表情包", input: {props: {state: "ready" as const, packs: [], selected: null, detail: null}}},
                    {id: "loading", label: "读取中", input: {props: {state: "loading" as const, packs: [], selected: null, detail: null}}},
                    {id: "failed", label: "读失败", input: {props: {state: {failed: "unavailable"}, packs: [], selected: null, detail: null}}},
                    {id: "narrow", label: "480px 宽：左栏收成下拉，属性栏排到下面", input: {props: page("user.lyra", {initialSticker: lyraKey("开心")})}},
                    {id: "english", label: "英文界面", input: {props: page("user.lyra", {initialSticker: lyraKey("开心")})}},
                ];
            })(),
            load: async () => withStickersPageText((await import("./StickerPacksFixture.vue")).default),
        }),
        defineLabFixture<typeof StickerPackRail>({
            component: "StickerPackRail",
            scenes: [
                {id: "rail", label: "我的、插件、内置各一组，有认不出的、无效的与被盖住的", input: {props: {groups: railGroups(SAMPLES.map(summaryOf)), current: "user.lyra"}}},
                {id: "disabled", label: "新建与导入停用", input: {props: {groups: railGroups(SAMPLES.map(summaryOf)), current: "user.cat", disabled: true}}},
                {id: "english", label: "英文界面", input: {props: {groups: railGroups(SAMPLES.map(summaryOf)), current: "user.lyra"}}},
            ],
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerPackRail>((await import("nbook/plugins/stickers/web/components/StickerPackRail.vue")).default)),
        }),
        defineLabFixture<typeof StickerGrid>({
            component: "StickerGrid",
            scenes: [
                {id: "grid", label: "认不出、常用、其他、没加进来；宽图、竖图、方图", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null}}},
                {id: "uploading", label: "上传中的占位格", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null, uploads: [{id: 1, packId: "user.lyra", name: "新图.png", state: "running"}]}}},
                {id: "readonly", label: "只读：没有“添加”格", input: {props: {detail: detailOf(sampleById("acme.cute.mochi")!), selected: null, readonly: true}}},
                {id: "empty", label: "还没有图：整个网格是落点", input: {props: {detail: detailOf(sampleById("user.empty")!), selected: null}}},
                {id: "dragging", label: "拖进 3 张图", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null, dragging: true, dragCount: 3}}},
                {id: "english", label: "英文界面", input: {props: {detail: detailOf(sampleById("user.lyra")!), selected: null}}},
            ],
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerGrid>((await import("nbook/plugins/stickers/web/components/StickerGrid.vue")).default)),
        }),
        defineLabFixture<typeof StickerFields>({
            component: "StickerFields",
            scenes: (() => {
                const lyra = detailOf(sampleById("user.lyra")!);
                const sticker = (name: string): GridItem => {
                    const found = lyra.stickers.find((one) => one.name === name)!;
                    return {key: found.file, kind: "sticker", file: found.file, label: found.name, url: found.url, width: found.width, height: found.height, bytes: found.bytes, name: found.name, raw: found.raw ?? null, reason: null, common: found.common, ...(found.description === undefined ? {} : {description: found.description})};
                };
                const extra = (file: string, reason: "name" | "unlisted", file2 = file): GridItem => {
                    const found = lyra.extras.find((one) => one.file === file)!;
                    return {key: file2, kind: "extra", file: file2, label: file2, url: found.url, width: found.width, height: found.height, bytes: found.bytes, name: null, raw: null, reason, common: false};
                };
                return [
                    {id: "sticker", label: "表情：名字、说明、写法、常用", input: {props: {item: sticker("开心"), writing: "lyra"}}},
                    {id: "problem", label: "认不出的图：先要改名", input: {props: {item: extra("摸摸头.png", "name", "1.png"), writing: "lyra"}}},
                    {id: "unlisted", label: "没加进来的图", input: {props: {item: extra("摸摸头.png", "unlisted"), writing: "lyra"}}},
                    {id: "readonly", label: "插件的包：只读", input: {props: {item: sticker("开心"), writing: "mochi", readonly: true}}},
                    {id: "english", label: "英文界面", input: {props: {item: sticker("开心"), writing: "lyra"}}},
                ];
            })(),
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerFields>((await import("nbook/plugins/stickers/web/components/StickerFields.vue")).default, {runtimeProps: {commit: async () => null}})),
        }),
        defineLabFixture<typeof StickerSlot>({
            component: "StickerSlot",
            scenes: [
                {id: "square", label: "方图：64 × 64 的框", input: {props: {url: detailOf(sampleById("user.lyra")!).stickers[0]!.url}}},
                {id: "faded", label: "调淡：认不出的、没加进来的", input: {props: {url: detailOf(sampleById("user.lyra")!).stickers[0]!.url, faded: true}}},
            ],
            load: async () => createSubjectFixture<typeof StickerSlot>((await import("nbook/plugins/stickers/web/components/StickerSlot.vue")).default, {class: "h-24 w-24 p-2"}),
        }),
        defineLabFixture<typeof StickerPickerPanel>({
            component: "StickerPickerPanel",
            noInput: "面板要一个选择器服务，台子按场景名用样本表情包造一个真的（StickerPickerFixture.vue）",
            scenes: [
                {id: "packs", label: "几个表情包：组头、标签、底部的写法"},
                {id: "recent", label: "有最近用过"},
                {id: "empty", label: "一个表情包也没有"},
                {id: "narrow", label: "300px 宽"},
                {id: "english", label: "英文界面"},
            ],
            load: async () => withStickersPageText((await import("./StickerPickerFixture.vue")).default),
        }),
        defineLabFixture<typeof PackFields>({
            component: "PackFields",
            scenes: [
                {id: "user", label: "用户的包：显示名、说明、包名、按贴纸显示", input: {props: {detail: detailOf(sampleById("user.lyra")!)}, model: {stickerDisplay: false}}},
                {id: "plugin", label: "插件的包：只读，按贴纸显示照样能设", input: {props: {detail: detailOf(sampleById("acme.cute.mochi")!), readonly: true}, model: {stickerDisplay: true}}},
                {id: "english", label: "英文界面", input: {props: {detail: detailOf(sampleById("user.lyra")!)}, model: {stickerDisplay: false}}},
            ],
            // 按贴纸显示的开关（stickers.md 输出 47）是受控的：点了写回模型，场景里看得到开关跟着变。
            load: async () => withStickersPageText(createSubjectFixture<typeof PackFields>((await import("nbook/plugins/stickers/web/components/PackFields.vue")).default, {runtimeProps: {commit: async () => null}, writeBack: {"update:stickerDisplay": {layer: "model", key: "stickerDisplay"}}})),
        }),
        defineLabFixture<typeof StickerPackNameDialog>({
            component: "StickerPackNameDialog",
            scenes: [
                {id: "create", label: "新建", input: {props: {mode: "create"}, model: {open: true}}},
                {id: "rename", label: "改包名：警示与用到它的 Profile", input: {props: {mode: "rename", current: "lyra", usage: ["剧情问答", "设定核对"]}, model: {open: true}}},
                {id: "rename-loading", label: "改包名：还在查 Profile", input: {props: {mode: "rename", current: "lyra"}, model: {open: true}}},
                {id: "failed", label: "提交失败：已被用", input: {props: {mode: "create", status: "已经有同名的表情包。"}, model: {open: true}}},
                {id: "english", label: "英文界面", input: {props: {mode: "rename", current: "lyra", usage: null}, model: {open: true}}},
            ],
            load: async () => withStickersPageText(createSubjectFixture<typeof StickerPackNameDialog>((await import("nbook/plugins/stickers/web/components/StickerPackNameDialog.vue")).default)),
        }),
        defineLabFixture<typeof ImportConflictDialog>({
            component: "ImportConflictDialog",
            scenes: (() => {
                const thumb = (id: string, count: number) => detailOf(sampleById(id)!).stickers.slice(0, count).map((sticker) => ({url: sticker.url, label: sticker.file}));
                const base = {name: "cat", existing: {title: "cat", count: 4, items: thumb("user.cat", 4)}, incoming: {title: "猫猫", count: 12, items: thumb("user.lyra", 4)}, copyAs: "cat-2"};
                return [
                    {id: "conflict", label: "同名：另存或替换", input: {props: base, model: {open: true}}},
                    {id: "busy", label: "处理中", input: {props: {...base, busy: true}, model: {open: true}}},
                    {id: "failed", label: "选择失败：原因写在下面", input: {props: {...base, status: "已有的表情包刚被别处改过，重新选择。"}, model: {open: true}}},
                    {id: "no-copy", label: "没有空的包名：另存不可用", input: {props: {...base, copyAs: null}, model: {open: true}}},
                    {id: "unknown", label: "读不出要导入的包", input: {props: {...base, incoming: {title: "cat", count: null, items: []}}, model: {open: true}}},
                    {id: "english", label: "英文界面", input: {props: base, model: {open: true}}},
                ];
            })(),
            load: async () => withStickersPageText(createSubjectFixture<typeof ImportConflictDialog>((await import("nbook/plugins/stickers/web/components/ImportConflictDialog.vue")).default)),
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...stickersFixtures(),
];
