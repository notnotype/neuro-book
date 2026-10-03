import {UpdateUserRequestDtoSchema, type AdminUserListItemDto} from "nbook/shared/dto/auth.dto";
import {assertCanChangeAdminState, lockAdminStateChanges, requireAdminAccess, requireUserId, toAdminUserListItem} from "nbook/server/utils/auth";
import {prisma} from "nbook/server/utils/prisma";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 管理员更新用户资料、角色和状态。
 */
export default defineEventHandler(async (event): Promise<AdminUserListItemDto> => {
    await requireAdminAccess(event);
    const userId = requireUserId(event);
    const body = await validateBody(event, UpdateUserRequestDtoSchema);
    const revokesCurrentSession = body.role !== undefined || body.status !== undefined;
    const user = await prisma.$transaction(async (transactionClient) => {
        await lockAdminStateChanges(transactionClient);
        const currentUser = await transactionClient.user.findUnique({
            where: {id: userId},
        });
        if (!currentUser) {
            throw createError({
                statusCode: 404,
                message: "用户不存在",
            });
        }

        await assertCanChangeAdminState(transactionClient, userId, body.role, body.status);
        return await transactionClient.user.update({
            where: {id: userId},
            data: {
                displayName: body.displayName,
                role: body.role,
                status: body.status,
                sessionVersion: revokesCurrentSession ? {increment: 1} : undefined,
            },
        });
    });

    return toAdminUserListItem(user);
});
