/** w00055 t01（条目主文字的标签写法与富文本）的 spike；评审板在那个 Task 的 artifacts/review。 */
import {defineLabFixture} from "../../fixtures/define";
import type EntryRichDraft from "./EntryRichDraft.vue";

type Props = {readonly mode?: "rich" | "source"; readonly showBranches?: boolean; readonly source?: string};

const BROKEN = "## 现在\n\n魔力 <V of=\"panel.魔力\">，还能回溯 <V of=\"panel.回溯\" /> 次。\n";
const EMPTY_BRANCH = "## 回溯\n\n今天还能回溯 <V of=\"panel.回溯\" /> 次。<If test=\"panel.回溯 == 0\">今天不能再回溯了。</If>\n\n<V of=\"character.背景\" />\n";

const SCENES: ReadonlyArray<readonly [string, string, Props]> = [
    ["rich", "富文本：只画生效的一支", {mode: "rich"}],
    ["rich-branches", "富文本：显示全部分支", {showBranches: true}],
    ["source", "源文字", {mode: "source"}],
    ["source-broken", "源文字：标签写坏了（切回富文本被拦下）", {mode: "source", source: BROKEN}],
    ["rich-empty-branch", "富文本：条件不成立、字段没了", {source: EMPTY_BRANCH}],
];

export const fixtures = [
    defineLabFixture<typeof EntryRichDraft>({
        component: "EntryRichDraft",
        scenes: SCENES.map(([id, label, props]) => ({id, label, input: {props: {...props}}})),
        load: async () => (await import("./EntryRichDraftFixture.vue")).default as never,
    }),
];
