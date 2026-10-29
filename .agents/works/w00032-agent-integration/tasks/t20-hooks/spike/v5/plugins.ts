/**
 * 第五版的全局扩展例子：插件经 agent.extensions 登记。服务经工厂函数的闭包进来（与现有插件 activate(context) 的写法一致）。
 * 契约（defineContract）放在插件不拖实现的 shared 模块里，别人 import 它写进 dependsOn；这里为了一个文件看全，写在一起。
 */

import {Type} from "typebox";
import {conv, coreHistory, defineContract, defineExtension, ext, implement, shape, slice} from "./api.ts";

// ---------- 契约 ----------

/** 文件变更感知：外部事实 fileChanged 在 session（回退对话不改变世界），送达到哪了在 path。 */
export const historyContract = defineContract("nbook.history", {
    events: {fileChanged: ext.session<{uri: string; by: string}>(), notice: conv<{text: string; through: number}>()},
    exports: shape<{pendingChanges: string[]}>(),
});
export const modeContract = defineContract("nbook.agent.mode", {exports: shape<{mode: "normal" | "plan"}>()});
export const tasksContract = defineContract("nbook.tasks", {exports: shape<{open: string[]}>()});

// ---------- 宿主给插件的服务（示意） ----------

export interface FileWatcher {
    onChange(listener: (change: {uri: string; by: string}) => void): () => void;
}
export interface MemorySearch {
    (query: string, options: {limit: number; signal: AbortSignal}): Promise<{id: string; text: string}[]>;
}
export interface SchemaSource {
    current(): Promise<string>;
    onChange(listener: () => void): () => void;
}

// ---------- 文件变更感知（nbook.history，t13） ----------

type Change = {uri: string; seq: number};
const pendingOf = (state: {readonly changes: readonly Change[]; readonly deliveredThrough: number}) => state.changes.filter((change) => change.seq > state.deliveredThrough);

export const fileNotice = (watcher: FileWatcher) =>
    implement(historyContract, {
        tags: ["history"],
        settings: Type.Object({mode: Type.Union([Type.Literal("off"), Type.Literal("minimal"), Type.Literal("full")], {default: "full", title: "文件变更提醒"})}),
        state: {changes: slice.session<Change[]>([]), deliveredThrough: slice.path(0)},
        reduce: {
            fileChanged: (event, state) => ({changes: [...state.changes, {uri: event.data.uri, seq: event.seq}].slice(-200)}),
            notice: (event) => ({deliveredThrough: event.data.through}),
        },
        exports: {pendingChanges: (state) => [...new Set(pendingOf(state).map((change) => change.uri))]},
        // 外部事实从这里进来；返回的取消订阅就是清理函数
        mount: (ctx) => watcher.onChange(ctx.callback((change) => ctx.emit("fileChanged", change))),
        on: {
            // 每轮一次的提醒挂 turnStarted：没有新输入的“继续”运行也收得到
            turnStarted(_event, ctx) {
                const pending = pendingOf(ctx.state);
                if (pending.length === 0 || ctx.settings.mode === "off") return;
                const list = [...new Set(pending.map((change) => change.uri))].join("、");
                ctx.emit("notice", {
                    text: ctx.settings.mode === "minimal" ? `有文件被改过：${list}` : `用户改过这些文件：${list}。续写前先重读。`,
                    through: pending[pending.length - 1]!.seq,
                });
            },
        },
    });

// ---------- 记忆检索（nb-memory） ----------

export const memory = (search: MemorySearch) =>
    defineExtension({
        id: "nb-memory",
        tags: ["memory"],
        events: {retrieved: conv<{hits: {id: string; text: string}[]}>(), summaryDue: ext<{runs: number}>()},
        on: {
            // 要读输入文字的挂 input；插话转了话题也要检索时再挂 steer
            async input(event, ctx) {
                const hits = await search(event.data.text, {limit: 3, signal: ctx.signal});
                if (hits.length > 0) ctx.emit("retrieved", {hits});
            },
            // 每 16 次运行起一次后台总结（后台任务的形状等 t22；幂等键防止回退重放后重复触发）
            runEnded(_event, ctx) {
                const runs = ctx.read(coreHistory).runs;
                if (runs % 16 === 0) ctx.emit("summaryDue", {runs}, {key: `summary-${runs}`});
            },
        },
        render: {retrieved: (event) => `<memory>${event.data.hits.map((hit) => hit.text).join("\n")}</memory>`},
    });

