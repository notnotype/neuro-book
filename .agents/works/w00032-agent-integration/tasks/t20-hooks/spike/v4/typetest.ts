/** 第四稿接口的类型检查：每处 @ts-expect-error 要求下一行是编译错误。运行：tsc -p ../tsconfig.json */

import {conv, defineExtension, defineProfile, path, session} from "./api.ts";
import "./leader.default.tsx";

export const bad = defineExtension({
    id: "lab.bad",
    state: {n: path(0)},
    events: {card: conv<{name: string}>()},
    reduce: {
        // @ts-expect-error 1. 片是数字，归约返回了字符串
        n: {input: () => "1"},
    },
    on: {
        input(event, ctx) {
            // @ts-expect-error 2. 内核事件的字段拼错
            void event.data.txt;
            // @ts-expect-error 3. 自己的事件名拼错
            ctx.emit("crad", {name: "x"});
            // @ts-expect-error 4. 自己的事件 data 形状不对
            ctx.emit("card", {name: 1});
            // @ts-expect-error 5. 别的扩展没导出这个
            void ctx.read("nbook.history").pending;
        },
        "nbook.history/fileChanged"(event) {
            // @ts-expect-error 6. 别的扩展的事件字段拼错
            void event.data.path;
        },
        // @ts-expect-error 7. 没有这种事件
        inptu() {},
    },
});

export const badProfile = defineProfile({
    id: "lab.p",
    name: "p",
    tools: {required: []},
    settings: {defaults: {persona: "a"}},
    state: {persona: session("x")},
    on: {
        sessionOpened(_event, ctx) {
            // @ts-expect-error 8. Profile 的设置拼错
            void ctx.settings.persnoa;
            // @ts-expect-error 9. Profile 的片的值类型不对
            ctx.set("persona", 1);
        },
    },
    // @ts-expect-error 10. Profile 的片名拼错
    prompt: ({state}) => state.persnoa,
    turn: (turn, format) => {
        // @ts-expect-error 11. 输入的字段拼错
        void turn.input?.data.txt;
        return [format.user(turn.input)];
    },
});
