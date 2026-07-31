import {createFileTools} from "nbook/server/agent/tools/file-tools";
import {createPlotTools} from "nbook/server/agent/tools/plot-tools";
import {createSqlTool} from "nbook/server/agent/tools/sql-tool";
import {createSubjectMemoryTools} from "nbook/server/agent/tools/subject-memory-tools";
import {createTaskTools} from "nbook/server/agent/tools/task-tools";
import {createWebTools} from "nbook/server/agent/tools/web-tools";
import {createWorldEngineTools} from "nbook/server/agent/tools/world-engine-tools";
import {agentCollaborationTools} from "nbook/server/agent/tools/agent-collaboration-tools";
import {profileValidateTools} from "nbook/server/agent/tools/profile-validate-tool";
import {rpCharacterTools} from "nbook/server/agent/tools/rp-character-tools";
import {rpCognitionTools} from "nbook/server/agent/tools/rp-cognition-tools";
import {rpEventTools} from "nbook/server/agent/tools/rp-event-tools";
import {rpIntakeTools} from "nbook/server/agent/tools/rp-intake-tools";
import {rpMechanicsTools} from "nbook/server/agent/tools/rp-mechanics-tools";
import {rpMapTools} from "nbook/server/agent/tools/rp-map-tools";
import {rpNpcTools} from "nbook/server/agent/tools/rp-npc-tools";
import {rpPipelineTools} from "nbook/server/agent/tools/rp-pipeline-tools";
import {rpFocusTools} from "nbook/server/agent/tools/rp-focus-tools";
import {rpRelationTools} from "nbook/server/agent/tools/rp-relation-tools";
import {rpTickTools} from "nbook/server/agent/tools/rp-tick-tools";
import {rpTurnTools} from "nbook/server/agent/tools/rp-turn-tools";
import {controlTools} from "nbook/server/agent/tools/control-tools";
import {createVariableTools} from "nbook/server/agent/variables/tools";
import {defineAgentToolFromRuntime} from "nbook/server/agent/tools/types";
import type {AgentToolDefinition, NeuroAgentTool} from "nbook/server/agent/tools/types";

export {agentCollaborationTools} from "nbook/server/agent/tools/agent-collaboration-tools";
export {controlTools, createReportResultTool, createReportSidecarResultTool, ReportResultSchema, ReportSidecarResultSchema} from "nbook/server/agent/tools/control-tools";

function buildAgentTools() {
    const fileTools = definitionsByKey(createFileTools());
    const taskTools = definitionsByKey(createTaskTools());
    const plotTools = definitionsByKey(createPlotTools());
    const variableTools = definitionsByKey(createVariableTools());
    const webTools = definitionsByKey(createWebTools());
    const worldEngineTools = definitionsByKey(createWorldEngineTools());
    const subjectMemoryTools = definitionsByKey(createSubjectMemoryTools());
    const sqlTool = defineAgentToolFromRuntime(createSqlTool());
    return {
        read: requireDefinition(fileTools, "read"),
        write: requireDefinition(fileTools, "write"),
        edit: requireDefinition(fileTools, "edit"),
        applyPatch: requireDefinition(fileTools, "apply_patch"),
        bash: requireDefinition(fileTools, "bash"),
        taskCreate: requireDefinition(taskTools, "task_create"),
        taskSetStatus: requireDefinition(taskTools, "task_set_status"),
        getStoryTree: requireDefinition(plotTools, "get_story_tree"),
        getStoryThread: requireDefinition(plotTools, "get_story_thread"),
        getStorySceneContext: requireDefinition(plotTools, "get_story_scene_context"),
        getSceneWorldContext: requireDefinition(plotTools, "get_scene_world_context"),
        getStoryChapter: requireDefinition(plotTools, "get_story_chapter"),
        getChapterWriterBrief: requireDefinition(plotTools, "get_chapter_writer_brief"),
        getStoryPromise: requireDefinition(plotTools, "get_story_promise"),
        getStoryDecision: requireDefinition(plotTools, "get_story_decision"),
        saveStoryAct: requireDefinition(plotTools, "save_story_act"),
        saveStoryChapter: requireDefinition(plotTools, "save_story_chapter"),
        saveStoryThread: requireDefinition(plotTools, "save_story_thread"),
        saveStoryScene: requireDefinition(plotTools, "save_story_scene"),
        saveStoryPromise: requireDefinition(plotTools, "save_story_promise"),
        savePromiseBeat: requireDefinition(plotTools, "save_promise_beat"),
        saveStoryDecision: requireDefinition(plotTools, "save_story_decision"),
        executeSql: sqlTool,
        variableSchema: requireDefinition(variableTools, "variable_schema"),
        variableRead: requireDefinition(variableTools, "variable_read"),
        variablePatch: requireDefinition(variableTools, "variable_patch"),
        subjectRagSearch: requireDefinition(subjectMemoryTools, "subject_rag_search"),
        subjectEventAppend: requireDefinition(subjectMemoryTools, "subject_event_append"),
        subjectMemoryUpdate: requireDefinition(subjectMemoryTools, "subject_memory_update"),
        executeWorld: requireDefinition(worldEngineTools, "execute_world"),
        webSearch: requireDefinition(webTools, "web_search"),
        webFetch: requireDefinition(webTools, "web_fetch"),
        ...controlTools,
        ...agentCollaborationTools,
        ...profileValidateTools,
        ...rpCharacterTools,
        ...rpCognitionTools,
        ...rpEventTools,
        ...rpIntakeTools,
        ...rpMechanicsTools,
        ...rpMapTools,
        ...rpNpcTools,
        ...rpPipelineTools,
        ...rpFocusTools,
        ...rpRelationTools,
        ...rpTickTools,
        ...rpTurnTools,
    } as const;
}

export function createAgentToolRuntimes(): NeuroAgentTool[] {
    return Object.values(buildAgentTools()).map((definition) => definition.runtime());
}

/**
 * 构造 v3 内置工具 runtime。profile 自带工具不进入全局 registry。
 */
export function createBuiltinTools(): NeuroAgentTool[] {
    return createAgentToolRuntimes();
}

function definitionsByKey(tools: NeuroAgentTool[]): Record<string, AgentToolDefinition> {
    return Object.fromEntries(tools.map((tool) => [tool.key, defineAgentToolFromRuntime(tool)]));
}

function requireDefinition<const TKey extends string>(definitions: Record<string, AgentToolDefinition>, key: TKey): AgentToolDefinition<TKey> {
    const definition = definitions[key];
    if (!definition) {
        throw new Error(`内置工具定义缺失：${key}`);
    }
    return definition as AgentToolDefinition<TKey>;
}
