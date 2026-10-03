import {useAgentHarness} from "nbook/server/agent/http";
import type {AgentSkillCatalogItemDto} from "nbook/shared/dto/agent-session.dto";

/**
 * 读取当前 v3 Agent 可见的 Skill Catalog。
 */
export default defineEventHandler(async (): Promise<AgentSkillCatalogItemDto[]> => {
    const harness = useAgentHarness();
    const skills = await harness.skills.list();
    return skills.map((skill) => ({
        name: skill.name,
        description: skill.description ?? skill.key,
    }));
});
