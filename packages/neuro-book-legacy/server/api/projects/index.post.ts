import {validateBody} from "nbook/server/utils/novel-chapter";
import {buildWorkspaceSlugBase} from "nbook/server/workspace-files/novel-workspace";
import {createProject, listProjects} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {throwProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {toProjectMetadataDto} from "nbook/server/api/projects/project-control-plane";
import {
    ProjectCreateRequestDtoSchema,
    type ProjectCreateResponseDto,
} from "nbook/shared/dto/project.dto";

/**
 * 新建 Project Workspace。
 *
 * 目录名由标题派生并在冲突时加数字后缀；创建不隐式打开 ProjectSession。
 */
export default defineEventHandler(async (event): Promise<ProjectCreateResponseDto> => {
    const body = await validateBody(event, ProjectCreateRequestDtoSchema);
    try {
        const result = await createProject({
            ref: projectWorkspaceRef(await allocateProjectRoot(body.title)),
            title: body.title,
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

/**
 * 取一个当前未被占用的单段目录名。
 *
 * 这里只避开列表已知的 Project；真正的目录冲突由 Lifecycle 在创建事务内裁决。
 */
async function allocateProjectRoot(title: string): Promise<string> {
    const base = buildWorkspaceSlugBase(title);
    const existing = new Set<string>((await listProjects()).projects.map((project) => project.projectRoot));
    let suffix = 0;
    while (true) {
        const candidate = suffix === 0 ? base : `${base}-${String(suffix + 1)}`;
        if (!existing.has(candidate)) {
            return candidate;
        }
        suffix += 1;
    }
}
