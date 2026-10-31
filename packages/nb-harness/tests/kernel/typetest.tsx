/**
 * 定稿类型的类型检查（`bun run typecheck` 检查；文件名不是 `*.test.*`，`bun test` 不跑它）。
 * 每处 `@ts-expect-error` 要求下一行是编译错误，没有错误时 tsc 报“未使用的指令”；没有标注的写法必须能通过。
 * 1–29 搬自第五稿的 `spike/v5/typetest.ts`，30 起是定稿新增的；每片新增的写错补在末尾，编号只追加。
 *
 * helper 还没有实现的，先用它们在 `api/helpers.ts` 里的签名声明；实现之后改为从公开入口导入。
 */

import {Type} from "typebox";
import {conv, defineContract, defineExtension, defineProfile, ext, implement, shape, slice} from "@notnotype/nb-harness/kernel/contracts";
import type {DeriveProfile, FinalOnlyHelper, ToolCall, WithoutEventsHelper} from "@notnotype/nb-harness/kernel/contracts";
import {opening, reminder, standardLayout} from "@notnotype/nb-harness/kernel";
import {Slot, System, Turn, User} from "@notnotype/nb-harness/prompt";

declare const finalOnly: FinalOnlyHelper;
declare const withoutEvents: WithoutEventsHelper;
declare const deriveProfile: DeriveProfile;

// ---------- 例子里的契约（第五稿 plugins.ts） ----------

const historyContract = defineContract("nbook.history", {
    events: {fileChanged: ext.session<{uri: string; by: string}>(), notice: conv<{text: string; through: number}>()},
    exports: shape<{pendingChanges: string[]}>(),
});
const modeContract = defineContract("nbook.agent.mode", {exports: shape<{mode: "normal" | "plan"}>()});
const tasksContract = defineContract("nbook.tasks", {exports: shape<{open: string[]}>()});
const modeReminder = reminder({
    id: "nbook.agent.mode.reminder",
    dependsOn: [modeContract],
    watch: ({read}) => read(modeContract).mode,
    text: ({value, first}) => (value === "plan" ? "现在是计划模式。" : first ? null : "已退出计划模式。"),
});
const leader = defineProfile({id: "builtin.leader", version: "1", name: "主创", description: "默认协作与统筹", dependsOn: [historyContract, modeReminder]});

// ---------- 1–29 ----------

export const bad = defineExtension({
    id: "lab.bad",
    dependsOn: [historyContract],
    settings: Type.Object({level: Type.Union([Type.Literal("low"), Type.Literal("high")], {default: "low"})}),
    state: {seen: slice.session(0), told: slice.path(false), items: slice.path<string[]>([])},
    events: {card: conv<{name: string}>(), marker: ext()},
    reduce: {
        // @ts-expect-error 1. path 事件改不到 session 的片
        input: () => ({seen: 1}),
        // @ts-expect-error 2. 片的值类型不对
        card: () => ({told: "yes"}),
    },
    on: {
        input(event, ctx) {
            // @ts-expect-error 3. 内核事件的字段拼错
            void event.data.txt;
            // @ts-expect-error 4. 自己的事件名拼错
            ctx.emit("crad", {name: "x"});
            // @ts-expect-error 5. 自己的事件 data 形状不对
            ctx.emit("card", {name: 1});
            // @ts-expect-error 6. 没写进 dependsOn 的读不了
            void ctx.read(modeContract);
            // @ts-expect-error 7. 别人导出的字段拼错
            void ctx.read(historyContract).pendingChange;
            // @ts-expect-error 8. 设置的键拼错
            void ctx.settings.levle;
            // @ts-expect-error 9. 设置的值不在字面量里
            void (ctx.settings.level === "mid");
            // @ts-expect-error 10. continue 只在 assistant 的处理函数里有
            ctx.continue("接着写");
            // @ts-expect-error 11. 状态深只读
            ctx.state.items.push("x");
        },
        "nbook.history/fileChanged"(event) {
            // @ts-expect-error 12. 依赖的事件字段拼错
            void event.data.path;
        },
        // @ts-expect-error 13. 没有这种事件
        inptu() {},
    },
    contribute: {
        x: {value: (view) => {
            // @ts-expect-error 14. 视图里不能写
            view.set("told", true);
            return null;
        }},
    },
    render: {
        // @ts-expect-error 15. 扩展只能渲染自己的 conv 事件（marker 是 ext）
        marker: () => "x",
    },
});

export const kernelName = defineExtension({
    id: "lab.kernel-name",
    // @ts-expect-error 16. 自己的事件与内核事件同名
    events: {input: conv()},
});

// @ts-expect-error 17. 实现契约时少了导出
export const missingExports = implement(tasksContract, {});

