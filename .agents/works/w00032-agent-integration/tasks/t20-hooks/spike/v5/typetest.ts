/** 第五版接口的类型检查：每处 @ts-expect-error 要求下一行是编译错误（没有错误时 tsc 报“未使用的指令”）。 */

import {Type} from "typebox";
import {conv, defineExtension, defineProfile, deriveProfile, ext, implement, slice} from "./api.ts";
import {historyContract, modeContract, tasksContract} from "./plugins.ts";
import {leader} from "./profiles.tsx";

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
export const missingExports = implement(tasksContract, {exports: {}});

export const badProfile = defineProfile({
    id: "lab.p",
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
    // @ts-expect-error 23. 提交时丢掉的事件名拼错
    commit: {omit: ["nbook.memory/retreived"]},
});

// @ts-expect-error 24. 整张模板与缺省布局的开关不能同时写
export const bothLayouts = defineProfile({id: "lab.both", name: "b", description: "b", layout: {history: false}, prompt: () => null});

// @ts-expect-error 25. 派生必须给新 id
export const noId = deriveProfile(leader, {name: "另一个"});

export const remindBad = defineExtension({
    id: "lab.remind-bad",
    // @ts-expect-error 26. remind 是保留事件名
    events: {remind: conv()},
});

export const remindEmit = defineExtension({
    id: "lab.remind-emit",
    events: {note: conv()},
    on: {
        input(_event, ctx) {
            // @ts-expect-error 27. 保留事件只有内核写
            ctx.emit("remind", {name: "x", text: "y"});
        },
    },
    // 自己的提醒能渲染，data 有类型
    render: {remind: (event) => `${event.data.name}: ${event.data.text}`},
});

export const remindProfile = defineProfile({
    id: "lab.remind-profile",
    name: "r",
    description: "r",
    dependsOn: [modeContract],
    render: {
        "nbook.agent.mode/remind": (event) => event.data.text,
        // @ts-expect-error 28. 依赖的提醒事件名拼错
        "nbook.agent.mode/remnd": () => "x",
    },
    // 提交进历史时丢掉模式提醒
    commit: {omit: ["nbook.agent.mode/remind"]},
});

export const remindNoDep = defineProfile({
    id: "lab.remind-no-dep",
    name: "r",
    description: "r",
    dependsOn: [modeContract],
    render: {
        // @ts-expect-error 29. 没写进 dependsOn 的扩展的提醒不能覆盖
        "nbook.tasks/remind": () => "x",
    },
});
