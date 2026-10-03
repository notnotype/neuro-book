import type {H3Event} from "h3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushServerTiming} from "nbook/server/utils/server-timing";

const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const listProjectsMock = vi.fn();
const warnMock = vi.fn();

vi.mock("nbook/server/runtime/product-project", () => ({
    listProjects: listProjectsMock,
}));

// 共享测试 setup 的 afterAll 会调用 appLogger.flush()，mock 必须补齐该方法，否则整个 suite 在收尾阶段失败。
vi.mock("nbook/server/app-logs/logger", () => ({
    appLogger: {
        warn: warnMock,
        flush: vi.fn(async () => undefined),
    },
}));

describe("GET /api/projects", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler = originalDefineEventHandler;
        vi.restoreAllMocks();
    });

    it("返回 Lifecycle snapshot 的 revision 与轻量 Project DTO", async () => {
        listProjectsMock.mockResolvedValue({
            revision: 7,
            projects: [
                {projectRoot: "novel-a", kind: "novel", title: "小说 A", summary: "摘要", cover: "art/cover.webp", manifestUpdatedAt: "2026-07-27T00:00:00.000Z"},
                {projectRoot: "novel-b", kind: "novel", title: "小说 B", summary: ""},
            ],
        });
        const handler = (await import("nbook/server/api/projects/index.get")).default as (event: H3Event) => Promise<unknown>;
        const {event, headers} = createProjectsEvent();

        const result = await handler(event);
        flushServerTiming(event, {headers: {}});

        expect(result).toEqual({
            revision: 7,
            projects: [
                {projectRoot: "novel-a", kind: "novel", title: "小说 A", summary: "摘要", cover: "art/cover.webp", manifestUpdatedAt: "2026-07-27T00:00:00.000Z"},
                {projectRoot: "novel-b", kind: "novel", title: "小说 B", summary: ""},
            ],
        });
        // 列表不接受任何裁剪参数。
        expect(listProjectsMock).toHaveBeenCalledWith();
        expect(headers["server-timing"]).toContain("projects.manifests");
        expect(headers["server-timing"]).toContain("projects.total");
        expect(warnMock).not.toHaveBeenCalled();
    });

    it("慢请求 warn 只包含 Project 数量", async () => {
        // 路由内多次读取 performance.now（起始、timing mark、慢请求判定）；这里让首次为 0、其后恒为 750。
        let firstRead = true;
        vi.spyOn(performance, "now").mockImplementation(() => {
            if (firstRead) {
                firstRead = false;
                return 0;
            }
            return 750;
        });
        listProjectsMock.mockResolvedValue({
            revision: 3,
            projects: Array.from({length: 12}, (_, index) => ({
                projectRoot: `novel-${String(index)}`,
                kind: "novel" as const,
                title: `小说 ${String(index)}`,
                summary: "",
            })),
        });
        const handler = (await import("nbook/server/api/projects/index.get")).default as (event: H3Event) => Promise<unknown>;
        const {event} = createProjectsEvent();

        await handler(event);

        expect(warnMock).toHaveBeenCalledWith("projects.list.slow", {
            durationMs: 750,
            projectCount: 12,
        }, "Project 列表请求过慢");
    });
});

function createProjectsEvent(): {event: H3Event; headers: Record<string, string>} {
    const headers: Record<string, string> = {};
    const event = {
        context: {},
        node: {
            res: {
                getHeader: (name: string) => headers[name.toLowerCase()],
                setHeader: (name: string, value: string) => {
                    headers[name.toLowerCase()] = value;
                },
                getHeaders: () => headers,
            },
        },
    } as unknown as H3Event;
    return {event, headers};
}
