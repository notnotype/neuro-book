import type {
    CreateStoryDecisionRequestDto,
    CreateStoryPromiseRequestDto,
    SetPromiseBeatRequestDto,
    StoryDecisionDto,
    StoryPromiseDetailDto,
    StoryPromiseDto,
    UpdateStoryDecisionRequestDto,
    UpdateStoryPromiseRequestDto,
} from "nbook/shared/dto/plot.dto";

/**
 * 规划层(Promise/Decision)HTTP typed client。
 * 只覆盖 Task 99 新消费的端点;存量 plot 调用点仍走各组件内 $fetch(迁移另案,见 Task 87 TODO)。
 * 所有请求 query 携带 projectRoot,与 server/api/projects/plot/[...segments].ts 的路由契约一一对应。
 */

/** 组装带 projectRoot 的请求选项。 */
function plotQuery(projectRoot: string): {query: {projectRoot: string}} {
    return {query: {projectRoot}};
}

/** 拉取 Promise 摘要列表(含派生阶段与节拍统计)。 */
export async function listStoryPromises(projectRoot: string): Promise<StoryPromiseDto[]> {
    return await $fetch<StoryPromiseDto[]>(`/api/projects/plot/promises`, plotQuery(projectRoot));
}

/** 拉取单个 Promise 详情(含 beats 与所在场/章位)。 */
export async function getStoryPromiseDetail(projectRoot: string, promiseId: string): Promise<StoryPromiseDetailDto> {
    return await $fetch<StoryPromiseDetailDto>(`/api/projects/plot/promises/${promiseId}`, plotQuery(projectRoot));
}

/** 创建 Promise,返回详情。 */
export async function createStoryPromise(projectRoot: string, body: CreateStoryPromiseRequestDto): Promise<StoryPromiseDetailDto> {
    return await $fetch<StoryPromiseDetailDto>(`/api/projects/plot/promises`, {...plotQuery(projectRoot), method: "POST", body});
}

/** 更新 Promise(PATCH 语义:undefined=不修改,null=显式清空);生命周期转换也走此处的 status 字段。 */
export async function updateStoryPromise(projectRoot: string, promiseId: string, body: UpdateStoryPromiseRequestDto): Promise<StoryPromiseDetailDto> {
    return await $fetch<StoryPromiseDetailDto>(`/api/projects/plot/promises/${promiseId}`, {...plotQuery(projectRoot), method: "PATCH", body});
}

/** 物理删除 Promise(节拍级联删除;Agent 无此出口,仅 UI/人工)。 */
export async function deleteStoryPromise(projectRoot: string, promiseId: string): Promise<void> {
    await $fetch(`/api/projects/plot/promises/${promiseId}`, {...plotQuery(projectRoot), method: "DELETE"});
}

/** upsert 一条节拍(同场同线仅一条);kind=payoff 且 autoFulfill 非 false 时服务层自动置 fulfilled。返回最新详情。 */
export async function setPromiseBeat(projectRoot: string, promiseId: string, body: SetPromiseBeatRequestDto): Promise<StoryPromiseDetailDto> {
    return await $fetch<StoryPromiseDetailDto>(`/api/projects/plot/promises/${promiseId}/beats`, {...plotQuery(projectRoot), method: "PUT", body});
}

/** 移除一条节拍(服务层会跑 fulfilled 回退检查)。返回最新详情。 */
export async function removePromiseBeat(projectRoot: string, promiseId: string, sceneId: string): Promise<StoryPromiseDetailDto> {
    return await $fetch<StoryPromiseDetailDto>(`/api/projects/plot/promises/${promiseId}/beats/${sceneId}`, {...plotQuery(projectRoot), method: "DELETE"});
}

/** 拉取 Decision 列表。 */
export async function listStoryDecisions(projectRoot: string): Promise<StoryDecisionDto[]> {
    return await $fetch<StoryDecisionDto[]>(`/api/projects/plot/decisions`, plotQuery(projectRoot));
}

/** 拉取单个 Decision。 */
export async function getStoryDecision(projectRoot: string, decisionId: string): Promise<StoryDecisionDto> {
    return await $fetch<StoryDecisionDto>(`/api/projects/plot/decisions/${decisionId}`, plotQuery(projectRoot));
}

/** 创建 Decision(恒为 open 态,decided 走 decide 转换)。 */
export async function createStoryDecision(projectRoot: string, body: CreateStoryDecisionRequestDto): Promise<StoryDecisionDto> {
    return await $fetch<StoryDecisionDto>(`/api/projects/plot/decisions`, {...plotQuery(projectRoot), method: "POST", body});
}

/** 更新 Decision;decide/drop/reopen 都走 status 直改,不变式由服务层校验(decided 需 decision/motivation/risk,dropped 需 note)。 */
export async function updateStoryDecision(projectRoot: string, decisionId: string, body: UpdateStoryDecisionRequestDto): Promise<StoryDecisionDto> {
    return await $fetch<StoryDecisionDto>(`/api/projects/plot/decisions/${decisionId}`, {...plotQuery(projectRoot), method: "PATCH", body});
}

/** 物理删除 Decision(仅 UI/人工)。 */
export async function deleteStoryDecision(projectRoot: string, decisionId: string): Promise<void> {
    await $fetch(`/api/projects/plot/decisions/${decisionId}`, {...plotQuery(projectRoot), method: "DELETE"});
}
