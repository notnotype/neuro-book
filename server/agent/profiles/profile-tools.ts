import type {TSchema} from "typebox";
import type {ProfileToolBinding, ProfileTools, ReportResultToolBinding, ReportSidecarResultToolBinding, ToolBinding} from "nbook/server/agent/tools/types";
import {buildExecuteWorldDescription} from "nbook/server/agent/world-engine-tool-description";
import type {ExecuteWorldMode} from "nbook/server/world-engine/world-engine.facade";

export type {ProfileTools, ReportResultToolBinding, ReportSidecarResultToolBinding, ToolBinding} from "nbook/server/agent/tools/types";
export {defineAgentTool as defineProfileTool} from "nbook/server/agent/tools/types";
export type {AgentToolDefinition} from "nbook/server/agent/tools/types";

/**
 * 组装 profile root tools，并保留字面量 key 类型，方便 toolKeys / sidecar.toolKeys 做子集约束。
 */
export function toolset<const TItems extends readonly ProfileToolBinding[]>(...items: TItems): {
    [TItem in TItems[number] as TItem["key"]]: TItem;
} {
    const result: ProfileTools = {};
    for (const item of items) {
        if (result[item.key]) {
            throw new Error(`profile tools 重复：${item.key}`);
        }
        result[item.key] = item;
    }
    return result as {
        [TItem in TItems[number] as TItem["key"]]: TItem;
    };
}

/**
 * 受控内置工具引用。这里不暴露 execute，profile 作者只能声明当前 profile 如何绑定已有工具。
 */
export const builtin = {
    file: {
        read: registeredTool("read"),
        write: registeredTool("write"),
        edit: registeredTool("edit"),
        applyPatch: registeredTool("apply_patch"),
        bash: registeredTool("bash"),
    },
    agent: {
        create: registeredTool("create_agent"),
        invoke: registeredTool("invoke_agent"),
        get: registeredTool("get_agent"),
        getProfile: registeredTool("get_agent_profile"),
        getSession: registeredTool("get_session"),
        detach: registeredTool("detach_agent"),
        validateProfile: registeredTool("validate_agent_profile"),
    },
    control: {
        requestUserInput: registeredTool("request_user_input"),
        switchMode: registeredTool("switch_mode"),
    },
    task: {
        create: registeredTool("task_create"),
        setStatus: registeredTool("task_set_status"),
    },
    plot: {
        getTree: registeredTool("get_story_tree"),
        getThread: registeredTool("get_story_thread"),
        getSceneContext: registeredTool("get_story_scene_context"),
        getSceneWorldContext: registeredTool("get_scene_world_context"),
        getChapter: registeredTool("get_story_chapter"),
        getChapterWriterBrief: registeredTool("get_chapter_writer_brief"),
        getPromise: registeredTool("get_story_promise"),
        getDecision: registeredTool("get_story_decision"),
        saveAct: registeredTool("save_story_act"),
        saveChapter: registeredTool("save_story_chapter"),
        saveThread: registeredTool("save_story_thread"),
        saveScene: registeredTool("save_story_scene"),
        savePromise: registeredTool("save_story_promise"),
        savePromiseBeat: registeredTool("save_promise_beat"),
        saveDecision: registeredTool("save_story_decision"),
    },
    sql: {
        execute: registeredTool("execute_sql"),
    },
    subject: {
        ragSearch: registeredTool("subject_rag_search"),
        eventAppend: registeredTool("subject_event_append"),
        memoryUpdate: registeredTool("subject_memory_update"),
    },
    world: {
        // World Engine 当前暴露：CodeAct 读写合一工具；不同 profile 通过 description 暴露只读/读写边界。
        execute: (mode: ExecuteWorldMode): ToolBinding<"execute_world"> => ({
            key: "execute_world",
            description: buildExecuteWorldDescription(mode),
        }),
    },
    web: {
        search: registeredTool("web_search"),
        fetch: registeredTool("web_fetch"),
    },
    rp: {
        // RP v2 角色信息与记忆工具（rp/characters/ 存储）。god-view 能力由各 profile 绑定与提示词约束。
        characterRecall: registeredTool("rp_character_recall"),
        characterUpdate: registeredTool("rp_character_update"),
        memoryCommit: registeredTool("rp_memory_commit"),
    },
    result: {
        main: (options: {dataSchema?: TSchema} = {}): ReportResultToolBinding => ({
            key: "report_result",
            dataSchema: options.dataSchema,
        }),
        sidecar: (): ReportSidecarResultToolBinding => ({
            key: "report_sidecar_result",
        }),
    },
};

/**
 * Plot 读工具 bundle（Task 97 D7 分层绑定）：writer 只 spread 此组；leader/director 读写两组都 spread。
 */
export const plotReadBindings = [
    builtin.plot.getTree,
    builtin.plot.getThread,
    builtin.plot.getSceneContext,
    builtin.plot.getSceneWorldContext,
    builtin.plot.getChapter,
    builtin.plot.getChapterWriterBrief,
    builtin.plot.getPromise,
    builtin.plot.getDecision,
] as const;

/**
 * Plot 写工具 bundle（Task 97 D7 分层绑定）：save_* 显式 action 写面，writer 不持有。
 */
export const plotWriteBindings = [
    builtin.plot.saveAct,
    builtin.plot.saveChapter,
    builtin.plot.saveThread,
    builtin.plot.saveScene,
    builtin.plot.savePromise,
    builtin.plot.savePromiseBeat,
    builtin.plot.saveDecision,
] as const;

/**
 * 引用运行时已注册但 profile API 尚未 typed 化的插件工具。
 */
export function pluginTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return registeredTool(key);
}

/**
 * 构造一个已注册全局工具绑定。它只引用 registry，不携带 execute。
 */
function registeredTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return {
        key,
    };
}
