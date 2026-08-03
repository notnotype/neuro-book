import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {Instant} from "nbook/server/world-engine/types";
import type {CalendarStrategy} from "nbook/server/world-engine/calendar-strategy";
import {SimpleCalendar, normalizeSimpleCalendarConfig} from "nbook/server/world-engine/calendars/simple";
import {GregorianCalendar, normalizeGregorianCalendarConfig} from "nbook/server/world-engine/calendars/gregorian";
import {CustomCalendar, normalizeCustomCalendarConfig} from "nbook/server/world-engine/calendars/custom";
import {importSingleFileTypeScriptConfig} from "nbook/server/world-engine/single-file-typescript-config-import";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";

/**
 * WorldCalendar Facade
 *
 * 包装 CalendarStrategy，提供统一的 format / parse / projection 接口。
 * 工具层和 HTTP API 只与 WorldCalendar 交互，不直接接触具体 strategy。
 */
export class WorldCalendar {
    constructor(private readonly strategy: CalendarStrategy) {}

    /** 将 Instant 格式化成人读时间。 */
    format(instant: Instant): string {
        return this.strategy.format(instant);
    }

    /** 从人读时间解析 Instant；也兼容 instant:<number> 便于测试和底层调试。 */
    parse(input: string): Instant {
        return this.strategy.parse(input);
    }

    /** 返回 schema 投影使用的格式说明。 */
    projection(): {format: string; examples: string[]} {
        return this.strategy.projection();
    }
}

/**
 * WorldCalendarLoader
 *
 * 负责加载项目日历配置（calendar.ts），不存在时报错。
 * calendar.yaml 已废弃，不再支持。
 */
export class WorldCalendarLoader {
    async load(projectRoot: AbsoluteFsPath): Promise<WorldCalendar> {
        // 只支持 calendar.ts
        const tsPath = path.join(projectRoot, "world-engine", "calendar.ts");
        if (await fileExists(tsPath)) {
            return await this.loadFromTypeScript(projectRoot, tsPath);
        }

        // calendar.ts 不存在，报错
        throw createError({
            statusCode: 400,
            message: `Project 缺少 world-engine/calendar.ts。请创建 calendar.ts 配置文件（支持 simple / gregorian / custom 三种类型）。`,
        });
    }

    private async loadFromTypeScript(projectRoot: AbsoluteFsPath, tsPath: string): Promise<WorldCalendar> {
        try {
            // calendar.ts 是单文件配置入口；入口内容变化时通过 hash 模块路径热加载。
            const module = await importSingleFileTypeScriptConfig<{default?: unknown}>({
                filePath: tsPath,
                label: "calendar",
                runtimeCacheRoot: path.join(projectRoot, ".nbook", "runtime-artifact-import-cache"),
                compilerContext: await resolveRuntimeArtifactCompilerContext(),
            });
            const config = module.default;

            if (!config || typeof config !== "object") {
                throw createError({statusCode: 400, message: "calendar.ts 必须 export default 一个配置对象"});
            }

            // 根据 type 分发到不同 strategy
            const type = (config as Record<string, unknown>).type;

            if (type === "simple") {
                const normalizedConfig = normalizeSimpleCalendarConfig(config);
                return new WorldCalendar(new SimpleCalendar(normalizedConfig));
            }

            if (type === "gregorian") {
                const normalizedConfig = normalizeGregorianCalendarConfig(config);
                return new WorldCalendar(new GregorianCalendar(normalizedConfig));
            }

            if (type === "custom") {
                const normalizedConfig = normalizeCustomCalendarConfig(config);
                return new WorldCalendar(new CustomCalendar(normalizedConfig));
            }

            throw createError({statusCode: 400, message: `未知的 calendar type：${type}。支持：simple / gregorian / custom`});
        } catch (error) {
            throw createError({statusCode: 400, message: `calendar.ts 加载失败：${error instanceof Error ? error.message : String(error)}`});
        }
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
