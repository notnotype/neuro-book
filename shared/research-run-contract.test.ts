import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {
    parseResearchRunManifest,
    writeResearchRunManifest,
    type ResearchRunManifest,
} from "nbook/shared/research-run-contract";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Research Run Manifest", () => {
    it("合法回执使用同目录临时文件原子写入", async () => {
        const root = await tempRoot();
        const path = resolve(root, "evidence", "manifest.json");
        const manifest = fixture();

        await writeResearchRunManifest(path, manifest);

        expect(parseResearchRunManifest(JSON.parse(await readFile(path, "utf8")))).toEqual(manifest);
        const entries = await readdir(resolve(root, "evidence"));
        expect(entries).toEqual(["manifest.json"]);
    });

    it("拒绝缺 schema、坏枚举和越界端口", () => {
        const manifest = fixture();
        const withoutSchema = {...manifest} as Record<string, unknown>;
        delete withoutSchema.schema;
        expect(() => parseResearchRunManifest(withoutSchema)).toThrow(/schema/iu);
        expect(() => parseResearchRunManifest({...manifest, result: {...manifest.result, status: "wat"}})).toThrow(/result.status/iu);
        expect(() => parseResearchRunManifest({...manifest, service: {...manifest.service, port: 65_536}})).toThrow(/service.port/iu);
    });

    it("拒绝 token 字段，序列化回执不携带秘密", async () => {
        const root = await tempRoot();
        const token = "a".repeat(43);
        const withToken = {...fixture(), shutdownToken: token} as unknown;

        expect(() => parseResearchRunManifest(withToken)).toThrow(/字段不匹配/iu);
        const path = resolve(root, "manifest.json");
        await writeResearchRunManifest(path, fixture());
        expect(await readFile(path, "utf8")).not.toContain(token);
    });

    it("cleanup 失败时不能声称 passed", () => {
        const manifest = fixture();
        expect(() => parseResearchRunManifest({
            ...manifest,
            cleanup: {...manifest.cleanup, portClosed: false},
        })).toThrow(/不能把 Research Run 标为 passed/iu);
    });

    it("viewport 截图必须是 evidence 根下的相对文件", () => {
        const manifest = fixture();
        expect(() => parseResearchRunManifest({
            ...manifest,
            browser: {
                ...manifest.browser,
                viewports: [{...manifest.browser.viewports[0], screenshot: "../outside.png"}],
            },
        })).toThrow(/evidence 根下/iu);
    });

    it("允许环境阻塞时明确记录未提供的浏览器", () => {
        const manifest = fixture();
        expect(parseResearchRunManifest({
            ...manifest,
            browser: {...manifest.browser, executable: null},
            service: {...manifest.service, productAttempt: "not-attempted"},
            cleanup: {...manifest.cleanup, service: "not-started"},
            result: {status: "environment-blocked", reason: "browser unavailable"},
        }).browser.executable).toBeNull();
    });
});

function fixture(): ResearchRunManifest {
    return {
        schema: "nbook.repository-research-run/v1",
        runId: "run-001",
        adapter: "neuro-book-plot-workbench",
        startedAt: "2026-08-14T10:00:00.000Z",
        finishedAt: "2026-08-14T10:01:00.000Z",
        repository: {
            root: resolve("C:/repo/neuro-book"),
            revision: "306e563a",
            dirty: true,
        },
        service: {
            mode: "source-dev",
            url: "http://127.0.0.1:43190",
            port: 43190,
            expectedVersion: "0.9.5-canary",
            startupNoncePresent: true,
            productAttempt: "unavailable",
            fallbackReason: "verified Product image unavailable",
        },
        browser: {
            executable: resolve("C:/Program Files/Edge/msedge.exe"),
            viewports: [
                {width: 1440, height: 1000, screenshot: "plot-workbench-desktop.png", horizontalOverflow: false},
                {width: 390, height: 844, screenshot: "plot-workbench-mobile.png", horizontalOverflow: true},
            ],
            consoleErrors: 0,
            pageErrors: 0,
        },
        evidence: {
            files: ["plot-workbench-desktop.png", "plot-workbench-mobile.png", "manifest.json"],
            mediaFiles: [resolve("C:/Users/notnotype/.hermes/cache/images/run-001-desktop.png")],
        },
        cleanup: {
            browser: "closed",
            service: "graceful",
            portClosed: true,
            ownedTempRootsRemoved: true,
            sharedCachePreserved: true,
        },
        result: {status: "passed"},
    };
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-research-contract-"));
    roots.push(root);
    return root;
}
