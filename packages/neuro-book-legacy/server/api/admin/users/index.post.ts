import {CreateUserRequestDtoSchema, type AdminUserListItemDto} from "nbook/shared/dto/auth.dto";
import {requireAdminAccess, toAdminUserListItem} from "nbook/server/utils/auth";
import {hashUserPassword} from "nbook/server/utils/password";
import {prisma} from "nbook/server/utils/prisma";
import {validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 管理员创建用户。
 */
export default defineEventHandler(async (event): Promise<AdminUserListItemDto> => {
    await requireAdminAccess(event);
    const body = await validateBody(event, CreateUserRequestDtoSchema);
    const existingUser = await prisma.user.findUnique({
        where: {username: body.username},
    });
    if (existingUser) {
        throw createError({
            statusCode: 409,
            message: "用户名已存在",
        });
    }

    const user = await prisma.user.create({
        data: {
            username: body.username,
            displayName: body.displayName ?? "",
            passwordHash: await hashUserPassword(body.password),
            role: body.role,
        },
    });

    return toAdminUserListItem(user);
});
