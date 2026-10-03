import {appLogger} from "nbook/server/app-logs/logger";
import {createServerTiming} from "nbook/server/utils/server-timing";
import {listProjects} from "nbook/server/runtime/product-project";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {toProjectMetadataDto} from "nbook/server/api/projects/project-control-plane";
import type {ProjectListResponseDto} from "nbook/shared/dto/project.dto";

const SLOW_PROJECT_LIST_MS = 500;

/**
 * 查询 Project Workspace 列表。
 *
 * 只读 Lifecycle 的轻量 snapshot：不扫描文件树、不打开 Project SQLite、不读取 Agent session，
 * 也不接受裁剪参数。调用方需要过滤时在自己那侧筛选。
 */
export default defineEventHandler(async (event): Promise<ProjectListResponseDto> => {
    const startedAt = performance.now();
    const timingSink = createServerTiming(event);
    try {
        const snapshot = await listProjects();
        timingSink?.mark("projects.manifests", performance.now() - startedAt);
        const durationMs = performance.now() - startedAt;
        if (durationMs > SLOW_PROJECT_LIST_MS) {
            void appLogger.warn("projects.list.slow", {
                durationMs,
                projectCount: snapshot.projects.length,
            }, "Project 列表请求过慢");
        }
        return {
            revision: snapshot.revision,
            projects: snapshot.projects.map((project) => toProjectMetadataDto(project)),
        };
    } catch (error) {
        throwProjectHttpError(error);
    } finally {
        timingSink?.mark("projects.total", performance.now() - startedAt);
    }
});
