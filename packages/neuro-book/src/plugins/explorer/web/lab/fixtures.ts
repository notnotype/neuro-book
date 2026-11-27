import {createSubjectFixture, defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type ExplorerRow from "nbook/plugins/explorer/web/components/ExplorerRow.vue";
import {EXPLORER_ROWS, manyRows, UNBOUND_ROWS} from "./explorer-rows";
import {withExplorerText} from "./explorer-text";
import type ExplorerTree from "nbook/plugins/explorer/web/components/ExplorerTree.vue";
import type ExplorerFeedback from "nbook/plugins/explorer/web/components/ExplorerFeedback.vue";
import type FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof ExplorerRow>({
        component: "ExplorerRow",
        scenes: (() => {
            const scene = (id: string, label: string, index: number, extra: {selected?: boolean; active?: boolean; edit?: {name: string; error: string | null; busy: boolean}; hideMarkdownExtension?: boolean} = {}) => ({id, label, input: {props: {row: EXPLORER_ROWS[index] as (typeof EXPLORER_ROWS)[number], domId: `lab-row-${id}`, selected: extra.selected ?? false, active: extra.active ?? false, height: 26, edit: extra.edit ?? null, hideMarkdownExtension: extra.hideMarkdownExtension ?? false}}});
            return [
                scene("node", "内容节点：展示名与真实名字", 3),
                scene("selected", "选中并有焦点框", 3, {selected: true, active: true}),
                scene("no-body", "无正文的节点", 2),
                scene("leaf", "只有正文的节点：没有展开控件", 5),
                scene("missing", "缺失条目", 6),
                scene("unlisted", "未列入项", 7),
                scene("binder", "活页夹：需要剧情插件", 10),
                scene("content-folder", "内容文件夹：去掉后缀", 1),
                scene("manifest-error", "清单不合法", 8),
                scene("loading", "列出中", 11),
                scene("error", "读取失败", 12),
                scene("hide-md", "隐藏 Markdown 扩展名", 14, {hideMarkdownExtension: true}),
                scene("root", "根：分节标题", 0),
                scene("rename", "改名：名字冲突的提示", 3, {selected: true, edit: {name: "alice", error: "已存在同名项", busy: false}}),
            ];
        })(),
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerRow>((await import("nbook/plugins/explorer/web/components/ExplorerRow.vue")).default, {events: ["press", "activate", "context", "retry"], class: "w-full"})),
    }),
    defineLabFixture<typeof ExplorerTree>({
        component: "ExplorerTree",
        scenes: [
            {id: "kinds", label: "三类文件夹与行上的状态", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/bob"], focus: "project://lore.content/bob", label: "文件"}}},
            {id: "guides", label: "缩进参考线一直显示、焦点那一层加深", input: {props: {rows: EXPLORER_ROWS, selected: ["project://lore.content/carol"], focus: "project://lore.content/carol", label: "文件", indentGuides: "always"}}},
            {id: "many", label: "五百行：虚拟滚动与长名字", input: {props: {rows: manyRows(500), selected: [], focus: null, label: "文件"}}},
            {id: "english", label: "英文界面", input: {props: {rows: EXPLORER_ROWS, selected: [], focus: null, label: "Files"}}},
        ],
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerTree>((await import("nbook/plugins/explorer/web/components/ExplorerTree.vue")).default, {
            events: ["row-press", "row-activate", "row-context", "retry", "focus-change"],
            class: "h-full w-full",
            runtimeProps: {handleKey: () => "none" as const},
        })),
    }),
    defineLabFixture<typeof ExplorerFeedback>({
        component: "ExplorerFeedback",
        scenes: [
            {id: "editor-missing", label: "编辑器尚未接入", input: {props: {notice: {kind: "editor-missing", address: "project://lore.content/bob/index.md"}}}},
            {id: "open-failed", label: "打开失败、长路径", input: {props: {notice: {kind: "open-failed", address: "project://一个非常深的目录/再深一层/还有一层/第一百二十三章 一个相当长的章节标题.md", reason: "not-text：文件含 NUL，不是文本"}}}},
            {id: "none", label: "没有提示", input: {props: {notice: null}}},
        ],
        load: async () => withExplorerText(createSubjectFixture<typeof ExplorerFeedback>((await import("nbook/plugins/explorer/web/components/ExplorerFeedback.vue")).default, {events: ["dismiss"], class: "w-full"})),
    }),
    defineLabFixture<typeof FilesExplorerView>({
        component: "FilesExplorerView",
        scenes: (() => {
            const base = {rows: EXPLORER_ROWS, selected: [], focus: null, ready: true, notice: null, problem: null};
            return [
                // 集成场景：真实的视图宿主、控制器与命令，文件换成内存适配器；输入只是占位，场景不读它。
                {id: "live", label: "内存数据：真实控制器与命令", input: {props: base}},
                {id: "default", label: "浏览", input: {props: base}},
                {id: "unbound", label: "未打开项目、用户资产停止同步", input: {props: {...base, rows: UNBOUND_ROWS}}},
                {id: "unsaved", label: "偏好未保存、编辑器尚未接入", input: {props: {...base, problem: {kind: "unsaved" as const, code: "conflict"}, notice: {kind: "editor-missing" as const, address: "project://plain/a.md"}}}},
                {id: "loading", label: "偏好还在读取", input: {props: {...base, ready: false}}},
                {id: "delete", label: "删除确认：多项与长路径", input: {props: {...base, dialog: {kind: "delete" as const, items: Array.from({length: 12}, (_, index) => ({address: `project://一个很深的目录/第${String(index + 1)}章 一个相当长的章节标题.md`, token: `t${String(index)}`})), busy: false, unsaved: ["project://一个很深的目录/第1章 一个相当长的章节标题.md"]}}}},
                {id: "dirty-copy", label: "复制有未保存修改的文件", input: {props: {...base, dialog: {kind: "dirty-copy" as const, documents: ["project://chapters/第一章.md", "project://chapters/第二章.md"], saveable: true}}}},
                {id: "report", label: "删除部分失败、进行中", input: {props: {...base, running: {action: "delete" as const, count: 3}, report: {action: "delete" as const, items: [
                    {address: "project://plain", target: null, result: {status: "failed" as const, code: "permission-denied", detail: "没有权限", partial: {removed: {paths: ["plain/a.md", "plain/b.md"], truncated: false}}}},
                    {address: "project://a.md", target: null, result: {status: "done" as const}},
                    {address: "project://b.md", target: null, result: {status: "not-run" as const, reason: "stopped" as const}},
                ], manifests: [{path: "lore.content/content.xml", status: "failed" as const, detail: "写不进去"}], truncated: false}}}},
                {id: "collision", label: "粘贴碰撞：长路径与名字不能用", input: {props: {...base, dialog: {kind: "collision" as const, action: "copy" as const, source: "project://一个很深的目录/再深一层/第一百二十三章 一个相当长的章节标题.md", target: "project://另一个目录/第一百二十三章 一个相当长的章节标题.md", candidate: "第一百二十三章 一个相当长的章节标题 (2).md", error: {code: "conflict" as const}, busy: false as const}}}},
                {id: "unknown", label: "结果未知、剪切中、移动部分失败", input: {props: {
                    ...base,
                    rows: EXPLORER_ROWS.map((row) => (row.kind === "entry" && row.id === "project://lore.content/stray.md" ? {...row, cut: true} : row)),
                    unknown: {action: "move" as const, clipboard: 1, items: [{address: "project://plain/a.md", target: "project://lore.content/a.md"}, {address: "project://plain/z.md", target: "project://lore.content/z.md"}]},
                    report: {action: "move" as const, manifests: [], truncated: false, items: [
                        {address: "project://plain/a.md", target: "project://plain/sub/a.md", result: {status: "done" as const}},
                        {address: "project://plain/z.md", target: "project://plain/sub/z.md", result: {status: "failed" as const, code: "conflict", detail: "目标已存在"}},
                        {address: "project://plain/y.md", target: "project://plain/sub/y.md", result: {status: "declined" as const, reason: "skip" as const}},
                    ]},
                }}},
            ];
        })(),
        load: async () => (await import("./FilesExplorerViewFixture.vue")).default,
    }),
];
