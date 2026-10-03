import fs from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {readProjectCover} from "nbook/server/workspace-files/project-cover";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectLifecycle} from "nbook/server/workspace-files/project-lifecycle";

const roots: string[] = [];
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("Project cover", () => {
    it("Lifecycle 投影合法封面，并把非法封面降级为未设置", async () => {
        const workspaceRoot = await createWorkspace();
        await createProject(workspaceRoot, "with-cover", "assets/cover.webp");
        await createProject(workspaceRoot, "invalid-cover", "../cover.png");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const snapshot = await lifecycle.readProjects();
            expect(snapshot.projects.find((project) => project.projectRoot === "with-cover"))
                .toMatchObject({cover: "assets/cover.webp"});
            expect(snapshot.projects.find((project) => project.projectRoot === "invalid-cover"))
                .not.toHaveProperty("cover");
        } finally {
            await lifecycle.close();
        }
    });

    it("读取 Project 内图片并按内容生成 MIME 与 ETag", async () => {
        const workspaceRoot = await createWorkspace();
        await createProject(workspaceRoot, "book", "art/cover.png");
        await fs.mkdir(path.join(workspaceRoot, "book", "art"), {recursive: true});
        await fs.writeFile(path.join(workspaceRoot, "book", "art", "cover.png"), PNG_HEADER);

        const cover = await readProjectCover(
            absoluteFsPath(workspaceRoot),
            projectWorkspaceRef("book"),
            "art/cover.png",
        );

        expect(cover.mimeType).toBe("image/png");
        expect(cover.bytes).toEqual(PNG_HEADER);
        expect(cover.etag).toMatch(/^"[0-9a-f]{64}"$/u);
    });

    it("拒绝扩展名与图片魔数不一致的内容", async () => {
        const workspaceRoot = await createWorkspace();
        await createProject(workspaceRoot, "book", "cover.webp");
        await fs.writeFile(path.join(workspaceRoot, "book", "cover.webp"), PNG_HEADER);

        await expect(readProjectCover(
            absoluteFsPath(workspaceRoot),
            projectWorkspaceRef("book"),
            "cover.webp",
        )).rejects.toMatchObject({code: "PROJECT_COVER_CORRUPT"});
    });
});

/** 建立隔离 Workspace Root。 */
async function createWorkspace(): Promise<string> {
    const root = await fs.mkdtemp(testHostPath("nbook-project-cover-"));
    roots.push(root);
    return root;
}

/** 写入最小 Project manifest；封面文件由各用例决定。 */
async function createProject(workspaceRoot: string, projectRoot: string, cover: string): Promise<void> {
    const root = path.join(workspaceRoot, projectRoot);
    await fs.mkdir(root, {recursive: true});
    await fs.writeFile(
        path.join(root, "project.yaml"),
        ["kind: novel", `title: ${projectRoot}`, 'summary: ""', `cover: ${cover}`, ""].join("\n"),
        "utf8",
    );
}
