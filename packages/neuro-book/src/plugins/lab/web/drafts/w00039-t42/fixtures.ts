/** w00039 t42（条目页的页头、分页与保存提示）第 1 轮的静态稿；评审板在那个 Task 的 artifacts/review。 */
import {defineLabFixture} from "../../fixtures/define";
import type EntryPageDraft from "./EntryPageDraft.vue";

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

export const fixtures = [
    defineLabFixture<typeof EntryPageDraft>({
        component: "EntryPageDraft",
        scenes: SCENES.map(([id, label, props]) => ({id, label, input: {props: {...props}}})),
        load: async () => (await import("./EntryPageDraftFixture.vue")).default as never,
    }),
];
