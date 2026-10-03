import {ResetUserPasswordRequestDtoSchema, type AdminUserListItemDto} from "nbook/shared/dto/auth.dto";
import {assertCanChangeAdminState, lockAdminStateChanges, requireAdminAccess, requireUserId, toAdminUserListItem} from "nbook/server/utils/auth";
import {hashUserPassword} from "nbook/server/utils/password";
import {prisma} from "nbook/server/utils/prisma";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 管理员重置用户密码，并让旧 session 失效。
 */
export default defineEventHandler(async (event): Promise<AdminUserListItemDto> => {
    await requireAdminAccess(event);
    const userId = requireUserId(event);
    const body = await validateBody(event, ResetUserPasswordRequestDtoSchema);
    const passwordHash = await hashUserPassword(body.password);
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

        await assertCanChangeAdminState(transactionClient, userId);
        return await transactionClient.user.update({
            where: {id: userId},
            data: {
                passwordHash,
                sessionVersion: {increment: 1},
            },
        });
    });

    return toAdminUserListItem(user);
});
