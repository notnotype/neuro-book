import {mkdir, readFile, rm, unlink, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionEntryDraft} from "nbook/server/agent/session/types";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {compileVariableDefinitions, loadCompiledVariableDefinitions, readVariableDefinitionManifest, validateVariableDefinitionArtifact} from "nbook/server/agent/variables/definition-artifact";
import {generateVariableTypes} from "nbook/server/agent/variables/generated-types";
import {applyVariableJsonPatch} from "nbook/server/agent/variables/json-patch";
import {defineClientVariable, defineProjectVariable, defineSessionVariable, defineWorkspaceRootVariable, VariableRegistry} from "nbook/server/agent/variables/registry";
import {createVariableTools} from "nbook/server/agent/variables/tools";
import type {VariableInvocationState} from "nbook/server/agent/variables/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

describe("Agent variable system", () => {
    it("未绑定Project的Session始终使用Workspace Root存储global变量", async () => {
        const workspaceRoot = resolve(".agent", "tmp", "variable-global-root-test", randomUUID());
        await mkdir(workspaceRoot, {recursive: true});
        try {
            const repo = new JsonlSessionRepository(workspaceRoot);
            const snapshot = await repo.createSession({
                profileKey: "test.vars",
                initial: {},
            });
            const registry = new VariableRegistry([defineWorkspaceRootVariable({
                key: "preferences",
                schema: Type.Object({theme: Type.String()}),
                default: {theme: "light"},
                writableBy: ["agent"],
            })]);
            const accessor = createProfileVariableAccessor({repo, snapshot, registry});

            await accessor.read("global.preferences");
            const result = await accessor.patch("global", "preferences", [{op: "replace", path: "", value: {theme: "dark"}}]);

            expect(result.issue).toBeUndefined();
            const stored = await readFile(resolve(workspaceRoot, ".nbook", "agent", "variables.json"), "utf-8");
            expect(stored).toContain('"theme": "dark"');
        } finally {
            await rm(workspaceRoot, {recursive: true, force: true});
        }
    });

    it("VariableCatalog 顶层直接暴露四类变量根", () => {
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);

        const catalog = registry.catalog({namespace: "project"});

        expect(catalog).toHaveProperty("clientVariables");
        expect(catalog).toHaveProperty("globalVariables");
        expect(catalog).toHaveProperty("projectVariables");
        expect(catalog.projectVariables.affections).toEqual(expect.objectContaining({
            $ref: "#/projectVariables/affections",
            readable: true,
            writableByAgent: true,
        }));
        expect(catalog).not.toHaveProperty("namespaces");
    });

    it("JSON Patch 支持空 path 完整替换 target", () => {
        const result = applyVariableJsonPatch({score: 1}, [{
            op: "replace",
            path: "",
            value: {score: 2},
        }]);

        expect(result).toEqual({score: 2});
    });

    it("variable_schema 支持按子路径返回推导后的 schema", () => {
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);

        const result = registry.query({
            paths: ["project.affections.alice"],
            detail: true,
        });

        expect(result.schemas[0]).toEqual(expect.objectContaining({
            path: "project.affections.alice",
            key: "affections.alice",
            writableByAgent: true,
        }));
        expect(result.schemas[0]?.schema).toEqual(expect.objectContaining({
            type: "number",
        }));
    });

    it("变量类型生成器把 TypeBox 常用子集映射为 TS 类型", () => {
        const generated = generateVariableTypes([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
            }),
            defineSessionVariable({
                key: "draft",
                schema: Type.Object({
                    title: Type.String(),
                    done: Type.Optional(Type.Boolean()),
                    tags: Type.Array(Type.String()),
                    mode: Type.Union([Type.Literal("fast"), Type.Literal("slow"), Type.Null()]),
                }),
            }),
        ]);

        expect(generated.text).toContain("\"project.affections\": Record<string, number>;");
        expect(generated.text).toContain("\"session.draft\": {\"title\": string; \"done\"?: boolean; \"tags\": Array<string>; \"mode\": \"fast\" | \"slow\" | null};");
        expect(generated.diagnostics).toEqual([]);
    });

    it("读取子路径时会使用注册根 default 的子字段", async () => {
        const root = resolve(".agent", "tmp", "variable-default-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const registry = new VariableRegistry([
            defineClientVariable({
                key: "ide",
                schema: Type.Object({
                    fontFamily: Type.String(),
                }),
                default: {
                    fontFamily: "monospace",
                },
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });

            await expect(accessor.get("client.ide.fontFamily")).resolves.toBe("monospace");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("session variable_patch 跟随 active path reduce", async () => {
        const root = resolve(".agent", "tmp", "variable-session-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });

            await accessor.patch("session", "affections", [{
                op: "replace",
                path: "",
                value: {alice: 1},
            }]);
            const nextSnapshot = await repo.readSession(snapshot.metadata.sessionId);
            const nextAccessor = createProfileVariableAccessor({
                repo,
                snapshot: nextSnapshot,
                registry,
            });

            await expect(nextAccessor.get("session.affections.alice")).resolves.toBe(1);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("patch 后值不符合注册 schema 时阻塞写入", async () => {
        const root = resolve(".agent", "tmp", "variable-schema-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
            });

            const result = await accessor.patch("session", "affections", [{
                op: "replace",
                path: "",
                value: {alice: "high"},
            }]);

            expect(result.issue).toEqual(expect.objectContaining({
                code: "schema_mismatch",
                path: "session.affections",
            }));
            await expect(accessor.get("session.affections")).resolves.toBeUndefined();
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("变量文件 JSON 损坏时返回 storage_error，而不是 not_registered", async () => {
        const root = resolve(".agent", "tmp", "variable-storage-error-test", randomUUID());
        const projectRoot = resolve(root, "project-a");
        await mkdir(resolve(projectRoot, ".nbook", "agent"), {recursive: true});
        await writeFile(resolve(projectRoot, ".nbook", "agent", "variables.json"), "{ broken", "utf8");
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                currentProject: readyProject(projectRoot),
                clientState: {
                    studio: {workspace: "workspace/project-b"},
                },
            });

            const result = await accessor.read("project.affections");

            expect(result.issue).toEqual(expect.objectContaining({
                code: "storage_error",
                path: "project.affections",
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("project.* 固定使用invocation捕获的Current Project，client overlay不能重绑定", async () => {
        const root = resolve(".agent", "tmp", "variable-project-capture-test", randomUUID());
        const projectA = resolve(root, "project-a");
        const projectB = resolve(root, "project-b");
        await Promise.all([
            writeVariableFixture(projectA, {scope: "project-a"}),
            writeVariableFixture(projectB, {scope: "project-b"}),
        ]);
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const currentProject = readyProject(projectA);
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {
                studio: {workspace: "workspace/project-b"},
                currentProjectWorkspace: "workspace/project-b",
            },
            currentProject,
        };
        const registry = new VariableRegistry([defineProjectVariable({
            key: "scope",
            schema: Type.String(),
            writableBy: ["agent"],
        })]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
            });

            await expect(accessor.read("project.scope")).resolves.toMatchObject({value: "project-a"});
            await expect(accessor.patch("project", "scope", [{
                op: "replace",
                path: "",
                value: "project-a-next",
            }])).resolves.toMatchObject({value: "project-a-next"});

            await expect(readFile(resolve(projectA, ".nbook", "agent", "variables.json"), "utf8"))
                .resolves.toContain("project-a-next");
            await expect(readFile(resolve(projectB, ".nbook", "agent", "variables.json"), "utf8"))
                .resolves.toContain("project-b");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("variable_patch schema mismatch 会抛错，交给 harness 生成 error tool result", async () => {
        const root = resolve(".agent", "tmp", "variable-tool-error-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const vars = createProfileVariableAccessor({
            repo,
            snapshot,
            registry: new VariableRegistry([
                defineSessionVariable({
                    key: "affections",
                    schema: Type.Record(Type.String(), Type.Number()),
                    writableBy: ["agent"],
                }),
            ]),
        });
        try {
            const patchTool = createVariableTools().find((tool) => tool.key === "variable_patch");
            await expect(patchTool?.executeWithContext?.({
                harness: null as never,
                sessionId: snapshot.metadata.sessionId,
                profileKey: "leader.default",
                workspaceRoot: absoluteFsPath(root),
                currentProject: null,
                vars,
            }, "tool-1", {
                namespace: "session",
                path: "affections",
                patch: [{op: "replace", path: "", value: {alice: "high"}}],
            })).rejects.toThrow("不符合注册 schema");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("Agent patch 必须先在同一 invocation 读取变量", async () => {
        const root = resolve(".agent", "tmp", "variable-read-before-patch-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {},
            currentProject: null,
        };
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                default: {},
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
            });

            const blocked = await accessor.patch("session", "affections", [{
                op: "add",
                path: "/alice",
                value: 1,
            }]);
            expect(blocked.issue).toEqual(expect.objectContaining({
                code: "stale_read_required",
            }));

            const read = await accessor.read("session.affections");
            expect(read.fingerprint).toBeTruthy();
            const patched = await accessor.patch("session", "affections", [{
                op: "add",
                path: "/alice",
                value: 1,
            }]);

            expect(patched.issue).toBeUndefined();
            expect(patched.value).toEqual({alice: 1});
            expect(variableState.readFingerprints.get("session.affections")).toBe(patched.fingerprint);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("client.* patch ack 后同一 invocation 的新 accessor 能 read-after-write", async () => {
        const root = resolve(".agent", "tmp", "variable-client-overlay-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {
                ide: {
                    theme: "light",
                },
            },
            currentProject: null,
        };
        const registry = new VariableRegistry([
            defineClientVariable({
                key: "ide",
                schema: Type.Record(Type.String(), Type.Unknown()),
                writableBy: ["agent", "frontend"],
            }),
        ]);
        try {
            const firstAccessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
                onClientPatch: async () => ({
                    namespace: "client",
                    path: "ide.theme",
                    operations: [{op: "replace", path: "", value: "dark"}],
                    appliedValue: "dark",
                    invocationId: "invoke-1",
                    toolCallId: "tool-1",
                }),
            });

            await firstAccessor.read("client.ide.theme");
            const patched = await firstAccessor.patch("client", "ide.theme", [{
                op: "replace",
                path: "",
                value: "dark",
            }], "agent", "tool-1");
            expect(patched.value).toBe("dark");

            const secondAccessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
            });

            await expect(secondAccessor.get("client.ide.theme")).resolves.toBe("dark");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("global/project 变量文件已写但 audit 失败时返回明确半提交错误", async () => {
        const root = resolve(".agent", "tmp", "variable-audit-failure-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const brokenRepo = Object.create(repo) as JsonlSessionRepository;
        brokenRepo.appendEntry = async (_sessionId: number, _input: SessionEntryDraft) => {
            throw new Error("audit disk full");
        };
        const variableState: VariableInvocationState = {
            readFingerprints: new Map(),
            clientOverlay: {},
            currentProject: null,
        };
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                default: {},
                writableBy: ["agent"],
            }),
        ]);
        const projectRoot = resolve(root, "project-a");
        await mkdir(projectRoot, {recursive: true});
        const currentProject = readyProject(projectRoot);
        variableState.currentProject = currentProject;
        variableState.clientOverlay = {
            studio: {workspace: "workspace/project-b"},
            currentProjectWorkspace: "workspace/project-b",
        };
        try {
            const accessor = createProfileVariableAccessor({
                repo: brokenRepo,
                snapshot,
                registry,
                invocationId: "invoke-1",
                variableState,
                clientState: {
                    studio: {workspace: "workspace/project-b"},
                },
            });

            await accessor.read("project.affections");
            const result = await accessor.patch("project", "affections", [{
                op: "replace",
                path: "",
                value: {alice: 1},
            }], "agent", "tool-1");

            expect(result.issue).toEqual(expect.objectContaining({
                code: "storage_error",
                message: expect.stringContaining("变量文件已经写入，但 session audit entry 写入失败"),
            }));
            const confirmAccessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                currentProject,
                clientState: {
                    studio: {workspace: "workspace/project-b"},
                },
            });
            await expect(confirmAccessor.get("project.affections.alice")).resolves.toBe(1);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("variable_schema 不被无关 namespace 的 definition issue 阻塞", async () => {
        const schemaTool = createVariableTools().find((tool) => tool.key === "variable_schema");
        const registry = new VariableRegistry([
            defineSessionVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
            }),
        ], [{
            code: "compile_stale",
            path: "project.definitions.ts",
            message: "project definition 已过期",
        }]);
        const root = resolve(".agent", "tmp", "variable-schema-issue-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        try {
            const vars = createProfileVariableAccessor({repo, snapshot, registry});
            const result = await schemaTool?.executeWithContext?.({
                harness: null as never,
                sessionId: snapshot.metadata.sessionId,
                profileKey: "leader.default",
                workspaceRoot: absoluteFsPath(root),
                currentProject: null,
                vars,
            }, "tool-1", {namespace: "session"});
            expect(result?.details).toEqual(expect.objectContaining({issues: []}));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("project.* 缺少本轮 Project Workspace 时返回 unavailable", async () => {
        const root = resolve(".agent", "tmp", "variable-project-test", randomUUID());
        await mkdir(root, {recursive: true});
        const repo = new JsonlSessionRepository(root);
        const snapshot = await repo.createSession({
            profileKey: "test.vars",
            initial: {},
        });
        const registry = new VariableRegistry([
            defineProjectVariable({
                key: "affections",
                schema: Type.Record(Type.String(), Type.Number()),
                writableBy: ["agent"],
            }),
        ]);
        try {
            const accessor = createProfileVariableAccessor({
                repo,
                snapshot,
                registry,
                clientState: {
                    studio: {},
                },
            });

            const result = await accessor.read("project.affections");

            expect(result.issue).toEqual(expect.objectContaining({
                code: "unavailable",
                path: "project.affections",
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("Workspace Root / Project definition 只加载 hash 匹配的 .compiled artifact", async () => {
        const root = resolve(".agent", "tmp", "variable-definition-test", randomUUID());
        await mkdir(root, {recursive: true});
        const definitionPath = resolve(root, "definitions.ts");
        await writeFile(definitionPath, [
            "import {Type, defineProjectVariable} from \"nbook/variable-sdk\";",
            "export const definitions = [defineProjectVariable({",
            "    key: \"affections\",",
            "    schema: Type.Record(Type.String(), Type.Number()),",
            "    writableBy: [\"agent\"],",
            "})];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        try {
            await compileVariableDefinitions({definitionRoot: root});
            const manifest = await readVariableDefinitionManifest(root);
            const item = manifest.definitions[0]!;
            const typeFileName = item.typeFileName;
            expect(item.artifactFileName).toMatch(/^artifacts\/[a-f0-9]{64}\.mjs$/u);
            expect(typeFileName).toMatch(/^artifacts\/[a-f0-9]{64}\.types\.d\.ts$/u);
            expect(await readFile(resolve(root, ".compiled", typeFileName!), "utf8")).toContain("\"project.affections\": Record<string, number>;");
            await unlink(resolve(root, ".compiled", typeFileName!));
            await expect(validateVariableDefinitionArtifact(root, item)).resolves.toEqual({fresh: true});
            const loaded = await loadCompiledVariableDefinitions({definitionRoot: root, namespace: "project"});

            expect(loaded.issues).toEqual([]);
            expect(loaded.definitions.map((definition) => `${definition.namespace}.${definition.key}`)).toContain("project.affections");

            const source = await readFile(definitionPath, "utf8");
            await writeFile(definitionPath, source.replace("affections", "relationships"), "utf8");
            const stale = await loadCompiledVariableDefinitions({definitionRoot: root, namespace: "project"});

            expect(stale.definitions).toEqual([]);
            expect(stale.issues[0]).toEqual(expect.objectContaining({
                code: "compile_stale",
                path: "project.definitions.ts",
            }));
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("variable definition full compile 使用内容寻址文件名且不读取旧固定产物", async () => {
        const root = resolve(".agent", "tmp", "variable-definition-prune-test", randomUUID());
        await mkdir(resolve(root, ".compiled"), {recursive: true});
        await writeFile(resolve(root, "definitions.ts"), [
            "import {Type, defineWorkspaceRootVariable} from \"nbook/variable-sdk\";",
            "export const definitions = [defineWorkspaceRootVariable({",
            "    key: \"styleGuide\",",
            "    schema: Type.String(),",
            "})];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        await writeFile(resolve(root, ".compiled", "old-hash-artifact.mjs"), "export const definitions = [];", "utf8");
        await writeFile(resolve(root, ".compiled", "old-hash-artifact.types.d.ts"), "export {};", "utf8");
        try {
            const manifest = await compileVariableDefinitions({definitionRoot: root});
            const item = manifest.definitions[0]!;

            expect(item.artifactFileName).toMatch(/^artifacts\/[a-f0-9]{64}\.mjs$/u);
            expect(item.typeFileName).toMatch(/^artifacts\/[a-f0-9]{64}\.types\.d\.ts$/u);
            await expect(readFile(resolve(root, ".compiled", "old-hash-artifact.mjs"), "utf8")).resolves.toContain("definitions");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("variable definition manifest 未变化时保留 generatedAt", async () => {
        const root = resolve(".agent", "tmp", "variable-definition-generated-at-test", randomUUID());
        const definitionPath = resolve(root, "definitions.ts");
        const manifestPath = resolve(root, ".compiled", "manifest.json");
        await mkdir(root, {recursive: true});
        await writeFile(definitionPath, [
            "import {Type, defineWorkspaceRootVariable} from \"nbook/variable-sdk\";",
            "export const definitions = [defineWorkspaceRootVariable({",
            "    key: \"styleGuide\",",
            "    schema: Type.String(),",
            "})];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        try {
            const first = await compileVariableDefinitions({definitionRoot: root});
            const pinned = {
                ...first,
                generatedAt: "2000-01-01T00:00:00.000Z",
            };
            await writeFile(manifestPath, `${JSON.stringify(pinned, null, 2)}\n`, "utf8");

            const unchanged = await compileVariableDefinitions({definitionRoot: root});
            expect(unchanged.generatedAt).toBe(pinned.generatedAt);

            const source = await readFile(definitionPath, "utf8");
            await writeFile(definitionPath, source.replace("Type.String()", "Type.Number()"), "utf8");
            const changed = await compileVariableDefinitions({definitionRoot: root});

            expect(changed.generatedAt).not.toBe(pinned.generatedAt);
            expect(changed.definitions[0]?.sourceSha256).not.toBe(first.definitions[0]?.sourceSha256);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 15_000);

    it("skipFresh 会在 type artifact 缺失时重新编译 variable definition", async () => {
        const root = resolve(".agent", "tmp", "variable-definition-skip-type-test", randomUUID());
        const definitionPath = resolve(root, "definitions.ts");
        await mkdir(root, {recursive: true});
        await writeFile(definitionPath, [
            "import {Type, defineProjectVariable} from \"nbook/variable-sdk\";",
            "export const definitions = [defineProjectVariable({",
            "    key: \"styleGuide\",",
            "    schema: Type.String(),",
            "})];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        try {
            const first = await compileVariableDefinitions({definitionRoot: root});
            const firstItem = first.definitions[0]!;
            await rm(resolve(root, ".compiled", firstItem.typeFileName!), {force: true});

            const next = await compileVariableDefinitions({definitionRoot: root, skipFresh: true});
            const nextItem = next.definitions[0]!;

            await expect(readFile(resolve(root, ".compiled", nextItem.typeFileName!), "utf8")).resolves.toContain("ProfileVariableValueMap");
            await expect(validateVariableDefinitionArtifact(root, nextItem)).resolves.toEqual({fresh: true});
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    }, 15_000);

    it("只读 Product variable definition 新鲜时零写入，过期时要求重建", async () => {
        const root = resolve(".agent", "tmp", "variable-definition-readonly-test", randomUUID());
        const stagingRoot = resolve(root, "runtime-staging");
        const definitionPath = resolve(root, "definitions.ts");
        const manifestPath = resolve(root, ".compiled", "manifest.json");
        await mkdir(root, {recursive: true});
        await writeFile(definitionPath, [
            "import {Type, defineProjectVariable} from \"nbook/variable-sdk\";",
            "export const definitions = [defineProjectVariable({",
            "    key: \"styleGuide\",",
            "    schema: Type.String(),",
            "})];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        try {
            await compileVariableDefinitions({definitionRoot: root, stagingRoot});
            await rm(stagingRoot, {recursive: true, force: true});
            const manifestBefore = await readFile(manifestPath, "utf8");

            const fresh = await compileVariableDefinitions({
                definitionRoot: root,
                skipFresh: true,
                writePolicy: "forbid",
                stagingRoot,
            });
            expect(fresh.definitions).toHaveLength(1);
            await expect(readFile(stagingRoot, "utf8")).rejects.toThrow();
            expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);

            await writeFile(definitionPath, (await readFile(definitionPath, "utf8")).replace("Type.String()", "Type.Number()"), "utf8");
            await expect(compileVariableDefinitions({
                definitionRoot: root,
                skipFresh: true,
                writePolicy: "forbid",
                stagingRoot,
            })).rejects.toThrow("请重新构建或安装与源码匹配的 Product");
            await expect(readFile(stagingRoot, "utf8")).rejects.toThrow();
            expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("Product variable definition只记录.output/server自包含依赖", async () => {
        const productRoot = resolve(".agent", "tmp", "variable-product-context-test", randomUUID());
        const outputRoot = join(productRoot, ".output", "server");
        const authoringRoot = join(outputRoot, "authoring");
        const definitionRoot = join(outputRoot, "assets", "workspace", ".nbook", "agent", "variables");
        await Promise.all([
            mkdir(definitionRoot, {recursive: true}),
            mkdir(authoringRoot, {recursive: true}),
        ]);
        await writeFile(join(productRoot, "package.json"), '{"name":"neuro-book-product","type":"module"}\n', "utf8");
        await writeFile(join(outputRoot, "index.mjs"), "", "utf8");
        await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output","type":"module"}\n', "utf8");
        await writeFile(join(authoringRoot, "package.json"), '{"name":"@notnotype/neuro-book-profile-authoring-kit","private":true,"type":"module"}\n', "utf8");
        await writeFile(join(authoringRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(authoringRoot, "profile-compile-worker.mjs"), "export {};\n", "utf8");
        await writeFile(join(definitionRoot, "definitions.ts"), [
            "export const definitions = [{",
            '    namespace: "project",',
            '    key: "styleGuide",',
            '    schema: {type: "string"},',
            "}];",
            "export default definitions;",
            "",
        ].join("\n"), "utf8");
        const previousCwd = process.cwd();
        const previousImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
        const previousProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD;
        try {
            process.chdir(productRoot);
            process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(productRoot, ".output");
            process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
            const manifest = await compileVariableDefinitions({
                definitionRoot,
                rootLabel: "assets/workspace/.nbook/agent/variables",
            });
            const item = manifest.definitions[0]!;

            expect(item.dependencies.every((dependency) => dependency.path.startsWith(".output/server/"))).toBe(true);
            await expect(validateVariableDefinitionArtifact(definitionRoot, item, {requireTypeArtifact: true})).resolves.toEqual({fresh: true});
        } finally {
            if (previousImageRoot === undefined) delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
            else process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = previousImageRoot;
            if (previousProductBuild === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
            else process.env.NEURO_BOOK_PRODUCT_BUILD = previousProductBuild;
            process.chdir(previousCwd);
            await rm(productRoot, {recursive: true, force: true});
        }
    });

    it("不同物理 Product root 生成相同 variable artifact", async () => {
        const roots = [
            resolve(".agent", "tmp", "variable-product-determinism-a", randomUUID()),
            resolve(".agent", "tmp", "variable-product-determinism-b", randomUUID()),
        ];
        const previousCwd = process.cwd();
        const previousImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
        const previousProductBuild = process.env.NEURO_BOOK_PRODUCT_BUILD;
        const results: Array<{artifact: string; manifest: string}> = [];
        try {
            for (const productRoot of roots) {
                const outputRoot = join(productRoot, ".output", "server");
                const authoringRoot = join(outputRoot, "authoring");
                const definitionRoot = join(outputRoot, "assets", "workspace", ".nbook", "agent", "variables");
                await Promise.all([
                    mkdir(definitionRoot, {recursive: true}),
                    mkdir(authoringRoot, {recursive: true}),
                ]);
                await writeFile(join(productRoot, "package.json"), '{"name":"neuro-book-product","type":"module"}\n', "utf8");
                await writeFile(join(outputRoot, "index.mjs"), "", "utf8");
                await writeFile(join(outputRoot, "package.json"), '{"name":"neuro-book-output","type":"module"}\n', "utf8");
                await writeFile(join(authoringRoot, "package.json"), '{"name":"@notnotype/neuro-book-profile-authoring-kit","private":true,"type":"module"}\n', "utf8");
                await writeFile(join(authoringRoot, "tsconfig.json"), "{}\n", "utf8");
                await writeFile(join(authoringRoot, "profile-compile-worker.mjs"), "export {};\n", "utf8");
                await writeFile(join(definitionRoot, "definitions.ts"), [
                    "export const definitions = [{",
                    '    namespace: "project",',
                    '    key: "styleGuide",',
                    '    schema: {type: "string"},',
                    "}];",
                    "export default definitions;",
                    "",
                ].join("\n"), "utf8");
                process.chdir(productRoot);
                process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(productRoot, ".output");
                process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
                const manifest = await compileVariableDefinitions({
                    definitionRoot,
                    rootLabel: "assets/workspace/.nbook/agent/variables",
                    manifestGeneratedAt: new Date(0).toISOString(),
                });
                results.push({
                    artifact: await readFile(join(definitionRoot, ".compiled", ...manifest.definitions[0]!.artifactFileName.split("/")), "utf8"),
                    manifest: await readFile(join(definitionRoot, ".compiled", "manifest.json"), "utf8"),
                });
                expect(manifest.generatedAt).toBe("1970-01-01T00:00:00.000Z");
                process.chdir(previousCwd);
            }

            expect(results[0]).toEqual(results[1]);
            expect(results[0]?.artifact).not.toContain("variable-product-determinism-");
        } finally {
            if (previousImageRoot === undefined) delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
            else process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = previousImageRoot;
            if (previousProductBuild === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
            else process.env.NEURO_BOOK_PRODUCT_BUILD = previousProductBuild;
            process.chdir(previousCwd);
            await Promise.all(roots.map((root) => rm(root, {recursive: true, force: true})));
        }
    });
});

/** 把临时一级目录包装成与ProjectSession相同的ready identity。 */
function readyProject(projectRoot: string): ReadyProjectSessionRef {
    const root = absoluteFsPath(projectRoot);
    const workspaceRoot = absoluteFsPath(dirname(projectRoot));
    const ref = projectWorkspaceRef(basename(projectRoot));
    return Object.freeze({
        workspace: resolvedProjectWorkspace(
            ref,
            root,
            createProjectWorkspaceKey(workspaceRoot, ref),
        ),
        generation: 1,
    });
}

/** 写入一个最小Project变量文件。 */
async function writeVariableFixture(projectRoot: string, variables: Record<string, string>): Promise<void> {
    const variableRoot = resolve(projectRoot, ".nbook", "agent");
    await mkdir(variableRoot, {recursive: true});
    await writeFile(resolve(variableRoot, "variables.json"), `${JSON.stringify({
        schemaVersion: 1,
        variables,
    }, null, 2)}\n`, "utf8");
}