export const badProfile = defineProfile({
    id: "lab.p",
    version: "1",
    name: "p",
    description: "p",
    initial: Type.Object({chapterId: Type.String()}),
    payload: Type.Object({selection: Type.String()}),
    state: {persona: slice.session("x")},
    on: {
        assistant(_event, ctx) {
            // @ts-expect-error 18. initial 的字段拼错
            void ctx.initial.chapterld;
            // @ts-expect-error 19. continue 的上限是数字
            ctx.continue("接着写", {max: "3"});
        },
    },
    // @ts-expect-error 20. 片名拼错
    system: ({state}) => state.persnoa,
    turn: (turn, format) => {
        // @ts-expect-error 21. payload 的字段拼错
        void turn.input?.data.payload.selectoin;
        return format.turn(turn);
    },
    render: {
        // @ts-expect-error 22. 回复与工具结果必须给出文字
        toolResult: () => null,
    },
});

export const withRenderBad = defineProfile({
    id: "lab.with-render",
    version: "1",
    name: "w",
    description: "w",
    // @ts-expect-error 23. 提交时换的文字也要遵守：工具结果必须给出文字
    commit: (turn, format) => format.withRender({toolResult: () => null}).turn(turn),
});

// @ts-expect-error 24. standardLayout 的选项拼错
export const badLayout = defineProfile({id: "lab.layout", version: "1", name: "l", description: "l", prompt: standardLayout({histroy: false})});

// @ts-expect-error 25. 派生必须给新 id
export const noId = deriveProfile(leader, {name: "另一个"});

export const reminderBad = reminder({
    id: "lab.reminder",
    dependsOn: [tasksContract],
    // @ts-expect-error 26. 提醒里读没写进 dependsOn 的扩展
    watch: ({read}) => read(modeContract).mode,
    text: () => null,
});

export const openingBad = opening({
    id: "lab.opening",
    initial: Type.Object({chapterId: Type.String()}),
    // @ts-expect-error 27. 开场里 initial 的字段拼错
    load: ({initial}) => [initial.chapterld],
});

export const commitBad = defineProfile({
    id: "lab.commit",
    version: "1",
    name: "c",
    description: "c",
    dependsOn: [modeReminder],
    render: {
        // 依赖的提醒能按类型覆盖
        "nbook.agent.mode.reminder/reminder": (event) => event.data.text,
    },
    // @ts-expect-error 28. 去掉的事件名拼错
    commit: (turn, format) => format.turn(withoutEvents(turn, modeReminder, "remindr")),
});

export const renderNoDep = defineProfile({
    id: "lab.render-no-dep",
    version: "1",
    name: "r",
    description: "r",
    render: {
        // @ts-expect-error 29. 没写进 dependsOn 的扩展的提醒不能覆盖
        "nbook.tasks.reminder/reminder": () => "x",
    },
});

// ---------- 30 起：定稿新增 ----------

export const commitReadsView = defineProfile({
    id: "lab.commit-view",
    version: "1",
    name: "v",
    description: "v",
    // @ts-expect-error 30. commit 是纯函数，拿不到视图
    commit: (turn, format, view) => (view ? format.turn(turn) : []),
});

// @ts-expect-error 31. reminder 要给 every 或 watch
export const reminderNoTrigger = reminder({id: "lab.reminder-none", text: () => "x"});

// @ts-expect-error 32. Profile 必须写 version
export const noVersion = defineProfile({id: "lab.no-version", name: "n", description: "n"});

export const callField = (call: ToolCall) => {
    // @ts-expect-error 33. 工具调用用工具 id 字段 tool，不叫 name
    void call.name;
    return call.tool;
};

// @ts-expect-error 34. <Slot> 必须给名字
export const slotNoName = <Slot />;

// @ts-expect-error 35. <Turn /> 没有属性
export const turnWithProps = <Turn last={2} />;

export const finalOnlyWrongCommit = defineProfile({
    id: "lab.final-only",
    version: "1",
    name: "f",
    description: "f",
    // @ts-expect-error 36. finalOnly 交回的是一轮，要再经 format.turn 渲染成消息
    commit: (turn) => finalOnly(turn),
});

// ---------- 必须能通过的写法 ----------

/** 契约没有导出时不必写 `exports: {}`。 */
export const noExports = implement(defineContract("lab.events-only", {events: {ping: ext()}}), {});

/** `mount` 能读初始输入；会话级事件改 session 的片。 */
export const mountReadsInitial = defineExtension({
    id: "lab.mount",
    dependsOn: [historyContract],
    state: {changes: slice.session<string[]>([]), told: slice.path(0)},
    reduce: {"nbook.history/fileChanged": (event, state) => ({changes: [...state.changes, event.data.uri]})},
    mount: (ctx) => {
        void ctx.initial;
        ctx.set("told", 1);
        return () => undefined;
    },
});

/** 模板：自闭合的 `<System />` 放 Profile 的 system；`<Slot drop>` 有意不要一个槽。 */
export const template = defineProfile({
    id: "lab.template",
    version: "1",
    name: "t",
    description: "t",
    system: "你是测试 Profile。",
    prompt: () => (
        <>
            <System />
            <User>
                <Slot name="opening" />
            </User>
            <Turn />
            <Slot name="word-count" drop />
        </>
    ),
    commit: (turn, format) => format.turn(finalOnly(turn)),
});
