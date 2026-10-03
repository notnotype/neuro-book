import {describe, expect, it} from "vitest";
import {decodeSessionSchemaV1} from "nbook/server/agent/session/migrations/session-v2/legacy-decoder";

type FixtureNode = null | boolean | number | string | FixtureNode[] | FixtureObject;
type FixtureObject = {[key: string]: FixtureNode};

const MIGRATION_TIMESTAMP = 1_800_000_000_000;

describe("Session schema v1 -> v2 legacy decoder", () => {
    it("迁移 managed header，并区分 Workspace Root-relative 与 Project-relative path", () => {
        const source = sessionText({
            metadata: legacyMetadata({
                projectPath: "workspace/story",
                workspaceKey: "workspace/story",
            }),
            branch: [
                assistantEntry([
                    toolCall("call_read", "read", {path: "manuscript/a.md"}),
                    toolCall("call_subject", "subject_rag_search", {subjectPath: "story/simulation/hero"}),
                    toolCall("call_project", "project_info", {projectPath: "workspace/story"}),
                    toolCall("call_bash", "bash", {command: "cat manuscript/a.md"}),
                ]),
                toolResultEntry("call_read", "read", {path: "manuscript/a.md"}, "read manuscript/a.md"),
                toolResultEntry("call_subject", "subject_rag_search", {subjectPath: "story/simulation/hero"}),
                toolResultEntry("call_project", "project_info", {projectPath: "workspace/story"}),
                toolResultEntry("call_bash", "bash", {}, "cat manuscript/a.md"),
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/1.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
            knownProjectRoots: ["story"],
        });
        const target = decodeTarget(plan.targetText);
        const calls = toolCalls(target.entries);
        const results = toolResults(target.entries);

        expect(plan.classification).toBe("managed");
        expect(plan.currentProjectRoot).toBe("story");
        expect(plan.reviewReasons).toEqual([]);
        expect(target.metadata).toMatchObject({schemaVersion: 2, currentProjectRoot: "story"});
        expect(target.metadata).not.toHaveProperty("workspaceRoot");
        expect(target.metadata).not.toHaveProperty("workspaceKey");
        expect(target.metadata).not.toHaveProperty("projectPath");
        expect(calls.get("call_read")?.arguments).toEqual({path: "story/manuscript/a.md"});
        expect(calls.get("call_subject")?.arguments).toEqual({subjectPath: "simulation/hero"});
        expect(calls.get("call_project")?.arguments).toEqual({projectRoot: "story"});
        expect(calls.get("call_bash")?.arguments).toEqual({command: "cat manuscript/a.md"});
        expect(results.get("call_read")?.details).toEqual({path: "story/manuscript/a.md"});
        expect(results.get("call_subject")?.details).toEqual({subjectPath: "simulation/hero"});
        expect(results.get("call_project")?.details).toEqual({projectRoot: "story"});
        expect(messageText(results.get("call_read"))).toBe("read manuscript/a.md");
        expect(messageText(results.get("call_bash"))).toBe("cat manuscript/a.md");
        expect(target.entries.at(-1)).toMatchObject({type: "leaf", leafId: target.entries.at(-2)?.id});
        expect(target.entries.at(-2)).toMatchObject({type: "custom_message", visibleToModel: true});
    });

    it("迁移 apply_patch move、Plan、split-book 与 profile payload，但不改 patch body、planContent 和 script", () => {
        const patch = [
            "*** Begin Patch",
            "*** Update File: manuscript/a.md",
            "*** Move to: manuscript/b.md",
            "@@",
            "-literal manuscript/a.md",
            "+literal manuscript/c.md",
            "*** End Patch",
        ].join("\n");
        const source = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/story", workspaceKey: "workspace/story"}),
            branch: [
                assistantEntry([
                    toolCall("call_patch", "apply_patch", {patch}),
                    toolCall("call_plan", "switch_mode", {
                        targetMode: "normal",
                        planFilePath: ".agent/plan/path.md",
                        planContent: "Keep manuscript/a.md literal",
                    }),
                    toolCall("call_workflow", "run_workflow", {
                        workflowKey: "split-book",
                        args: {filePath: "story/manuscript/book.md", script: "open('manuscript/book.md')"},
                    }),
                    toolCall("call_invoke", "invoke_agent", {
                        sessionId: 9,
                        input: {
                            path: "story/manuscript/a.md",
                            context: {
                                lorebookEntries: ["story/lorebook/hero.md"],
                                readablePaths: ["manuscript/a.md"],
                            },
                        },
                    }),
                ]),
                toolResultEntry("call_patch", "apply_patch", {files: [{path: "manuscript/b.md"}]}),
                toolResultEntry("call_plan", "switch_mode", {
                    data: {
                        planFilePath: ".agent/plan/path.md",
                        planContent: "Keep manuscript/a.md literal",
                    },
                }),
                toolResultEntry("call_workflow", "run_workflow", {}),
                toolResultEntry("call_invoke", "invoke_agent", {}),
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/2.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
            profileBySessionId: {"9": "writer"},
        });
        const target = decodeTarget(plan.targetText);
        const calls = toolCalls(target.entries);
        const results = toolResults(target.entries);
        const migratedPatch = stringValue(calls.get("call_patch")?.arguments, "patch");

        expect(migratedPatch).toContain("*** Update File: story/manuscript/a.md");
        expect(migratedPatch).toContain("*** Move to: story/manuscript/b.md");
        expect(migratedPatch).toContain("-literal manuscript/a.md");
        expect(migratedPatch).toContain("+literal manuscript/c.md");
        expect(calls.get("call_plan")?.arguments).toEqual({
            targetMode: "normal",
            planFilePath: "story/.agent/plan/path.md",
            planContent: "Keep manuscript/a.md literal",
        });
        expect(calls.get("call_workflow")?.arguments).toEqual({
            workflowKey: "split-book",
            args: {path: "manuscript/book.md", script: "open('manuscript/book.md')"},
        });
        expect(calls.get("call_invoke")?.arguments).toEqual({
            sessionId: 9,
            input: {
                path: "manuscript/a.md",
                context: {
                    lorebookEntries: ["lorebook/hero.md"],
                    readablePaths: ["manuscript/a.md"],
                },
            },
        });
        expect(results.get("call_patch")?.details).toEqual({files: [{path: "story/manuscript/b.md"}]});
        expect(results.get("call_plan")?.details).toEqual({
            data: {
                planFilePath: "story/.agent/plan/path.md",
                planContent: "Keep manuscript/a.md literal",
            },
        });
        expect(plan.reviewReasons).toEqual([]);
    });

    it("关闭 active pending call、resolution、follow-up 与 waiting lifecycle", () => {
        const source = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/story", workspaceKey: "workspace/story"}),
            branch: [
                {type: "invocation_lifecycle", invocationId: "invoke_pending", status: "start"},
                assistantEntry([
                    toolCall("call_pending", "request_user_input", {
                        questions: [{question: "Continue?"}],
                    }),
                ]),
                {type: "invocation_lifecycle", invocationId: "invoke_pending", status: "waiting"},
            ],
            projections: [
                {
                    type: "custom",
                    key: "agent.pendingUserResolution.call_pending",
                    value: {kind: "user_input", toolCallId: "call_pending"},
                    origin: "projection",
                },
                {
                    type: "custom",
                    key: "agent.followUpQueue",
                    value: {
                        status: "ready",
                        items: [{
                            id: "follow_1",
                            clientMessageId: "client_1",
                            kind: "followup",
                            message: {content: [{type: "text", text: "later"}]},
                            createdAt: MIGRATION_TIMESTAMP - 1,
                        }],
                    },
                    origin: "projection",
                },
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/3.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const target = decodeTarget(plan.targetText);
        const pendingResult = toolResults(target.entries).get("call_pending");
        const activeTail = target.entries.slice(-6);

        expect(pendingResult).toMatchObject({
            toolName: "request_user_input",
            isError: true,
            details: {status: "cancelled", code: "SESSION_PATH_CONTRACT_MIGRATION"},
        });
        expect(plan.stats).toMatchObject({
            cancelledToolCalls: 1,
            clearedPendingResolutions: 1,
            clearedFollowUpQueue: true,
        });
        expect(activeTail).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: "custom",
                key: "agent.pendingUserResolution.call_pending",
                value: null,
            }),
            expect.objectContaining({
                type: "custom",
                key: "agent.followUpQueue",
                value: {status: "ready", items: []},
            }),
            expect.objectContaining({
                type: "invocation_lifecycle",
                invocationId: "invoke_pending",
                status: "aborted",
            }),
        ]));
        expect(target.entries.at(-1)).toMatchObject({type: "leaf", leafId: target.entries.at(-2)?.id});
    });

    it("external 与 UNC scope 将可证明的相对地址绝对化，并固定 review reason 顺序", () => {
        const windowsSource = sessionText({
            metadata: legacyMetadata({
                profileKey: "unknown.profile",
                projectPath: "C:\\outside\\story",
                workspaceKey: "external",
                initial: {mysteryPath: "manuscript/a.md"},
            }),
            branch: [
                assistantEntry([toolCall("call_external", "read", {path: "manuscript/a.md"})]),
                toolResultEntry("call_external", "read", {path: "manuscript/a.md"}),
            ],
        });
        const uncSource = sessionText({
            metadata: legacyMetadata({
                projectPath: "\\\\server\\share\\story",
                workspaceKey: "external",
            }),
            branch: [
                assistantEntry([toolCall("call_unc", "read", {path: "manuscript/a.md"})]),
                toolResultEntry("call_unc", "read", {path: "manuscript/a.md"}),
            ],
        });

        const windows = decodeSessionSchemaV1({
            sourcePath: "sessions/4.jsonl",
            text: windowsSource,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const unc = decodeSessionSchemaV1({
            sourcePath: "sessions/5.jsonl",
            text: uncSource,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(windows.classification).toBe("external");
        expect(windows.reviewReasons).toEqual(["current_project_unresolved"]);
        expect(windows.ambiguousLocations).toContain("header.metadata.initial");
        expect(decodeTarget(windows.targetText).metadata.migrationReview).toEqual({
            status: "required",
            reason: "current_project_unresolved",
        });
        expect(toolCalls(decodeTarget(windows.targetText).entries).get("call_external")?.arguments)
            .toEqual({path: "C:\\outside\\story\\manuscript\\a.md"});
        expect(unc.classification).toBe("external");
        expect(unc.reviewReasons).toEqual(["current_project_unresolved"]);
        expect(toolCalls(decodeTarget(unc.targetText).entries).get("call_unc")?.arguments)
            .toEqual({path: "\\\\server\\share\\story\\manuscript\\a.md"});
    });

    it("保留 stale root，折叠 user-assets，并重置可重建 reminder 与 client path variable", () => {
        const staleSource = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/missing", workspaceKey: "workspace/missing"}),
            branch: [],
            projections: [
                {
                    type: "custom",
                    key: "profileState.leader.default",
                    value: {
                        reminders: {
                            "runtime-location": {fingerprint: "old-root"},
                            "workspace-focus": {fingerprint: "workspace/missing"},
                            "linked-agents": {fingerprint: "keep"},
                        },
                    },
                    origin: "projection",
                },
                {
                    type: "variable_patch",
                    namespace: "client",
                    path: "studio",
                    operations: [
                        {op: "replace", path: "/workspace", value: "workspace/missing"},
                        {op: "replace", path: "/selectedFilePath", value: "missing/manuscript/a.md"},
                    ],
                    source: "frontend",
                },
                {
                    type: "session_attachment",
                    origin: "projection",
                    attachment: {
                        id: `sha256:${"a".repeat(64)}`,
                        mimeType: "image/png",
                        bytes: 12,
                    },
                    source: "upload",
                    name: "cover.png",
                },
            ],
        });
        const assetsSource = sessionText({
            metadata: legacyMetadata({
                profileKey: "leader.assets",
                projectPath: "workspace/.nbook",
                workspaceKey: "user-assets",
            }),
            branch: [
                assistantEntry([toolCall("call_assets", "read", {path: "agent/skills/demo/SKILL.md"})]),
                toolResultEntry("call_assets", "read", {path: "agent/skills/demo/SKILL.md"}),
            ],
        });

        const stale = decodeSessionSchemaV1({
            sourcePath: "sessions/6.jsonl",
            text: staleSource,
            migrationTimestamp: MIGRATION_TIMESTAMP,
            knownProjectRoots: ["other"],
        });
        const staleTarget = decodeTarget(stale.targetText);
        const profileState = staleTarget.entries.find((entry) => entry.key === "profileState.leader.default")?.value;
        const variablePatch = staleTarget.entries.find((entry) => entry.type === "variable_patch");
        const attachment = staleTarget.entries.find((entry) => entry.type === "session_attachment");
        const assets = decodeSessionSchemaV1({
            sourcePath: "sessions/7.jsonl",
            text: assetsSource,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(stale.classification).toBe("stale_managed");
        expect(stale.currentProjectRoot).toBe("missing");
        expect(stale.stats.resetProfileReminders).toBe(2);
        expect(profileState).toEqual({reminders: {"linked-agents": {fingerprint: "keep"}}});
        expect(variablePatch?.operations).toEqual([
            {op: "replace", path: "/workspace", value: "missing"},
            {op: "replace", path: "/selectedFilePath", value: "manuscript/a.md"},
        ]);
        expect(attachment).toMatchObject({
            attachment: {id: `sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 12},
            name: "cover.png",
        });
        expect(assets.classification).toBe("user_assets");
        expect(assets.currentProjectRoot).toBeUndefined();
        expect(toolCalls(decodeTarget(assets.targetText).entries).get("call_assets")?.arguments)
            .toEqual({path: ".nbook/agent/skills/demo/SKILL.md"});
    });

    it("区分未提供 Project inventory 与已确认 inventory 为空", () => {
        const source = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/missing", workspaceKey: "workspace/missing"}),
            branch: [],
        });

        const unknownInventory = decodeSessionSchemaV1({
            sourcePath: "sessions/10.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const emptyInventory = decodeSessionSchemaV1({
            sourcePath: "sessions/10.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
            knownProjectRoots: [],
        });
        const matchingInventory = decodeSessionSchemaV1({
            sourcePath: "sessions/10.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
            knownProjectRoots: ["missing"],
        });

        expect(unknownInventory.classification).toBe("managed");
        expect(emptyInventory.classification).toBe("stale_managed");
        expect(matchingInventory.classification).toBe("managed");
    });

    it("按 tool discriminator 迁移 Plot、subject、Agent、Session、variable 与 bash results", () => {
        const source = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/story", workspaceKey: "workspace/story"}),
            branch: [
                assistantEntry([
                    toolCall("call_plot", "create_story_scene", {}),
                    toolCall("call_update", "update_story_scene", {}),
                    toolCall("call_subject_event", "subject_event_append", {
                        subjectPath: "story/simulation/hero",
                        events: [],
                    }),
                    toolCall("call_agents", "get_agent", {}),
                    toolCall("call_session", "get_session", {sessionId: 11}),
                    toolCall("call_variable", "variable_read", {namespace: "project", path: "scope"}),
                    toolCall("call_bash_output", "bash", {command: "large output"}),
                ]),
                toolResultEntry("call_plot", "create_story_scene", {
                    chapterPath: "story/manuscript/001.md",
                    title: "Scene",
                }),
                toolResultEntry("call_update", "update_story_scene", {
                    chapterPath: "workspace/story/manuscript/002.md",
                }),
                toolResultEntry("call_subject_event", "subject_event_append", {
                    subjectPath: "story/simulation/hero",
                    sourcePath: "story/simulation/hero/events.jsonl",
                }),
                toolResultEntry("call_agents", "get_agent", [
                    {sessionId: 11, profileKey: "director", workspaceRoot: "workspace/story", status: "idle"},
                    {sessionId: 12, profileKey: "leader.default", workspaceRoot: "workspace", status: "idle"},
                ]),
                toolResultEntry("call_session", "get_session", {
                    metadata: {
                        sessionId: 11,
                        profileKey: "director",
                        input: {defaultChapterPath: "story/manuscript/003.md"},
                        workspaceRoot: "workspace",
                        workspaceKey: "workspace/story",
                        projectPath: "workspace/story",
                        createdAt: MIGRATION_TIMESTAMP - 5_000,
                    },
                    activeLeafId: null,
                    linkedAgents: [
                        {sessionId: 13, profileKey: "writer", workspaceRoot: "workspace/story", status: "idle"},
                    ],
                }),
                toolResultEntry("call_variable", "variable_read", {
                    path: "scope.currentProject",
                    fingerprint: "abc",
                    value: "manuscript/not-a-file-address.md",
                }),
                toolResultEntry("call_bash_output", "bash", {
                    fullOutputPath: "C:\\Temp\\nbook-output.log",
                    truncation: {truncated: true},
                }),
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/11.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const results = toolResults(decodeTarget(plan.targetText).entries);
        const agents = results.get("call_agents")?.details;
        const session = objectValue(results.get("call_session")?.details);
        const sessionMetadata = objectValue(session?.metadata);

        expect(plan.reviewReasons).toEqual([]);
        expect(results.get("call_plot")?.details).toEqual({chapterPath: "manuscript/001.md", title: "Scene"});
        expect(results.get("call_update")?.details).toEqual({chapterPath: "manuscript/002.md"});
        expect(results.get("call_subject_event")?.details).toEqual({
            subjectPath: "simulation/hero",
            sourcePath: "simulation/hero/events.jsonl",
        });
        expect(agents).toEqual([
            {sessionId: 11, profileKey: "director", currentProjectRoot: "story", status: "idle"},
            {sessionId: 12, profileKey: "leader.default", status: "idle"},
        ]);
        expect(sessionMetadata).toEqual({
            sessionId: 11,
            profileKey: "director",
            initial: {defaultChapterPath: "manuscript/003.md"},
            currentProjectRoot: "story",
            schemaVersion: 2,
            createdAt: MIGRATION_TIMESTAMP - 5_000,
        });
        expect(session?.linkedAgents).toEqual([
            {sessionId: 13, profileKey: "writer", currentProjectRoot: "story", status: "idle"},
        ]);
        expect(results.get("call_variable")?.details).toEqual({
            path: "scope.currentProject",
            fingerprint: "abc",
            value: "manuscript/not-a-file-address.md",
        });
        expect(results.get("call_bash_output")?.details).toEqual({
            fullOutput: {state: "reclaimed"},
            truncation: {truncated: true},
        });
    });

    it("非法 apply_patch 只记录迁移警告，不阻断Project归属明确的Session", () => {
        const invalidPatch = [
            "*** Begin Patch",
            "*** Replace entire file: manuscript/a.md",
            "literal manuscript/a.md",
            "*** End Patch",
        ].join("\n");
        const source = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/story", workspaceKey: "workspace/story"}),
            branch: [
                assistantEntry([
                    {type: "text", text: "Do not rewrite manuscript/a.md in free text."},
                    toolCall("call_invalid_patch", "apply_patch", {patch: invalidPatch}),
                ]),
                toolResultEntry("call_invalid_patch", "apply_patch", {}),
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/8.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const target = decodeTarget(plan.targetText);
        const assistant = target.entries.find((entry) => objectValue(entry.message)?.role === "assistant");

        expect(plan.reviewReasons).toEqual([]);
        expect(plan.ambiguousLocations.some((location) => location.endsWith("arguments.patch"))).toBe(true);
        expect(stringValue(toolCalls(target.entries).get("call_invalid_patch")?.arguments, "patch")).toBe(invalidPatch);
        expect(JSON.stringify(assistant)).toContain("Do not rewrite manuscript/a.md in free text.");
    });

    it("保留nullable chapterPath，并让迁移entry沿用原active path活动时间", () => {
        const source = sessionText({
            metadata: legacyMetadata({projectPath: "workspace/story", workspaceKey: "workspace/story"}),
            branch: [
                assistantEntry([toolCall("call_chapter", "get_chapter_plot", {chapterPath: null})]),
                toolResultEntry("call_chapter", "get_chapter_plot", {chapterPath: null}),
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/105.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });
        const target = decodeTarget(plan.targetText);
        const migrationEntries = target.entries.filter((entry) => (
            typeof entry.id === "string" && entry.id.startsWith("session-v2-migration-")
        ));

        expect(plan.reviewReasons).toEqual([]);
        expect(toolCalls(target.entries).get("call_chapter")?.arguments).toEqual({chapterPath: null});
        expect(toolResults(target.entries).get("call_chapter")?.details).toEqual({chapterPath: null});
        expect(migrationEntries.every((entry) => entry.timestamp === MIGRATION_TIMESTAMP - 999)).toBe(true);
    });

    it("null initial 与失败调用留下的 primitive data 不制造路径 review", () => {
        const source = sessionText({
            metadata: legacyMetadata({profileKey: "workflow.demo", initial: null}),
            branch: [
                assistantEntry([
                    toolCall("call_report", "report_result", {result: "invalid", data: "literal/path.md"}),
                ]),
                toolResultEntry("call_report", "report_result", {}, "validation failed"),
            ],
        });

        const plan = decodeSessionSchemaV1({
            sourcePath: "sessions/9.jsonl",
            text: source,
            migrationTimestamp: MIGRATION_TIMESTAMP,
        });

        expect(plan.reviewReasons).toEqual([]);
        expect(decodeTarget(plan.targetText).metadata.initial).toBeNull();
        expect(toolCalls(decodeTarget(plan.targetText).entries).get("call_report")?.arguments)
            .toEqual({result: "invalid", data: "literal/path.md"});
    });
});

function legacyMetadata(overrides: FixtureObject = {}): FixtureObject {
    return {
        sessionId: 1,
        profileKey: "leader.default",
        initial: {},
        workspaceRoot: "workspace",
        workspaceKey: "global",
        createdAt: MIGRATION_TIMESTAMP - 10_000,
        ...overrides,
    };
}

function sessionText(input: {
    metadata: FixtureObject;
    branch: FixtureObject[];
    projections?: FixtureObject[];
}): string {
    const entries: FixtureObject[] = [];
    let parentId: string | null = null;
    for (const [index, draft] of input.branch.entries()) {
        const id = `branch_${String(index)}`;
        entries.push({...draft, id, parentId, timestamp: MIGRATION_TIMESTAMP - 1_000 + index});
        parentId = id;
    }
    entries.push({
        type: "leaf",
        id: "source_leaf",
        parentId,
        timestamp: MIGRATION_TIMESTAMP - 500,
        leafId: parentId,
        origin: "auto",
    });
    for (const [index, projection] of (input.projections ?? []).entries()) {
        entries.push({
            ...projection,
            id: `projection_${String(index)}`,
            parentId,
            timestamp: MIGRATION_TIMESTAMP - 400 + index,
        });
    }
    return [
        JSON.stringify({kind: "header", metadata: input.metadata}),
        JSON.stringify({kind: "batch", entries}),
        "",
    ].join("\n");
}

function assistantEntry(content: FixtureObject[]): FixtureObject {
    return {
        type: "message",
        origin: "harness",
        message: {
            role: "assistant",
            content,
            api: "test",
            provider: "test",
            model: "test",
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
            },
            stopReason: "toolUse",
            timestamp: MIGRATION_TIMESTAMP - 2_000,
        },
    };
}

function toolCall(id: string, name: string, args: FixtureObject): FixtureObject {
    return {type: "toolCall", id, name, arguments: args};
}

function toolResultEntry(toolCallId: string, toolName: string, details: FixtureNode, text = "ok"): FixtureObject {
    return {
        type: "message",
        origin: "harness",
        message: {
            role: "toolResult",
            toolCallId,
            toolName,
            content: [{type: "text", text}],
            details,
            isError: false,
            timestamp: MIGRATION_TIMESTAMP - 1_500,
        },
    };
}

function decodeTarget(text: string): {metadata: FixtureObject; entries: FixtureObject[]} {
    const records = text.trimEnd().split(/\r?\n/u).map((line) => {
        // JSON.parse 是测试 fixture 的外部边界；下方通过 objectValue 收窄。
        const value = JSON.parse(line) as FixtureNode;
        const record = objectValue(value);
        if (!record) {
            throw new Error("target record 不是 object");
        }
        return record;
    });
    const metadata = objectValue(records.find((record) => record.kind === "header")?.metadata);
    if (!metadata) {
        throw new Error("target 缺少 metadata");
    }
    const entries = records.flatMap((record) => {
        if (record.kind === "entry") {
            const entry = objectValue(record.entry);
            return entry ? [entry] : [];
        }
        if (record.kind !== "batch" || !Array.isArray(record.entries)) {
            return [];
        }
        return record.entries.flatMap((value) => {
            const entry = objectValue(value);
            return entry ? [entry] : [];
        });
    });
    return {metadata, entries};
}

function toolCalls(entries: FixtureObject[]): Map<string, {name: string; arguments: FixtureObject}> {
    const result = new Map<string, {name: string; arguments: FixtureObject}>();
    for (const entry of entries) {
        const message = objectValue(entry.message);
        if (message?.role !== "assistant" || !Array.isArray(message.content)) {
            continue;
        }
        for (const value of message.content) {
            const call = objectValue(value);
            const args = objectValue(call?.arguments);
            if (call?.type === "toolCall" && typeof call.id === "string" && typeof call.name === "string" && args) {
                result.set(call.id, {name: call.name, arguments: args});
            }
        }
    }
    return result;
}

function toolResults(entries: FixtureObject[]): Map<string, FixtureObject> {
    const result = new Map<string, FixtureObject>();
    for (const entry of entries) {
        const message = objectValue(entry.message);
        if (message?.role === "toolResult" && typeof message.toolCallId === "string") {
            result.set(message.toolCallId, message);
        }
    }
    return result;
}

function messageText(message: FixtureObject | undefined): string {
    if (!message || !Array.isArray(message.content)) {
        return "";
    }
    return message.content.flatMap((value) => {
        const block = objectValue(value);
        return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
    }).join("\n");
}

function stringValue(value: FixtureObject | undefined, key: string): string {
    const field = value?.[key];
    if (typeof field !== "string") {
        throw new Error(`${key} 不是 string`);
    }
    return field;
}

function objectValue(value: FixtureNode | undefined): FixtureObject | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
