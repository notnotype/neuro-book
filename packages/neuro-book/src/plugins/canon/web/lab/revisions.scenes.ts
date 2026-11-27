import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type RevertDialog from "nbook/plugins/canon/web/components/revisions/RevertDialog.vue";
import type ReceiptPage from "nbook/plugins/canon/web/components/revisions/ReceiptPage.vue";
import type RevisionsView from "nbook/plugins/canon/web/components/revisions/RevisionsView.vue";
import type PendingView from "nbook/plugins/canon/web/components/revisions/PendingView.vue";
import type PendingDetail from "nbook/plugins/canon/web/components/revisions/PendingDetail.vue";
import type BreakExclusiveDialog from "nbook/plugins/canon/web/components/revisions/BreakExclusiveDialog.vue";
import type ChangePage from "nbook/plugins/canon/web/components/revisions/ChangePage.vue";

/** 修订、待处理与回执的组件（docs/specs/canon/author-ui.md）：场景用星瑕样本里的样子手写。 */
function revisionsFixtures() {
    const row = (path: string, label: string, display: string, extra: Record<string, unknown> = {}) => ({path, label, display, unknown: false, incomplete: false, mark: null as string | null, ...extra});
    const chapters = [{chapter: "1", index: 1, title: "雨夜的来客", start: "1:start", end: "1:end"}, {chapter: "2", index: 2, title: null, start: "2:start", end: "2:end"}];
    return [
        defineLabFixture<typeof RevertDialog>({
            component: "RevertDialog",
            scenes: [
                {id: "ready", label: "没有依赖：写带来的变化", input: {props: {title: "改外观", phase: "ready" as const, impact: ["星瑕的外观：银发 → 黑发", "少了 1 条待处理"]}, model: {open: true}}},
                {id: "dependents", label: "有依赖：列出后面依赖它的改动", input: {props: {title: "领了打工的工资", phase: "dependents" as const, dependents: ["改第 2 章“领了打工的工资”那一笔", "记了一笔：买了书", null], moreDependents: 4}, model: {open: true}}},
                {id: "previewing", label: "正在预览", input: {props: {title: "改外观", phase: "previewing" as const}, model: {open: true}}},
                {id: "not-revertable", label: "章序调整不能还原", input: {props: {title: "调整章序", phase: "blocked" as const, reason: "调整章序的改动不能还原"}, model: {open: true}}},
                {id: "busy", label: "别人正在写", input: {props: {title: "改外观", phase: "ready" as const, impact: ["别的都不变"], reason: "第 3 章记账正在写，写完以后才能改"}, model: {open: true}}},
                {id: "unknown", label: "不确定有没有还原", input: {props: {title: "改外观", phase: "ready" as const, impact: ["星瑕的外观：银发 → 黑发"], error: "不确定这次改动有没有写进去", recheck: true}, model: {open: true}}},
                {id: "saving", label: "还原中", input: {props: {title: "改外观", phase: "ready" as const, impact: ["星瑕的外观：银发 → 黑发"], saving: true}, model: {open: true}}},
                {id: "ready-english", label: "英文界面", input: {props: {title: "Edit Appearance", phase: "ready" as const, impact: ["Xingxia's Appearance: silver → black"]}, model: {open: true}}},
            ],
            load: async () => (await import("./RevertDialogFixture.vue")).default,
        }),
        defineLabFixture<typeof ReceiptPage>({
            component: "ReceiptPage",
            scenes: (() => {
                const model = {
                    title: "改存款",
                    by: "作者",
                    time: "2026-11-11 14:03",
                    what: "改设定",
                    sections: [
                        {kind: "modify" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "xingxia"}, name: "星瑕", fields: [{label: "存款", before: "500 元", after: "800 元"}, {label: "外观", before: "黑发，左眼下有颗痣", after: "银发，左眼下有颗痣"}]}]},
                    ],
                    impact: ["少了 1 条待处理", "星瑕的魔力：2,700 → 3,000"],
                    reverts: [],
                };
                const created = {
                    ...model,
                    title: "新建“魔杖”",
                    sections: [{kind: "create" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "wand"}, name: "魔杖", fields: []}]}],
                    impact: ["别的都不变"],
                };
                const reverted = {
                    ...model,
                    title: "还原“改存款”",
                    what: "还原",
                    sections: [{kind: "modify" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "xingxia"}, name: "星瑕", fields: [{label: "存款", before: "800 元", after: "500 元"}]}]}, {kind: "delete" as const, items: [{key: "2", ref: null, name: "被扒手偷了", fields: []}]}],
                    reverts: ["r1"],
                };
                const reorder = {...model, title: "调整章序", what: "调整章序", sections: [{kind: "chapters" as const, items: [{key: "1", ref: null, name: "", fields: [{label: "章序", before: "第 1 章：入学、第 2 章：打工", after: "第 2 章：打工、第 1 章：入学"}]}]}], impact: ["别的都不变"]};
                return [
                    {id: "edit", label: "改了两个字段", input: {props: {status: "normal" as const, model}}},
                    {id: "dependents", label: "后面有改动依赖它", input: {props: {status: "normal" as const, model, dependents: 2}}},
                    {id: "created", label: "新建一个条目", input: {props: {status: "normal" as const, model: created}}},
                    {id: "reverted", label: "一次还原：还原的是哪一次", input: {props: {status: "normal" as const, model: reverted, reverted: [{id: "r1", title: "改存款"}]}}},
                    {id: "reorder", label: "章序调整不能还原", input: {props: {status: "normal" as const, model: reorder, revertBlocked: "调整章序的改动不能还原"}}},
                    {id: "loading", label: "读取中", input: {props: {status: "loading" as const}}},
                    {id: "missing", label: "找不到", input: {props: {status: "missing" as const}}},
                    {id: "edit-english", label: "英文界面", input: {props: {status: "normal" as const, model: {...model, title: "Edit Savings", by: "Author", what: "Setting change", sections: [{kind: "modify" as const, items: [{key: "1", ref: {kind: "entry" as const, id: "xingxia"}, name: "Xingxia", fields: [{label: "Savings", before: "500", after: "800"}]}]}], impact: ["Nothing else changes"]}}}},
                ];
            })(),
            load: async () => (await import("./ReceiptPageFixture.vue")).default,
        }),
        defineLabFixture<typeof RevisionsView>({
            component: "RevisionsView",
            scenes: (() => {
                const row = (id: string, title: string, meta: string, summary: string, extra: {notRevertable?: boolean; note?: string} = {}) => ({id, title, meta, summary, notRevertable: extra.notRevertable ?? false, note: extra.note ?? ""});
                const rows = [
                    row("r7", "改存款", "作者 · 2026-11-13 14:12", "2 处值变了，少了 1 条待处理"),
                    row("r6", "第 3 章记账", "任务：第 3 章记账 · 2026-11-13 14:08", "4 处值变了，多了 1 条待处理"),
                    row("r5", "还原“改外观”", "作者 · 2026-11-13 14:05", "1 处值变了"),
                    row("r4", "改外观", "作者 · 2026-11-13 14:03", "1 处值变了", {note: "后面有 1 次改动依赖它"}),
                    row("r3", "补上星瑕领工资的那一笔", "Agent · 2026-11-13 13:58", "1 处值变了，1 条情节套不上了"),
                    row("r2", "新建“星瑕”", "作者 · 2026-11-13 13:50", "没有带来别的变化", {note: "后面有 4 次改动依赖它"}),
                    row("r1", "章序调整", "系统 · 2026-11-13 13:49", "没有带来别的变化", {notRevertable: true, note: "调整章序的改动不能还原"}),
                ];
                const chapters = [{value: "all", label: "全部章"}, {value: "1", label: "第 1 章：入学"}, {value: "2", label: "第 2 章：打工"}, {value: "3", label: "第 3 章"}];
                const writers = [{value: "all", label: "全部写入者"}, {value: "author", label: "作者"}, {value: "agent", label: "Agent"}, {value: "task", label: "任务"}, {value: "system", label: "系统"}];
                const model = {chapter: "all", writer: "all"};
                const sample = {props: {status: "normal" as const, rows, more: true, chapters, writers}, model};
                const busy = "第 3 章记账正在写，写完以后才能改";
                const readOnly = "世界只读：日志的版本号重复了";
                return [
                    {id: "sample", label: "七次修订：有依赖的、章序调整、还有更多", input: sample},
                    {id: "long-title", label: "很长的标题", input: {props: {...sample.props, more: false, rows: [row("r9", "把第 3 章到第 9 章里所有提到星瑕存款的地方按新的工资标准重新记一遍账", "Agent · 2026-11-13 15:01", "12 处值变了，少了 3 条待处理，2 条情节套不上了"), ...rows.slice(0, 2)]}, model}},
                    {id: "busy", label: "别人正在独占写", input: {props: {...sample.props, revertBlocked: busy}, model}},
                    {id: "read-only", label: "世界只读", input: {props: {...sample.props, revertBlocked: readOnly, readOnly}, model}},
                    {id: "loading", label: "读取中", input: {props: {status: "loading" as const, rows: [], chapters, writers}, model}},
                    {id: "failed", label: "没有读出来", input: {props: {status: "failed" as const, rows: [], chapters, writers}, model}},
                    {id: "empty", label: "还没有改动", input: {props: {status: "normal" as const, rows: [], chapters, writers}, model}},
                    {id: "sample-english", label: "英文界面", input: {props: {...sample.props, more: false, chapters: [{value: "all", label: "All chapters"}], writers: [{value: "all", label: "All writers"}], rows: [row("e2", "Edit Savings", "Author · 2026-11-13 14:12", "2 values changed, 1 fewer pending"), row("e1", "Chapter reorder", "System · 2026-11-13 13:49", "Nothing else changed", {notRevertable: true, note: "Chapter reorders cannot be reverted"})]}, model}},
                ];
            })(),
            load: async () => (await import("./RevisionsViewFixture.vue")).default,
        }),
        ...(() => {
            const rows = (items: readonly [string, string, string][]) => items.map(([key, text, place]) => ({key, text, place}));
            const group = (items: readonly [string, string, string][], extra: {count?: number | null; loading?: boolean; more?: boolean} = {}) => ({rows: rows(items), count: extra.count === undefined ? items.length : extra.count, loading: extra.loading ?? false, more: extra.more ?? false});
            const groups = {
                pending: group([
                    ["check", "星瑕的存款对不上：正文写 2,700，算出来是 24,500", "第 2 章"],
                    ["held", "“订了星瑾小时候最喜欢的那家店”待定", "第 2 章"],
                    ["chain", "传话链断了", "第 3 章第 4 段"],
                ]),
                hints: group([["dup", "“领了工资”的原句在这一章出现了 2 次", "第 1 章"]]),
                handled: group([], {count: 2}),
            };
            const detail = {
                title: "星瑕的存款对不上：正文写 2,700，算出来是 24,500",
                place: "第 2 章",
                quote: {text: "她看了一眼余额：2700。", chapter: "2"},
                facts: [{label: "正文写的数", value: "2,700"}, {label: "算出来的数", value: "24,500"}],
                suspects: [
                    {key: "c3", text: "工资到账，三千左右", place: "第 2 章", estimate: true, target: {kind: "change" as const, id: "c3"}, initial: false},
                    {key: "c2", text: "订了星瑾小时候最喜欢的那家店", place: "第 2 章", estimate: false, target: {kind: "change" as const, id: "c2"}, initial: false},
                    {key: "init", text: "初值", place: "", estimate: false, target: {kind: "entry" as const, id: "xingxia"}, initial: true},
                ],
                links: [{label: "打开条目", target: {kind: "entry" as const, id: "xingxia"}}],
            };
            const held = {title: "“订了星瑾小时候最喜欢的那家店”待定", place: "第 2 章", quote: {text: "她订了那家店。", chapter: "2"}, facts: [{label: "原因", value: "与设定冲突：存款不够"}], suspects: [], links: [{label: "打开这条情节", target: {kind: "change" as const, id: "c2"}}]};
            const handled = {title: "传话链断了", place: "第 3 章第 4 段", quote: null, facts: [{label: "作者当时的决定", value: "有意为之：她是故意不传话的"}], suspects: [], links: [{label: "星瑕", target: {kind: "entry" as const, id: "xingxia"}}, {label: "“她没把话带到”", target: {kind: "change" as const, id: "c5"}}]};
            const sample = {props: {groups, selected: {group: "pending" as const, key: "check"}, detail}, model: {expanded: ["pending" as const]}};
            return [
                defineLabFixture<typeof PendingView>({
                    component: "PendingView",
                    scenes: [
                        {id: "sample", label: "核对点不符：详情有原句、两个数与嫌疑", input: sample},
                        {id: "busy", label: "别人正在独占写入、结果不完整", input: {props: {...sample.props, holder: "第 3 章记账", notes: ["这些检查没有算出来：传话链断了", "这些检查所在的插件停用了，没有算：插件的一项检查"]}, model: sample.model}},
                        {id: "more-and-hints", label: "一组没列完、“只是提示”展开有项", input: {props: {...sample.props, groups: {...groups, pending: {...groups.pending, more: true}}}, model: {expanded: ["pending" as const, "hints" as const]}}},
                        {id: "loading", label: "读取中", input: {props: {groups: {pending: group([], {count: null, loading: true}), hints: group([], {count: null}), handled: group([], {count: null})}}, model: sample.model}},
                        {id: "empty", label: "没有待处理的问题", input: {props: {groups: {pending: group([]), hints: group([]), handled: group([])}}, model: sample.model}},
                        {id: "sample-english", label: "英文界面", input: {props: {groups: {pending: group([["check", "Xingxia's Savings does not match: the text says 2,700, computed 24,500", "Chapter 2"]]), hints: group([]), handled: group([])}, selected: {group: "pending" as const, key: "check"}, detail: {...detail, title: "Xingxia's Savings does not match: the text says 2,700, computed 24,500", place: "Chapter 2", facts: [{label: "In the text", value: "2,700"}, {label: "Computed", value: "24,500"}], suspects: [{...detail.suspects[0]!, text: "Salary arrived, about three thousand", place: "Chapter 2"}], links: [{label: "Open entry", target: {kind: "entry" as const, id: "xingxia"}}]}}, model: sample.model}},
                    ],
                    load: async () => (await import("./PendingViewFixture.vue")).default,
                }),
                defineLabFixture<typeof PendingDetail>({
                    component: "PendingDetail",
                    scenes: [
                        {id: "check-mismatch", label: "核对点不符", input: {props: {detail}}},
                        {id: "handled", label: "已处理的插件发现", input: {props: {detail: handled}}},
                        {id: "long-text", label: "很长的原句与链接", input: {props: {detail: {
                            title: "“她在第三章末尾把这些年攒下的钱全部取出来交给了哥哥让他去还清赌债”套不上了",
                            place: "第 3 章",
                            quote: {text: "她把卡里的钱一笔一笔转给哥哥，转到最后余额只剩下一个零头，她盯着那个零头看了很久很久，才想起来今天还没吃饭。", chapter: "3"},
                            facts: [{label: "原因", value: "改完的数超出了范围"}, {label: "让它套不上的那次改动", value: "“把第 3 章到第 9 章里所有提到星瑕存款的地方按新的工资标准重新记一遍账”"}],
                            suspects: [],
                            links: [{label: "打开这条情节", target: {kind: "change" as const, id: "c9"}}, {label: "“她在第三章末尾把这些年攒下的钱全部取出来交给了哥哥让他去还清赌债”", target: {kind: "change" as const, id: "c8"}}, {label: "看那次改动的回执", target: {kind: "receipt" as const, id: "r7"}}],
                        }}}},
                    ],
                    load: async () => (await import("./PendingDetailFixture.vue")).default,
                }),
                defineLabFixture<typeof BreakExclusiveDialog>({
                    component: "BreakExclusiveDialog",
                    scenes: [
                        {id: "confirm", label: "二次确认", input: {props: {holder: "第 3 章记账"}, model: {open: true}}},
                        {id: "saving", label: "解除中", input: {props: {holder: "第 3 章记账", saving: true}, model: {open: true}}},
                        {id: "failed", label: "没有解除", input: {props: {holder: "第 3 章记账", error: "世界已断开"}, model: {open: true}}},
                    ],
                    load: async () => (await import("./BreakExclusiveDialogFixture.vue")).default,
                }),
            ];
        })(),
        defineLabFixture<typeof ChangePage>({
            component: "ChangePage",
            scenes: (() => {
                const model = {
                    text: "被扒手偷了",
                    place: "第 3 章",
                    kind: "已写",
                    status: "active" as const,
                    statusText: "生效",
                    heldReason: "",
                    undoneReason: "",
                    quotes: [{key: "t1", quote: "她摸了摸口袋，钱包不见了", source: "第 3 章正文", chapter: "3"}, {key: "t2", quote: "被偷了大概三百", source: "细纲", chapter: null}],
                    involved: [{id: "xingxia", name: "星瑕"}, {id: "pickpocket", name: "扒手"}],
                    patches: [
                        {index: 0, line: "星瑕的存款 −300", basis: {text: "估计：大概三百", estimate: true}, editable: true, label: "星瑕的存款"},
                        {index: 1, line: "星瑕的样子 → 狼狈", editable: false, label: "星瑕的样子"},
                    ],
                };
                const held = {...model, status: "held" as const, statusText: "待定", heldReason: "待定：与设定冲突。第 2 章末尾的存款是 2,700，扣 300 以后和第 3 章正文写的 2,800 对不上"};
                return [
                    {id: "active", label: "生效的一条：原句、涉及的条目、改动", input: {props: {status: "normal" as const, model}}},
                    {id: "active-editing", label: "改那一笔：确认条在顶上", input: {props: {status: "normal" as const, model}}},
                    {id: "held", label: "待定：写原因与“改成生效”", input: {props: {status: "normal" as const, model: held}}},
                    {id: "activating", label: "改成生效：预览", input: {props: {status: "normal" as const, model: held, activation: {preview: ["少了 1 条待处理", "星瑕的存款：2,700 → 2,400"], previewing: false, error: "", recheck: false, saving: false, locked: false}}}},
                    {id: "activation-invalid", label: "改成生效：校验不过", input: {props: {status: "normal" as const, model: held, activation: {preview: null, previewing: false, error: "没有通过检查：quote does not contain 300", recheck: false, saving: false, locked: true}}}},
                    {id: "blocked", label: "写不了：“改”不可用，章节文件没找到", input: {props: {status: "normal" as const, model, blocked: "第 3 章记账正在写，写完以后才能改", chapterMissing: "3"}}},
                    {id: "missing", label: "找不到", input: {props: {status: "missing" as const}}},
                    {id: "active-english", label: "英文界面", input: {props: {status: "normal" as const, model: {...model, text: "Pickpocketed", place: "Chapter 3", kind: "written", statusText: "in effect", quotes: [{key: "t1", quote: "Her wallet was gone", source: "Chapter 3 text", chapter: "3"}], involved: [{id: "xingxia", name: "Xingxia"}], patches: [{index: 0, line: "Xingxia's Savings −300", basis: {text: "estimate: about 300", estimate: true}, editable: true, label: "Xingxia's Savings"}]}}}},
                ];
            })(),
            load: async () => (await import("./ChangePageFixture.vue")).default,
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...revisionsFixtures(),
];
