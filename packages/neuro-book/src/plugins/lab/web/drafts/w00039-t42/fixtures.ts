/** w00039 t42（条目页的页头、分页与保存提示）的静态稿：第 1 轮 EntryPageDraft，第 2 轮 ViewPointDraft 与 InPlaceEditDraft；评审板在那个 Task 的 artifacts/review。 */
import {defineLabFixture} from "../../fixtures/define";
import type EntryPageDraft from "./EntryPageDraft.vue";
import type InPlaceEditDraft from "./InPlaceEditDraft.vue";
import type ViewPointDraft from "./ViewPointDraft.vue";

type Props = {readonly variant: "tabs" | "rail"; readonly scene: "filled" | "new" | "notice" | "position" | "plan" | "name-hover"; readonly tabSize?: "sm"};
/** 场景：排法（tabs 横排、rail 宽时竖排）、状态，横排可以小一档。 */
const SCENES: ReadonlyArray<readonly [string, string, Props]> = [
    ["tabs-filled", "横排：填好的星瑕", {variant: "tabs", scene: "filled"}],
    ["sm-tabs-filled", "横排小一档：填好的星瑕", {variant: "tabs", scene: "filled", tabSize: "sm"}],
    ["tabs-new", "横排：空作品里刚新建、加上了形象", {variant: "tabs", scene: "new"}],
    ["tabs-notice", "横排：保存后的提示", {variant: "tabs", scene: "notice"}],
    ["tabs-position", "横排：时间点展开", {variant: "tabs", scene: "position"}],
    ["tabs-plan", "横排：算上计划", {variant: "tabs", scene: "plan"}],
    ["tabs-name-hover", "横排：指着名字", {variant: "tabs", scene: "name-hover"}],
    ["rail-filled", "竖排：填好的星瑕", {variant: "rail", scene: "filled"}],
    ["rail-new", "竖排：刚新建", {variant: "rail", scene: "new"}],
    ["rail-notice", "竖排：保存后的提示", {variant: "rail", scene: "notice"}],
];

type ViewPointProps = {readonly variant: "merged" | "labeled" | "timeline"; readonly state: "default" | "menu" | "line-menu" | "pinned" | "plan" | "main-only"; readonly many?: boolean; readonly search?: string; readonly steppers?: boolean};
const VIEW_POINT_LABELS = {merged: "A 合成一个“在看”", labeled: "B 两个控件各带名字", timeline: "C 时间条"} as const;
const VIEW_POINT_STATES: ReadonlyArray<readonly [ViewPointProps["state"], string]> = [
    ["default", "缺省"],
    ["menu", "菜单打开"],
    ["pinned", "固定看分支线"],
    ["plan", "算上计划"],
    ["main-only", "只有主线"],
];
/** 第 2 轮：页头“看哪一刻”的三种做法 × 几个状态；B 另有线的菜单打开。 */
const VIEW_POINT_SCENES: ReadonlyArray<readonly [string, string, ViewPointProps]> = [
    ...(["merged", "labeled", "timeline"] as const).flatMap((variant) => VIEW_POINT_STATES.filter(([state]) => !(variant === "timeline" && state === "menu")).map(([state, label]) => [`r2-${variant}-${state}`, `${VIEW_POINT_LABELS[variant]}：${label}`, {variant, state}] as const)),
    ["r2-labeled-line-menu", `${VIEW_POINT_LABELS.labeled}：线的菜单打开`, {variant: "labeled", state: "line-menu"}],
    // 第 3 轮（开发者选了 A）：章多了怎么找、两边要不要前后一步。
    ["r3-merged-many", "第 3 轮 A：60 章，菜单滚到当前章", {variant: "merged", state: "menu", many: true}],
    ["r3-merged-many-search", "第 3 轮 A：60 章，搜“钟”", {variant: "merged", state: "menu", many: true, search: "钟"}],
    ["r3-merged-steppers", "第 3 轮 A：两边前后一步", {variant: "merged", state: "default", many: true, steppers: true}],
    ["r3-merged-steppers-menu", "第 3 轮 A：两边前后一步，菜单打开", {variant: "merged", state: "menu", many: true, steppers: true}],
];

