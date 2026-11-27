/**
 * w00056 t06（文档站首页的产品介绍）的原型；评审板在那个 Task 的 artifacts/review。
 * 第 3 轮：三种开场与第一幕（`HomepageDraft`）。第 4、5 轮：方向一《入殿·俯案成界》的首屏、俯冲与改过的第一幕（`HomepageSanctum`，
 * 第 5 轮在第 4 轮上改，场景 id 换成 `r5-`；首屏的场景单独看是 `SanctumScene` 的 `r4-scene-*`）。
 * 第 6 轮：第一幕改成真手势与实时布局、加“划出来，记一笔”一拍、整页的昼（`r6-*`），按钮的几版样式（`HeroButtons`）。
 * 第 7 轮：第一幕落地以后自己连播，字幕上面是章节条（`ChapterRail` 三版）；首屏的动静换成从字到世界与指针响应（`r7-*`）。
 * 第 8 轮：章节条、按钮（`GiltButton`）与首屏的动静换成开发者选定的一版；字幕挪到工作台上面做眉题，几处要对照着看的时候加案头聚光
 * （`DeskSpotlight`）；白天重做成同一个白天（亚麻桌布）；首屏的纸点了能细看，指针搅动浮尘（`r8-*`）。没选的变体删了，它们的场景 id 留作别名。
 */
import {defineLabFixture} from "../../fixtures/define";
import type ChapterRail from "./ChapterRail.vue";
import type DeskSpotlight from "./DeskSpotlight.vue";
import type GiltButton from "./GiltButton.vue";
import type HeroButtons from "./HeroButtons.vue";
import type HomepageDesk from "./HomepageDesk.vue";
import type HomepageDraft from "./HomepageDraft.vue";
import type HomepageOpening from "./HomepageOpening.vue";
import type HomepageSanctum from "./HomepageSanctum.vue";
import type SanctumScene from "./SanctumScene.vue";

type DraftProps = {readonly opening: "unfold" | "gild" | "assemble"; readonly start?: "top" | "act-one"; readonly headline?: string};
const DRAFT_SCENES: ReadonlyArray<readonly [string, string, DraftProps]> = [
    ["unfold", "开场 A：书展开成工作台", {opening: "unfold"}],
    ["gild", "开场 B：金线勾出工作台", {opening: "gild"}],
    ["assemble", "开场 C：工作台自己搭起来", {opening: "assemble"}],
    ["act-one", "第一幕：一张随你摆的桌子（不放开场，从这一幕开头起）", {opening: "gild", start: "act-one"}],
];

/** 章节条的六段：和第一幕的短标题一样（`copy.ts` 的 `BEATS`）。 */
const RAIL_CHAPTERS = ["两章并排", "高亮批注", "人物浮窗", "视图换位", "专心写", "下次还在"];

/** 开场单独看时的一份卡片：1000×640 的桌面上，活动栏、侧栏、编辑区、右栏与状态栏（数值取自真工作台的一次量取，取整）。 */
const CARD = {radius: "12px", shadow: "rgba(59, 52, 43, 0.1) 0px 1px 2px 0px"};
const SAMPLE_PLATES = [
    {id: "activitybar", kind: "bar" as const, rect: {left: 4, top: 4, width: 44, height: 608}, paint: {background: "rgb(244, 240, 232)", ...CARD}},
    {id: "sidebar", kind: "tool" as const, rect: {left: 52, top: 4, width: 232, height: 608}, paint: {background: "rgb(244, 240, 232)", ...CARD}},
    {id: "g0", kind: "editor" as const, rect: {left: 288, top: 4, width: 404, height: 608}, paint: {background: "rgb(255, 252, 245)", ...CARD}},
    {id: "auxiliarybar", kind: "tool" as const, rect: {left: 696, top: 4, width: 300, height: 608}, paint: {background: "rgb(244, 240, 232)", ...CARD}},
    {id: "statusbar", kind: "status" as const, rect: {left: 0, top: 616, width: 1000, height: 24}, paint: {background: "transparent", radius: "0px", shadow: "none"}},
];