// ---------- 任务清单（todo 工具所在的插件，t12） ----------

export const tasks = implement(tasksContract, {
    tags: ["reminder"],
    state: {items: slice.path<{text: string; done: boolean}[]>([])},
    reduce: {
        // 从工具结果的 details 归约，不解析给模型看的文字
        toolResult: (event) => (event.data.tool === "todo" ? {items: event.data.details as {text: string; done: boolean}[]} : undefined),
    },
    exports: {open: (state) => state.items.filter((item) => !item.done).map((item) => item.text)},
    remind: {
        open: {every: 8, text: ({view}) => {
            const open = view.state.items.filter((item) => !item.done);
            return open.length > 0 ? `未完成的任务：${open.map((item) => item.text).join("；")}` : null;
        }},
    },
});

// ---------- 模式（nbook.agent.mode，t06） ----------

export const mode = implement(modeContract, {
    tags: ["reminder"],
    settings: Type.Object({mode: Type.Union([Type.Literal("normal"), Type.Literal("plan")], {default: "normal", title: "模式"})}),
    exports: {mode: (_state, settings) => settings.mode},
    remind: {
        changed: {
            watch: ({settings}) => settings.mode,
            text: ({value, first}) => (value === "plan" ? "现在是计划模式：只读，先写计划到 session://plan.md。" : first ? null : "已退出计划模式。"),
        },
    },
    // remind 写出的是保留事件 remind；给它一个缺省样子（Profile 还能覆盖）
    render: {remind: (event) => `<system-reminder>${event.data.text}</system-reminder>`},
    intercept: {
        async tool(call, next, ctx) {
            const effect = ctx.tools.find((tool) => tool.name === call.name)?.effect ?? "exec";
            const toPlan = ctx.resources.resolve(String(call.args.path ?? "")).startsWith("session://plan");
            if (ctx.settings.mode === "plan" && effect !== "read" && !toPlan) return {text: "计划模式下不能改文件或执行命令；先和用户确认计划。", status: "denied"};
            return next(call);
        },
    },
});

// ---------- 路由 ----------

export const router = defineExtension({
    id: "demo.router",
    intercept: {
        async model(request, next, ctx) {
            if (request.purpose !== "turn") return next(request);           // 压缩、后台请求不降级
            const input = ctx.read(coreHistory).input;
            return next(input && input.text.length < 12 ? {...request, model: "cheap"} : request);
        },
    },
});

// ---------- 库结构摘要（nbook.sql）：稳定的槽，库结构变了才变 ----------

export const sqlSchema = (source: SchemaSource) =>
    defineExtension({
        id: "nbook.sql",
        state: {schema: slice.session("")},
        events: {schemaChanged: ext.session<{schema: string}>()},
        reduce: {schemaChanged: (event) => ({schema: event.data.schema})},
        async mount(ctx) {
            const sync = async () => {
                const schema = await source.current();
                if (schema !== ctx.state.schema) ctx.emit("schemaChanged", {schema});
            };
            await sync();
            return source.onChange(ctx.callback(sync));
        },
        contribute: {"sql-schema": {value: ({state}) => (state.schema ? `<sql_schema>${state.schema}</sql_schema>` : null)}},
    });

// ---------- 读别人：依赖写对象 ----------

/** 计划模式下提醒“有文件被改过但还没送达”：监听别人的事件、读别人的导出，类型都从 dependsOn 来。 */
export const planWatch = defineExtension({
    id: "demo.plan-watch",
    dependsOn: [historyContract, modeContract],
    events: {warn: conv()},
    on: {
        "nbook.history/fileChanged"(event, ctx) {
            if (ctx.read(modeContract).mode === "plan") ctx.emit("warn", {text: `计划模式中 ${event.data.uri} 被改了，计划可能要更新。`});
        },
    },
});
