import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import { testAbsoluteFsPath } from "@notnotype/neuro-book-test-support/test-path"
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import {
    projectWorkspacePathPolicy,
    type ProjectWorkspacePathConsumer,
} from "nbook/server/workspace-files/project-workspace-path-policy";

const workspaceRoot = absoluteFsPath(testHostPath("tmp", "path-policy"));
const ref = projectWorkspaceRef("project");
const workspace = resolvedProjectWorkspace(
    ref,
    absoluteFsPath(path.join(workspaceRoot, ref.projectRoot)),
    createProjectWorkspaceKey(workspaceRoot, ref),
);

describe("ProjectWorkspacePathPolicy", () => {
    it("普通 Project 内容由 File Index、History 与 Archive 正常消费", () => {
        const consumers: readonly ProjectWorkspacePathConsumer[] = ["file-index", "history", "archive"];

        for (const consumer of consumers) {
            expect(projectWorkspacePathPolicy({
                workspace,
                relativePath: "manuscript/第一章/index.md",
                consumer,
            })).toEqual({
                category: "content",
                disposition: "consume",
            });
        }
    });

    it("manifest recovery 对 Index/History 忽略但由 Archive 强制保留", () => {
        expect(projectWorkspacePathPolicy({
            workspace,
            relativePath: ".nbook/recovery/project-manifest-original.yaml",
            consumer: "file-index",
        })).toEqual({category: "recovery", disposition: "ignore"});
        expect(projectWorkspacePathPolicy({
            workspace,
            relativePath: ".nbook/recovery/project-manifest-original.yaml",
            consumer: "history",
        })).toEqual({category: "recovery", disposition: "ignore"});
        expect(projectWorkspacePathPolicy({
            workspace,
            relativePath: ".nbook/recovery/project-manifest-original.yaml",
            consumer: "archive",
        })).toEqual({category: "recovery", disposition: "preserve"});
    });

    it("可重建 runtime artifact 由三个消费者共同忽略", () => {
        const consumers: readonly ProjectWorkspacePathConsumer[] = ["file-index", "history", "archive"];

        for (const consumer of consumers) {
            expect(projectWorkspacePathPolicy({
                workspace,
                relativePath: ".nbook/runtime-artifact-import-cache/world-engine-schema/cache.mjs",
                consumer,
            })).toEqual({
                category: "rebuildable-runtime",
                disposition: "ignore",
            });
        }
    });

    it("精确 manifest/recovery transaction temp 由三个消费者共同忽略", () => {
        const tempName = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174000.tmp";
        const consumers: readonly ProjectWorkspacePathConsumer[] = ["file-index", "history", "archive"];

        for (const consumer of consumers) {
            for (const relativePath of [tempName, `.nbook/recovery/${tempName}`]) {
                expect(projectWorkspacePathPolicy({workspace, relativePath, consumer})).toEqual({
                    category: "lifecycle-temp",
                    disposition: "ignore",
                });
            }
        }
    });

    it("形似 transaction temp 的用户文件与宽泛 tmp 后缀仍按普通内容消费", () => {
        const paths = [
            "notes.tmp",
            "notes/.nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174000.tmp",
            ".nbook/recovery/project-manifest-original.yaml.tmp",
        ];

        for (const relativePath of paths) {
            const recovery = relativePath.startsWith(".nbook/recovery/");
            expect(projectWorkspacePathPolicy({
                workspace,
                relativePath,
                consumer: "archive",
            })).toEqual({
                category: recovery ? "recovery" : "content",
                disposition: recovery ? "preserve" : "consume",
            });
        }
    });

    it("拒绝绝对路径与越过当前 Project Workspace 的输入", () => {
        for (const relativePath of ["/outside.md", "../outside.md"]) {
            expect(() => projectWorkspacePathPolicy({
                workspace,
                relativePath,
                consumer: "file-index",
            })).toThrow("Project-relative path");
        }
    });
});

describe("ProjectWorkspacePathPolicy Storage 类别", () => {
    it.runIf(process.platform === "win32")("Windows 目录大小写不改变 Storage 的消费策略", () => {
        expect(projectWorkspacePathPolicy({workspace, relativePath: ".NBOOK/Storage/records/layout.json", consumer: "archive"}))
            .toEqual({category: "storage", disposition: "preserve"});
        expect(projectWorkspacePathPolicy({workspace, relativePath: ".NBOOK/Storage/.LOCKS/owner", consumer: "archive"}))
            .toEqual({category: "storage-runtime", disposition: "ignore"});
    });
    it("正式记录、墓碑、原件与身份域元数据由 Archive 保留，被 Index/History 忽略", () => {
        const storagePaths = [
            ".nbook/storage/identity.json",
            ".nbook/storage/records/shelf.json",

        ];
        for (const relativePath of storagePaths) {
            expect(projectWorkspacePathPolicy({workspace, relativePath, consumer: "file-index"})).toEqual({category: "storage", disposition: "ignore"});
            expect(projectWorkspacePathPolicy({workspace, relativePath, consumer: "history"})).toEqual({category: "storage", disposition: "ignore"});
            expect(projectWorkspacePathPolicy({workspace, relativePath, consumer: "archive"})).toEqual({category: "storage", disposition: "preserve"});
        }
        expect(projectWorkspacePathPolicy({
            workspace,
            relativePath: ".nbook/storage/quarantine/shelf.json.corrupt",
            consumer: "archive",
        })).toEqual({category: "storage", disposition: "preserve"});
    });

    it("分区锁与本模块同目录临时名对三个消费者都是 ignore", () => {
        const moduleTempName = "shelf.json.123e4567-e89b-12d3-a456-426614174000.tmp";
        for (const relativePath of [
            ".nbook/storage/.locks/identity-domain.lock",
            `.nbook/storage/records/${moduleTempName}`,
        ]) {
            for (const consumer of ["file-index", "history", "archive"] as const) {
                expect(projectWorkspacePathPolicy({workspace, relativePath, consumer}))
                    .toEqual({category: "storage-runtime", disposition: "ignore"});
            }
        }
    });

    it("同名 storage 普通目录按内容消费，手工 .tmp 仍属于 Storage 内容", () => {
        const content = {category: "content", disposition: "consume"} as const;
        expect(projectWorkspacePathPolicy({workspace, relativePath: "notes/storage/a.md", consumer: "archive"})).toEqual(content);
        expect(projectWorkspacePathPolicy({workspace, relativePath: "notes/storage/a.md", consumer: "file-index"})).toEqual(content);
        expect(projectWorkspacePathPolicy({
            workspace,
            relativePath: ".nbook/storage/records/manual.tmp",
            consumer: "archive",
        })).toEqual({category: "storage", disposition: "preserve"});
    });
});
