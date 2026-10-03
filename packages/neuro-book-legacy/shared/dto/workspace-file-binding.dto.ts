import {z} from "zod";
import {ProjectReadyIdDtoSchema, ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";

/** Project 文件请求须绑定 open 签发的精确代次；非 Project 根必须显式指定。 */
export const WorkspaceFileBindingDtoSchema = z.union([
    z.object({
        projectRoot: ProjectRootDtoSchema,
        publicId: ProjectReadyIdDtoSchema,
    }).strict(),
    z.object({
        workspaceKind: z.literal("user-assets"),
    }).strict(),
]);

export type WorkspaceFileBindingDto = z.infer<typeof WorkspaceFileBindingDtoSchema>;

/** 从带有路由专属字段的 query/body/FormData 投影出唯一工作区绑定。 */
export function parseWorkspaceFileBinding(input: Record<string, unknown>): WorkspaceFileBindingDto {
    const {projectRoot, publicId, workspaceKind} = input;
    return WorkspaceFileBindingDtoSchema.parse(workspaceKind === undefined
        ? {projectRoot, publicId}
        : projectRoot === undefined && publicId === undefined
            ? {workspaceKind}
            : {projectRoot, publicId, workspaceKind});
}