type InPlaceProps = {readonly variant: "compact" | "outcome" | "inline"; readonly case: "age" | "where" | "height" | "gender" | "personality" | "initial"; readonly surface?: "glass"; readonly words?: "where" | "since" | "why"; readonly storyNote?: boolean; readonly longCard?: boolean};
const IN_PLACE_LABELS = {compact: "A 紧凑浮层", outcome: "B 选项写成结果", inline: "C 原地展开"} as const;
const IN_PLACE_CASES: ReadonlyArray<readonly [InPlaceProps["case"], string]> = [
    ["age", "改年龄（只在最初设过）"],
    ["where", "改现在在哪（第 2 章改过）"],
    ["height", "改身高，多一条待处理"],
    ["gender", "改性别（有建议值）"],
    ["personality", "改性格（长文字）"],
    ["initial", "看“最初”时改年龄"],
];
/** 第 2 轮：就地改的三种做法 × 几种情形，外加紧凑浮层用玻璃的对照。 */
const IN_PLACE_SCENES: ReadonlyArray<readonly [string, string, InPlaceProps]> = [
    ...(["compact", "outcome", "inline"] as const).flatMap((variant) => IN_PLACE_CASES.map(([edit, label]) => [`r2-${variant}-${edit}`, `${IN_PLACE_LABELS[variant]}：${label}`, {variant, case: edit}] as const)),
    ["r2-compact-age-glass", `${IN_PLACE_LABELS.compact}：改年龄，玻璃的面`, {variant: "compact", case: "age", surface: "glass"}],
    ["r2-compact-gender-glass", `${IN_PLACE_LABELS.compact}：改性别，玻璃的面`, {variant: "compact", case: "gender", surface: "glass"}],
    // 第 3 轮（开发者选了紧凑浮层、玻璃）：二选一怎么写、要不要写一句发生了什么、长文字原处展开用同一张卡。
    ...(["since", "why", "where"] as const).flatMap((words) => (["age", "where"] as const).map((edit) => [`r3-${words}-${edit}`, `第 3 轮写法 ${({since: "从什么时候起", why: "为什么改", where: "落点"})[words]}：${edit === "age" ? "年龄" : "现在在哪"}`, {variant: "compact", case: edit, surface: "glass", words}] as const)),
    ["r3-note-age", "第 3 轮：选剧情里变了，多一行发生了什么", {variant: "compact", case: "age", surface: "glass", words: "since", storyNote: true}],
    ["r3-note-height", "第 3 轮：选剧情里变了，多一条待处理", {variant: "compact", case: "height", surface: "glass", words: "since", storyNote: true}],
    ["r3-long-card", "第 3 轮：长文字原处展开，同一张卡", {variant: "compact", case: "personality", surface: "glass", words: "since", longCard: true}],
    ["r3-long-card-note", "第 3 轮：长文字原处展开，选剧情里变了", {variant: "compact", case: "personality", surface: "glass", words: "since", longCard: true, storyNote: true}],
];

export const fixtures = [
    defineLabFixture<typeof EntryPageDraft>({
        component: "EntryPageDraft",
        scenes: SCENES.map(([id, label, props]) => ({id, label, input: {props: {...props}}})),
        load: async () => (await import("./EntryPageDraftFixture.vue")).default as never,
    }),
    defineLabFixture<typeof ViewPointDraft>({
        component: "ViewPointDraft",
        scenes: VIEW_POINT_SCENES.map(([id, label, props]) => ({id, label, input: {props: {...props}}})),
        load: async () => (await import("./ViewPointDraftFixture.vue")).default as never,
    }),
    defineLabFixture<typeof InPlaceEditDraft>({
        component: "InPlaceEditDraft",
        scenes: IN_PLACE_SCENES.map(([id, label, props]) => ({id, label, input: {props: {...props}}})),
        load: async () => (await import("./InPlaceEditDraftFixture.vue")).default as never,
    }),
];
