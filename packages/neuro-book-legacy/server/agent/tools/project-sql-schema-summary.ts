import {PROJECT_AGENT_SQL_MODULE_TOKEN} from "nbook/server/agent/tools/agent-sql-project-module";
import {activateReadyProjectModule, type ReadyProjectSessionRef} from "nbook/server/runtime/product-project";

/**
 * 取当前 Project Workspace 的 SQL schema 摘要。
 *
 * 供宿主接线 `ProfilePrepareContext.runtime.sqlSchemaSummary`；profile artifact
 * 依赖图不允许携带 project-session / @libsql，所以 profile-dsl 只经注入调用。
 * 单独成模块的原因：project-session 反向 import agent-sql-project-module 做注册，
 * helper 放在那两个模块任一侧都会成环。
 *
 * @param ready 为 null 表示当前 session 没有 Project Workspace，直接抛错，
 *              由 profile 侧 catch 渲染「暂不可用」降级文案。
 */
export async function projectSqlSchemaSummary(ready: ReadyProjectSessionRef | null): Promise<string> {
    if (!ready) {
        throw new Error("当前session没有Project Workspace");
    }
    const sql = await activateReadyProjectModule(ready, PROJECT_AGENT_SQL_MODULE_TOKEN);
    return await sql.schemaSummary();
}
