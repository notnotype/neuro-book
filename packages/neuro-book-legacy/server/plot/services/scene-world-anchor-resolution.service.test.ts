import {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import type {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import type {StorySceneWorldAnchorDto} from "nbook/shared/dto/plot.dto";
import {describe, expect, it, vi} from "vitest";

/**
 * 创建基础 Scene World Anchor DTO。
 */
function createAnchor(patch: Partial<StorySceneWorldAnchorDto> = {}): StorySceneWorldAnchorDto {
    return {
        startTime: null,
        endTime: null,
        startInstant: "100",
        endInstant: "200",
        subjectIds: ["hero", "future-ally"],
        locationSubjectId: "temple",
        subjects: [],
        locationSubject: null,
        unresolvedSubjectIds: [],
        ...patch,
    };
}

/**
 * 创建服务及 World Engine mock。
 */
function createService(patch: Partial<WorldEngineFacade> = {}) {
    const worldEngineFacade = {
        listSubjectIdentities: vi.fn(async () => [
            {id: "hero", type: "character", name: "主角"},
            {id: "temple", type: "location", name: "荒野神殿"},
        ]),
        formatTime: vi.fn(async (instant: bigint) => `T${instant.toString()}`),
        ...patch,
    } as unknown as WorldEngineFacade & {
        listSubjectIdentities: ReturnType<typeof vi.fn>;
        formatTime: ReturnType<typeof vi.fn>;
    };

    return {
        service: new SceneWorldAnchorResolutionService(worldEngineFacade),
        worldEngineFacade,
    };
}

describe("SceneWorldAnchorResolutionService", () => {
    it("解析已存在 subject，并把缺失 subject 标记为 unresolved", async () => {
        const {service, worldEngineFacade} = createService();

        const result = await service.resolve(createAnchor());

        expect(worldEngineFacade.listSubjectIdentities).toHaveBeenCalledWith({
            ids: ["hero", "future-ally", "temple"],
        });
        expect(result).toMatchObject({
            startTime: "T100",
            endTime: "T200",
            subjects: [
                {id: "hero", name: "主角", type: "character", resolved: true},
                {id: "future-ally", name: "future-ally", type: "unknown", resolved: false},
            ],
            locationSubject: {id: "temple", name: "荒野神殿", type: "location", resolved: true},
            unresolvedSubjectIds: ["future-ally"],
        });
    });

    it("地点 subject 覆盖 resolved、unresolved、null 三种读取态", async () => {
        const {service} = createService();

        await expect(service.resolve(createAnchor({locationSubjectId: null}))).resolves.toMatchObject({
            locationSubject: null,
            unresolvedSubjectIds: ["future-ally"],
        });
        await expect(service.resolve(createAnchor({locationSubjectId: "future-place"}))).resolves.toMatchObject({
            locationSubject: {id: "future-place", name: "future-place", type: "unknown", resolved: false},
            unresolvedSubjectIds: ["future-ally", "future-place"],
        });
    });

    it("缺少 calendar.ts 时保留 raw instant，并把 formatted time 降级为 null", async () => {
        const missingCalendarError = new Error("Project 缺少 world-engine/calendar.ts。请创建 calendar.ts 配置文件。") as Error & {statusCode: number};
        missingCalendarError.statusCode = 400;
        const {service} = createService({
            listSubjectIdentities: vi.fn(async () => []),
            formatTime: vi.fn(async () => {
                throw missingCalendarError;
            }),
        } as Partial<WorldEngineFacade>);

        const result = await service.resolve(createAnchor());

        expect(result).toMatchObject({
            startInstant: "100",
            endInstant: "200",
            startTime: null,
            endTime: null,
            subjects: [
                {id: "hero", name: "hero", type: "unknown", resolved: false},
                {id: "future-ally", name: "future-ally", type: "unknown", resolved: false},
            ],
            locationSubject: {id: "temple", name: "temple", type: "unknown", resolved: false},
            unresolvedSubjectIds: ["hero", "future-ally", "temple"],
        });
    });

    it("calendar.ts 存在但加载失败时继续抛出配置错误", async () => {
        const brokenCalendarError = new Error("calendar.ts 加载失败：未知的 calendar type：broken") as Error & {statusCode: number};
        brokenCalendarError.statusCode = 400;
        const {service} = createService({
            formatTime: vi.fn(async () => {
                throw brokenCalendarError;
            }),
        } as Partial<WorldEngineFacade>);

        await expect(service.resolve(createAnchor())).rejects.toThrow("calendar.ts 加载失败");
    });
});
