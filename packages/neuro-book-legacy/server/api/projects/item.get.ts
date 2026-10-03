import {createError} from "h3";
import {listProjects} from "nbook/server/runtime/product-project";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {requireProjectRefQuery, toProjectMetadataDto} from "nbook/server/api/projects/project-control-plane";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

/**
 * 查询单个 Project Workspace 的轻量 metadata。
 *
 * 只读同一份列表 snapshot，不打开 ProjectSession：不在列表中即视为不存在。
 */
export default defineEventHandler(async (event): Promise<ProjectMetadataDto> => {
    const ref = requireProjectRefQuery(event);
    try {
        const snapshot = await listProjects();
        const project = snapshot.projects.find((item) => item.projectRoot === ref.projectRoot);
        if (!project) {
            throw createError({
                statusCode: 404,
                message: `Project 不存在：${ref.projectRoot}`,
                data: {code: "PROJECT_NOT_FOUND", projectRoot: ref.projectRoot},
            });
        }
        return toProjectMetadataDto(project);
    } catch (error) {
        throwProjectHttpError(error);
    }
});
