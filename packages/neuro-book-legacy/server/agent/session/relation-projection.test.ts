import {describe, expect, it} from "vitest";
import {projectRelatedSessions} from "nbook/server/agent/session/relation-projection";
import {AgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";

describe("projectRelatedSessions", () => {
    it("只把关联目标自身的缺失投影为 unavailable", async () => {
        const result = await projectRelatedSessions([2, 3], async (sessionId) => {
            if (sessionId === 2) {
                throw new AgentSessionNotFoundError(2);
            }
            return `session-${String(sessionId)}`;
        });

        expect(result).toEqual({
            items: ["session-3"],
            unavailable: 1,
        });
    });

    it("Not Found 指向其它 Session 时继续抛出", async () => {
        await expect(projectRelatedSessions([2], async () => {
            throw new AgentSessionNotFoundError(3);
        })).rejects.toBeInstanceOf(AgentSessionNotFoundError);
    });

    it("损坏、权限和其它 I/O 错误保持原样抛出", async () => {
        const error = new Error("permission denied");
        await expect(projectRelatedSessions([2], async () => {
            throw error;
        })).rejects.toBe(error);
    });
});
