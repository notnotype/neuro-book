import {validateBody} from "nbook/server/utils/novel-chapter";
import {updateProjectMetadata} from "nbook/server/runtime/product-project";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {requireProjectRefQuery, toProjectMetadataDto} from "nbook/server/api/projects/project-control-plane";
import {
    ProjectUpdateRequestDtoSchema,
    type ProjectUpdateResponseDto,
} from "nbook/shared/dto/project.dto";

/**
 * 更新 Project manifest 的标题与摘要；identity 只来自 query，body 不重复携带。
 *
 * Project 正在运行时借用当前 session generation，未运行时由 Lifecycle 自取 Occupancy。
 */
export default defineEventHandler(async (event): Promise<ProjectUpdateResponseDto> => {
    const ref = requireProjectRefQuery(event);
    const body = await validateBody(event, ProjectUpdateRequestDtoSchema);
    try {
        const result = await updateProjectMetadata({
            ref,
            ...(body.title === undefined ? {} : {title: body.title}),
            ...(body.summary === undefined ? {} : {summary: body.summary}),
        });
        return {
            revision: result.revision,
            project: toProjectMetadataDto(result.project),
        };
    } catch (error) {
        throwProjectHttpError(error);
    }
});