export const fixtures = [
    defineLabFixture<typeof HomepageDraft>({
        component: "HomepageDraft",
        scenes: DRAFT_SCENES.map(([id, label, props]) => ({id, label, input: {props: {...props}}})),
        load: async () => (await import("./HomepageDraftFixture.vue")).default as never,
    }),
    defineLabFixture<typeof HomepageDesk>({
        component: "HomepageDesk",
        scenes: [
            {id: "default", label: "首屏的样子：第一章在前，右栏是星璃", input: {props: {restore: null}}},
            {id: "knock", label: "第一幕的桌子：第五章在前，后面是第一章与艾莉丝", input: {props: {restore: null, setup: "knock"}}},
        ],
        load: async () => (await import("./HomepageDeskFixture.vue")).default as never,
    }),
    defineLabFixture<typeof HomepageSanctum>({
        component: "HomepageSanctum",
        scenes: [
            {id: "r8-sanctum", label: "第 8 轮：入殿·俯案成界，夜（从首屏起，往下滚俯冲，落地后第一幕自己连播）", input: {props: {start: "top"}}},
            {id: "r8-day", label: "第 8 轮：白天（午后的抄经室，亚麻桌布）", input: {props: {start: "top", appearance: "day"}}},
            {id: "r8-act-one", label: "第 8 轮：第一幕连播（眉题、案头聚光，直接落在第一幕）", input: {props: {start: "act-one"}}},
            {id: "r8-act-one-day", label: "第 8 轮：第一幕连播，白天", input: {props: {start: "act-one", appearance: "day"}}},
            // 前几轮评审板里的链接：组件已经是这一轮的样子，场景 id 留着，旧链接不落空（第 7 轮没选的章节条与首屏的两种动静也落到这一轮）。
            ...([
                ["r7-sanctum", 7, "从首屏起", {start: "top"}],
                ["r7-day", 7, "白天", {start: "top", appearance: "day"}],
                ["r7-act-one", 7, "第一幕", {start: "act-one"}],
                ["r7-act-one-diamonds", 7, "第一幕（章节条已定为古籍标尺）", {start: "act-one"}],
                ["r7-act-one-ribbon", 7, "第一幕（章节条已定为古籍标尺）", {start: "act-one"}],
                ["r7-act-one-day", 7, "第一幕，白天", {start: "act-one", appearance: "day"}],
                ["r7-hero-relay", 7, "首屏（已定为从字到世界加指针响应）", {start: "top"}],
                ["r7-hero-pointer", 7, "首屏（已定为从字到世界加指针响应）", {start: "top"}],
                ["r6-sanctum", 6, "从首屏起", {start: "top"}],
                ["r6-day", 6, "白天", {start: "top", appearance: "day"}],
                ["r6-act-one", 6, "第一幕", {start: "act-one"}],
                ["r6-act-one-day", 6, "第一幕，白天", {start: "act-one", appearance: "day"}],
                ["r5-sanctum", 5, "从首屏起", {start: "top"}],
                ["r5-act-one", 5, "第一幕", {start: "act-one"}],
                ["r4-sanctum", 4, "从首屏起", {start: "top"}],
                ["r4-act-one", 4, "第一幕", {start: "act-one"}],
            ] as const).map(([id, round, what, props]) => ({id, label: `第 ${round} 轮评审板的链接（现为第 8 轮）：${what}`, input: {props: {...props}}})),
        ],
        load: async () => (await import("./HomepageSanctumFixture.vue")).default as never,
    }),
    defineLabFixture<typeof SanctumScene>({
        component: "SanctumScene",
        scenes: [
            {id: "r4-scene-intro", label: "首屏场景：开场（桌上是占位）", input: {props: {progress: 0, intro: true, deskReady: true}}},
            {id: "r6-scene-day", label: "首屏场景：白天", input: {props: {progress: 0, intro: true, deskReady: true, night: false}}},
            {id: "r4-scene-mid", label: "俯冲到一半", input: {props: {progress: 0.45, intro: false, deskReady: true}}},
            {id: "r4-scene-near", label: "快落地", input: {props: {progress: 0.82, intro: false, deskReady: true}}},
        ],
        load: async () => (await import("./SanctumSceneFixture.vue")).default as never,
    }),
    defineLabFixture<typeof HomepageOpening>({
        component: "HomepageOpening",
        scenes: (["unfold", "gild", "assemble"] as const).map((variant) => ({
            id: variant,
            label: {unfold: "书展开成工作台", gild: "金线勾出工作台", assemble: "工作台自己搭起来"}[variant],
            input: {props: {variant, plates: SAMPLE_PLATES, ground: "rgb(236, 232, 223)", width: 1000, height: 640}},
        })),
        load: async () => (await import("./HomepageOpeningFixture.vue")).default as never,
    }),
    defineLabFixture<typeof ChapterRail>({
        component: "ChapterRail",
        scenes: [
            {id: "r7-ruler", label: "古籍标尺：第三段演到一半", input: {props: {chapters: RAIL_CHAPTERS, current: 2, done: 2, progress: 0.55, status: "playing"}}},
            {id: "r7-ruler-yielded", label: "访客动了工作台（光丝定格，条尾“继续演示”）", input: {props: {chapters: RAIL_CHAPTERS, current: 2, done: 2, progress: 0.4, status: "yielded"}}},
            {id: "r7-ruler-finished", label: "演完了（只留从头再看）", input: {props: {chapters: RAIL_CHAPTERS, current: 6, done: 6, progress: 0, status: "finished"}}},
            // 第 7 轮没选的两版：场景 id 留着，打开的是选定的古籍标尺。
            {id: "r7-diamonds", label: "第 7 轮评审板的链接（已定为古籍标尺）：第三段演到一半", input: {props: {chapters: RAIL_CHAPTERS, current: 2, done: 2, progress: 0.55, status: "playing"}}},
            {id: "r7-ribbon", label: "第 7 轮评审板的链接（已定为古籍标尺）：第三段演到一半", input: {props: {chapters: RAIL_CHAPTERS, current: 2, done: 2, progress: 0.55, status: "playing"}}},
        ],
        load: async () => (await import("./ChapterRailFixture.vue")).default as never,
    }),
    defineLabFixture<typeof HeroButtons>({
        component: "HeroButtons",
        noInput: "样张没有参数：选定的那一版按钮，夜与昼两种底、两种大小一起摆出来",
        scenes: [
            {id: "r8-chosen", label: "第 8 轮：选定的皮面烫金，夜与昼"},
            {id: "r6-variants", label: "第 6 轮评审板的链接（已定为皮面烫金）：夜与昼"},
        ],
        load: async () => (await import("./HeroButtonsFixture.vue")).default as never,
    }),
    defineLabFixture<typeof GiltButton>({
        component: "GiltButton",
        scenes: [
            {id: "r8-primary", label: "主按钮，夜", input: {props: {primary: true}}},
            {id: "r8-secondary", label: "次按钮，夜", input: {props: {primary: false}}},
            {id: "r8-primary-day", label: "主按钮，白天", input: {props: {primary: true, day: true}}},
            {id: "r8-secondary-day", label: "次按钮，白天（浅羊皮纸底、深墨字）", input: {props: {primary: false, day: true}}},
            {id: "r8-small", label: "小号（第一幕交给访客那一行）", input: {props: {primary: true, size: "small"}}},
        ],
        load: async () => (await import("./GiltButtonFixture.vue")).default as never,
    }),
    defineLabFixture<typeof DeskSpotlight>({
        component: "DeskSpotlight",
        scenes: [
            {id: "r8-one", label: "照亮一块，内沿描细金线（“换一处”看亮处怎么换）", input: {props: {spots: [{left: 230, top: 90, width: 360, height: 40}], rims: [0], width: 900, height: 560}}},
            {id: "r8-two", label: "照亮两块：把手与落点", input: {props: {spots: [{left: 40, top: 24, width: 150, height: 30}, {left: 620, top: 60, width: 250, height: 460}], rims: [0], width: 900, height: 560}}},
            {id: "r8-day", label: "白天：暖褐的幕、古铜细线", input: {props: {spots: [{left: 230, top: 90, width: 360, height: 40}], rims: [0], width: 900, height: 560, night: false}}},
        ],
        load: async () => (await import("./DeskSpotlightFixture.vue")).default as never,
    }),
];
