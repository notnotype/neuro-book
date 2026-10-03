import {describe, expect, it} from "vitest";
import {validateConfigAgentProfileSettingsQuery, validateConfigEditorSnapshotQuery} from "nbook/server/config/query";

describe("config query", () => {
    it("editor snapshot 只保留 workspace query", () => {
        expect(validateConfigEditorSnapshotQuery({workspaceKind: "user-assets"})).toEqual({
            workspaceKind: "user-assets",
        });
        expect(validateConfigEditorSnapshotQuery({
            workspaceKind: "user-assets",
            includeAgentProfileSettings: "true",
            agentProfileSettingsScope: "global",
        })).toEqual({
            workspaceKind: "user-assets",
        });
    });

    it("解析并校验 Agent Profile settings scope", () => {
        expect(validateConfigAgentProfileSettingsQuery({
            workspaceKind: "user-assets",
        }).scope).toBe("global");
        expect(validateConfigAgentProfileSettingsQuery({
            workspaceKind: "user-assets",
            scope: "project",
        }).scope).toBe("project");

        let thrown: unknown;
        try {
            validateConfigAgentProfileSettingsQuery({
                workspaceKind: "user-assets",
                scope: "workspace",
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({statusCode: 400});
    });
});
