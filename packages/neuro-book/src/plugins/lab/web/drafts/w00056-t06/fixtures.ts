/**
 * w00056 t06（文档站首页的产品介绍）的原型；评审板在那个 Task 的 artifacts/review。
 * 第 3 轮：三种开场与第一幕（`HomepageDraft`）。第 4、5 轮：方向一《入殿·俯案成界》的首屏、俯冲与改过的第一幕（`HomepageSanctum`，
 * 第 5 轮在第 4 轮上改，场景 id 换成 `r5-`；首屏的场景单独看是 `SanctumScene` 的 `r4-scene-*`）。
 * 第 6 轮：第一幕改成真手势与实时布局、加“划出来，记一笔”一拍、整页的昼（`r6-*`），按钮的几版样式（`HeroButtons`）。
 * 第 7 轮：第一幕落地以后自己连播，字幕上面是章节条（`ChapterRail` 三版）；首屏的动静换成从字到世界与指针响应（`r7-*`）。
 */
import {defineLabFixture} from "../../fixtures/define";
import type ChapterRail from "./ChapterRail.vue";
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
            {id: "r7-sanctum", label: "第 7 轮：入殿·俯案成界，夜（从首屏起，往下滚俯冲，落地后第一幕自己连播）", input: {props: {start: "top"}}},
            {id: "r7-day", label: "第 7 轮：白天（午后的抄经室）", input: {props: {start: "top", appearance: "day"}}},
            {id: "r7-act-one", label: "第 7 轮：第一幕连播，章节条 A 古籍标尺（直接落在第一幕）", input: {props: {start: "act-one", rail: "ruler"}}},
            {id: "r7-act-one-diamonds", label: "第 7 轮：第一幕连播，章节条 B 菱形与进度环", input: {props: {start: "act-one", rail: "diamonds"}}},
            {id: "r7-act-one-ribbon", label: "第 7 轮：第一幕连播，章节条 C 赤红书签", input: {props: {start: "act-one", rail: "ribbon"}}},
            {id: "r7-act-one-day", label: "第 7 轮：第一幕连播，白天", input: {props: {start: "act-one", appearance: "day"}}},
            {id: "r7-hero-relay", label: "第 7 轮：首屏只有从字到世界（不跟指针）", input: {props: {start: "top", effects: ["relay"]}}},
            {id: "r7-hero-pointer", label: "第 7 轮：首屏只有指针响应（视差、鎏金反光、悬停细看、丝带尾巴）", input: {props: {start: "top", effects: ["parallax", "glint", "peek", "ribbon"]}}},
            // 前几轮评审板里的链接：组件已经是这一轮的样子，场景 id 留着，旧链接不落空。
            {id: "r6-sanctum", label: "第 6 轮评审板的链接（现为第 7 轮）：从首屏起", input: {props: {start: "top"}}},
            {id: "r6-day", label: "第 6 轮评审板的链接（现为第 7 轮）：白天", input: {props: {start: "top", appearance: "day"}}},
            {id: "r6-act-one", label: "第 6 轮评审板的链接（现为第 7 轮）：第一幕", input: {props: {start: "act-one"}}},
            {id: "r6-act-one-day", label: "第 6 轮评审板的链接（现为第 7 轮）：第一幕，白天", input: {props: {start: "act-one", appearance: "day"}}},
            {id: "r5-sanctum", label: "第 5 轮评审板的链接（现为第 7 轮）：从首屏起", input: {props: {start: "top"}}},
            {id: "r5-act-one", label: "第 5 轮评审板的链接（现为第 7 轮）：第一幕", input: {props: {start: "act-one"}}},
            {id: "r4-sanctum", label: "第 4 轮评审板的链接（现为第 7 轮）：从首屏起", input: {props: {start: "top"}}},
            {id: "r4-act-one", label: "第 4 轮评审板的链接（现为第 7 轮）：第一幕", input: {props: {start: "act-one"}}},
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
            {id: "r7-ruler", label: "A 古籍标尺：第三段演到一半", input: {props: {chapters: RAIL_CHAPTERS, variant: "ruler", current: 2, done: 2, progress: 0.55, status: "playing"}}},
            {id: "r7-diamonds", label: "B 菱形与进度环：第三段演到一半", input: {props: {chapters: RAIL_CHAPTERS, variant: "diamonds", current: 2, done: 2, progress: 0.55, status: "playing"}}},
            {id: "r7-ribbon", label: "C 赤红书签：第三段演到一半", input: {props: {chapters: RAIL_CHAPTERS, variant: "ribbon", current: 2, done: 2, progress: 0.55, status: "playing"}}},
            {id: "r7-ruler-yielded", label: "A 古籍标尺：访客动了工作台（光丝定格，条尾“继续演示”）", input: {props: {chapters: RAIL_CHAPTERS, variant: "ruler", current: 2, done: 2, progress: 0.4, status: "yielded"}}},
            {id: "r7-ruler-finished", label: "A 古籍标尺：演完了（只留从头再看）", input: {props: {chapters: RAIL_CHAPTERS, variant: "ruler", current: 6, done: 6, progress: 0, status: "finished"}}},
        ],
        load: async () => (await import("./ChapterRailFixture.vue")).default as never,
    }),
    defineLabFixture<typeof HeroButtons>({
        component: "HeroButtons",
        noInput: "样张没有参数：四版按钮、夜与昼两种底一起摆出来给开发者挑",
        scenes: [{id: "r6-variants", label: "第 6 轮：按钮四版，夜与昼"}],
        load: async () => (await import("./HeroButtonsFixture.vue")).default as never,
    }),
];
