/**
 * w00055 t04（条目页打磨）第 1 轮静态稿：条目页页头的三种排法与文字分页的空态（`EntryHeadDraft`），新建条目对话框改版
 * （`NewEntryDraftDialog`）。评审板在那个 Task 的 artifacts/review。
 */
import {defineLabFixture} from "../../fixtures/define";
import type EntryHeadDraft from "./EntryHeadDraft.vue";
import type NewEntryDraftDialog from "./NewEntryDraftDialog.vue";

type HeadProps = InstanceType<typeof EntryHeadDraft>["$props"];
const LAYOUTS = [["current", "现在"], ["columns", "两栏"], ["compact", "压成两行"]] as const;
const ENTRIES = [["plain", "刚新建的普通条目"], ["person", "刚新建的人物"], ["filled", "填好的人物"]] as const;

const headScenes = LAYOUTS.flatMap(([layout, layoutLabel]) =>
    ENTRIES.flatMap(([entry, entryLabel]) => [
        {id: `${layout}-${entry}`, label: `${layoutLabel}：${entryLabel}`, input: {props: {layout, entry} satisfies HeadProps}},
        {id: `${layout}-${entry}-rail`, label: `${layoutLabel}：${entryLabel}（宽，竖排分页）`, input: {props: {layout, entry, rail: true} satisfies HeadProps}},
    ]),
);

export const fixtures = [
    defineLabFixture<typeof EntryHeadDraft>({
        component: "EntryHeadDraft",
        scenes: [
            ...headScenes,
            {id: "columns-filled-avatar", label: "两栏：填好的人物，立绘做头像", input: {props: {layout: "columns", entry: "filled", avatar: true}}},
            {id: "columns-filled-avatar-rail", label: "两栏：填好的人物，立绘做头像（宽）", input: {props: {layout: "columns", entry: "filled", avatar: true, rail: true}}},
            {id: "text-empty-button", label: "文字分页的空态：现在（一句话加“开始写”）", input: {props: {layout: "columns", entry: "plain", textEmpty: "button"}}},
            {id: "text-empty-line", label: "文字分页的空态：一行淡的占位", input: {props: {layout: "columns", entry: "plain", textEmpty: "line"}}},
        ],
        load: async () => (await import("./EntryHeadDraftFixture.vue")).default as never,
    }),
    defineLabFixture<typeof NewEntryDraftDialog>({
        component: "NewEntryDraftDialog",
        scenes: [
            {id: "plain", label: "从“新建条目”打开", input: {props: {start: "plain"}}},
            {id: "person", label: "从“新建人物”打开、填了名字", input: {props: {start: "person", name: "星瑾"}}},
            {id: "groups-open", label: "展开设定组", input: {props: {start: "person", name: "星瑾", groupsOpen: true}}},
            {id: "groups-customized", label: "动过勾选：恢复默认", input: {props: {start: "person", name: "星瑾", groupsOpen: true, customized: true}}},
            {id: "place-open", label: "展开位置与出场", input: {props: {start: "person", name: "星瑾", placeOpen: true}}},
            {id: "place-same-as", label: "选了本体：上级跟着本体", input: {props: {start: "person", name: "哥哥", placeOpen: true, sameAs: true}}},
            {id: "under-selected", label: "在设定树选中的条目上新建：上级预先填好", input: {props: {start: "plain", name: "学生会", underSelected: true, placeOpen: true}}},
        ],
        load: async () => (await import("./NewEntryDraftDialogFixture.vue")).default as never,
    }),
];
