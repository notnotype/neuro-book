/**
 * `reminder()`：值变了的那一轮、或每隔 `every` 轮，在这一轮开头写一条附带内容（提案第 6 节）。
 *
 * 展开就是一个普通扩展：一片记“告诉过的值与轮数”的 path 片（压缩时清空，所以压缩后会再提醒一次；回退时跟着回去）、
 * 一个对话事件 `reminder`、挂在 `turnStarted` 上的处理函数（没有新输入的“继续”运行也收得到）。
 * `text` 返回 null 时这次不写，但照样记下这个值：之后它再变才提醒。
 */

import {jsonProblem, type JsonValue, type ReminderHelper} from "../api/index.js";
import {REMINDER_TRIGGERS} from "../extension/assemble.js";
import {conv, coreHistory, defineExtension, slice} from "../extension/define.js";

type Told = {value: JsonValue; turn: number} | null;

export const reminder: ReminderHelper = (options) => {
    const {every, watch} = options as {every?: number; watch?: (view: unknown) => unknown};
    const extension = defineExtension({
        id: options.id,
        ...(options.tags === undefined ? {} : {tags: options.tags}),
        ...(options.dependsOn === undefined ? {} : {dependsOn: options.dependsOn as unknown as readonly []}),
        state: {told: slice.path<Told>(null, {resetOnCompaction: true})},
        events: {reminder: conv<{text: string}>()},
        on: {
            turnStarted(_event, ctx) {
                const turns = ctx.read(coreHistory).turns;
                const raw = watch === undefined ? null : watch(ctx as never);
                // 不是 JSON 的值（Set、Map）要记进片里比较，记不下：抛出来成为 handler-threw 诊断，不悄悄当成 null（那样之后永不再提醒）。
                const problem = raw === undefined ? null : jsonProblem(raw);
                if (problem !== null) throw new TypeError(`watch of reminder ${options.id} returned a value that is not JSON (${problem}); return arrays and plain objects`);
                const value = (raw ?? null) as JsonValue;
                const told = ctx.state.told as Told;
                const first = told === null;
                const changed = watch !== undefined && (first || JSON.stringify(told.value) !== JSON.stringify(value));
                const due = every !== undefined && (first || turns - told.turn >= every);
                if (!changed && !due) return;
                const text = options.text({value, previous: told?.value, first, view: ctx as never});
                ctx.set("told", {value, turn: turns});
                if (text !== null) ctx.emit("reminder", {text});
            },
        },
    });
    return Object.assign(extension, {[REMINDER_TRIGGERS]: {every, watch}}) as never;
};
