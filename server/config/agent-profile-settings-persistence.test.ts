import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import leaderDefaultProfile, {LeaderDefaultSettingsForm} from "nbook/assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {ensureProfileHome} from "nbook/server/agent/profiles/profile-home";
import {readConfigAgentProfileSettings, saveGlobalConfig} from "nbook/server/config/config-service";

let stateRoot = "";
let previousApplicationRoot: string | undefined;
let previousStateRoot: string | undefined;

describe("Agent Profile settings persistence", () => {
    beforeEach(async () => {
        stateRoot = await fs.mkdtemp(path.resolve(".agent", "workspace", "profile-settings-persistence-"));
        previousApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
        previousStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
        process.env.NEURO_BOOK_APPLICATION_ROOT = path.resolve(".");
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
    });

    afterEach(async () => {
        if (previousApplicationRoot === undefined) delete process.env.NEURO_BOOK_APPLICATION_ROOT;
        else process.env.NEURO_BOOK_APPLICATION_ROOT = previousApplicationRoot;
        if (previousStateRoot === undefined) delete process.env.NEURO_BOOK_STATE_ROOT;
        else process.env.NEURO_BOOK_STATE_ROOT = previousStateRoot;
        await fs.rm(stateRoot, {recursive: true, force: true});
    });

    it("保存 Leader 禁用提示词与预设时升级旧 Home，并在重读后保持原值", async () => {
        const catalog = new AgentProfileCatalog("__missing_system__", "__missing_user__");
        catalog.register(leaderDefaultProfile, true);
        const userNbookRoot = path.join(stateRoot, "workspace", ".nbook");
        await fs.mkdir(userNbookRoot, {recursive: true});
        const oldHome = await ensureProfileHome({
            projectRoot: userNbookRoot,
            profileKey: "leader.default",
            profileVersion: 1,
        });
        await oldHome.writeText("personas/caihui-lite.md", "保留的用户 Leader 人设", {mode: "create"});
        const preset = {
            id: "preset-disabled",
            name: "禁用条目预设",
            settingsJson: JSON.stringify({
                promptEntries: [{
                    id: "disabled",
                    title: "禁用规则",
                    enabled: false,
                    content: "不得进入提示词",
                    position: "after",
                }],
            }),
            updatedAt: "2026-07-30T00:00:00.000Z",
        };

        const snapshot = await saveGlobalConfig({
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        settings: {
                            ...LeaderDefaultSettingsForm.defaults,
                            promptEntries: [{
                                id: "disabled",
                                title: "禁用规则",
                                enabled: false,
                                content: "不得进入提示词",
                                position: "after",
                            }],
                            profilePresets: [preset],
                            activeProfilePresetId: preset.id,
                        },
                    },
                },
            },
        }, {workspaceKind: "user-assets"}, catalog);
        const storedSettings = snapshot.global.agent?.profiles?.["leader.default"]?.settings;
        const storedEntries = storedSettings?.promptEntries as Array<{enabled: boolean}> | undefined;
        const storedPresets = storedSettings?.profilePresets as Array<{id: string}> | undefined;
        const settings = await readConfigAgentProfileSettings({workspaceKind: "user-assets"}, catalog);
        const leader = settings.agentProfiles.find((profile) => profile.profileKey === "leader.default");

        expect(storedEntries?.[0]?.enabled).toBe(false);
        expect(storedPresets?.[0]?.id).toBe(preset.id);
        expect(storedSettings?.activeProfilePresetId).toBe(preset.id);
        await expect(fs.readFile(path.join(userNbookRoot, "agents", "leader.default", "personas", "caihui-lite.md"), "utf8"))
            .resolves.toBe("保留的用户 Leader 人设");
        await expect(fs.readFile(path.join(userNbookRoot, "agents", "leader.default", "prompts", "default.md"), "utf8"))
            .resolves.toContain("默认（出厂）");
        expect(leader?.settings?.issues).toEqual([]);
    });
});
