import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {
    parseResearchRunManifest,
    parseResearchVisionPlan,
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

describe("Research Run annotation contract", () => {
    it("允许每个教程步骤引用唯一标注媒体", () => {
        const manifest = fixture();
        const mediaFile = manifest.evidence.mediaFiles[0]!;
        const source = manifest.browser.viewports[0]!.screenshot;
        const annotated = {
            ...manifest,
            evidence: {
                ...manifest.evidence,
                mediaFiles: [mediaFile],
                annotations: [{
                    stepId: "step-1",
                    mediaFile,
                    source,
                    profile: "api-config-tutorial",
                    marks: [
                        {kind: "rectangle", x: 0.1, y: 0.2, width: 0.3, height: 0.15},
                        {kind: "arrow", x: 0.8, y: 0.8, toX: 0.5, toY: 0.5},
                        {kind: "label", x: 0.2, y: 0.1, text: "填写 API Base"},
                    ],
                }],
                tutorialSteps: [{
                    id: "step-1",
                    title: "填写 Provider 连接",
                    instruction: "填写 Provider、API Base 与 API Key。",
                    source,
                    mediaFile,
                }],
            },
        };
        const parsed = parseResearchRunManifest(annotated);
        expect(parsed.evidence.annotations?.[0]?.stepId).toBe("step-1");
        expect(parsed.evidence.tutorialSteps?.[0]?.mediaFile).toBe(mediaFile);
    });

    it("拒绝步骤与标注媒体不一一对应", () => {
        const manifest = fixture();
        const mediaFile = manifest.evidence.mediaFiles[0]!;
        const source = manifest.browser.viewports[0]!.screenshot;
        expect(() => parseResearchRunManifest({
            ...manifest,
            evidence: {
                ...manifest.evidence,
                mediaFiles: [mediaFile],
                annotations: [{
                    stepId: "step-1",
                    mediaFile,
                    source,
                    profile: "api-config-tutorial",
                    marks: [{kind: "label", x: 0.2, y: 0.1, text: "步骤"}],
                }],
                tutorialSteps: [{
                    id: "step-2",
                    title: "另一步",
                    instruction: "说明",
                    source,
                    mediaFile,
                }],
            },
        })).toThrow(/缺少对应标注|不能一一对应/iu);
    });

    it("拒绝不在当前 mediaFiles 的标注路径与越界坐标", () => {
        const manifest = fixture();
        const annotation = {
            stepId: "step-1",
            mediaFile: resolve("C:/outside.png"),
            source: manifest.browser.viewports[0]!.screenshot,
            profile: "api-config-tutorial",
            marks: [{kind: "rectangle", x: 1.1, y: 0.2, width: 0.3, height: 0.15}],
        };
        expect(() => parseResearchRunManifest({
            ...manifest,
            evidence: {...manifest.evidence, annotations: [annotation]},
        })).toThrow(/mediaFiles/iu);
    });
    it("拒绝多个步骤复用同一媒体路径", () => {
        const manifest = fixture();
        const mediaFile = manifest.evidence.mediaFiles[0]!;
        const source = manifest.browser.viewports[0]!.screenshot;
        const step = {id: "step-1", title: "步骤一", instruction: "说明一", source, mediaFile};
        expect(() => parseResearchRunManifest({
            ...manifest,
            evidence: {
                ...manifest.evidence,
                mediaFiles: [mediaFile],
                annotations: [
                    {stepId: "step-1", mediaFile, source, profile: "api-config-tutorial", marks: [{kind: "label", x: 0.1, y: 0.1, text: "一"}]},
                    {stepId: "step-2", mediaFile, source, profile: "api-config-tutorial", marks: [{kind: "label", x: 0.2, y: 0.2, text: "二"}]},
                ],
                tutorialSteps: [step, {...step, id: "step-2", title: "步骤二", instruction: "说明二"}],
            },
        })).toThrow(/不能被多个步骤复用/iu);
    });

});

describe("Research Vision Plan contract", () => {
    it("接受一步一图的区域与步骤绑定", () => {
        const plan = parseResearchVisionPlan({
            success: true,
            profile: "api-config-tutorial",
            regions: [{
                id: "provider-connection",
                description: "Provider 连接字段",
                source: "plot-workbench-desktop.png",
                marks: [
                    {kind: "rectangle", x: 0.1, y: 0.2, width: 0.3, height: 0.15},
                    {kind: "arrow", x: 0.8, y: 0.8, toX: 0.5, toY: 0.5},
                    {kind: "label", x: 0.2, y: 0.1, text: "填写 API Base"},
                ],
            }],
            tutorialSteps: [{
                id: "step-1",
                title: "填写 Provider 连接",
                instruction: "填写 Provider、API Base 与 API Key。",
                source: "plot-workbench-desktop.png",
                regionId: "provider-connection",
            }],
        });
        expect(plan.regions[0]?.marks).toHaveLength(3);
        expect(plan.tutorialSteps[0]?.regionId).toBe("provider-connection");
    });

    it("拒绝步骤引用不存在区域", () => {
        expect(() => parseResearchVisionPlan({
            success: true,
            profile: "api-config-tutorial",
            regions: [{
                id: "provider-connection",
                description: "Provider 连接字段",
                source: "plot-workbench-desktop.png",
                marks: [{kind: "label", x: 0.2, y: 0.1, text: "步骤"}],
            }],
            tutorialSteps: [{
                id: "step-1",
                title: "步骤",
                instruction: "说明",
                source: "plot-workbench-desktop.png",
                regionId: "missing",
            }],
        })).toThrow(/未引用已声明区域/iu);
    });

    it("拒绝视觉计划中的秘密和越界坐标", () => {
        expect(() => parseResearchVisionPlan({
            success: true,
            profile: "api-config-tutorial",
            regions: [{
                id: "secret",
                description: "sk-not-a-real-secret",
                source: "plot-workbench-desktop.png",
                marks: [{kind: "rectangle", x: 1.1, y: 0.2, width: 0.3, height: 0.15}],
            }],
            tutorialSteps: [{
                id: "step-1",
                title: "步骤",
                instruction: "说明",
                source: "plot-workbench-desktop.png",
                regionId: "secret",
            }],
        })).toThrow(/凭据|0 到 1/iu);
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
