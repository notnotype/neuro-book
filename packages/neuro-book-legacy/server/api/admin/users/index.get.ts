import {requireAdminAccess, toAdminUserListItem} from "nbook/server/utils/auth";
import {prisma} from "nbook/server/utils/prisma";
import type {AdminUserListItemDto} from "nbook/shared/dto/auth.dto";

/**
 * 管理员读取用户列表。
 */
export default defineEventHandler(async (event): Promise<AdminUserListItemDto[]> => {
    await requireAdminAccess(event);
    const users = await prisma.user.findMany({
        orderBy: [
            {role: "asc"},
            {createdAt: "asc"},
        ],
    });
    return users.map(toAdminUserListItem);
});
