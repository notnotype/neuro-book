import {requireProjectRefQuery, toProjectMetadataDto} from "nbook/server/api/projects/project-control-plane";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import type {ProjectMutationResponseDto} from "nbook/shared/dto/project.dto";
import {updateProjectCover} from "nbook/server/runtime/product-project";

/** 清除 Project 封面引用，并在提交成功后清理应用托管原图。 */
export default defineEventHandler(async (event): Promise<ProjectMutationResponseDto> => {
    const ref = requireProjectRefQuery(event);
    try {
        const result = await updateProjectCover({ref, cover: null});
        return {
            revision: result.revision,
            project: toProjectMetadataDto(result.project),
        };
    } catch (error) {
        throwProjectHttpError(error);
    }
});
