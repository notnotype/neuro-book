import * as z from "zod";

export const UserRoleSchema = z.enum(["admin", "user"]);
export const UserStatusSchema = z.enum(["active", "disabled"]);

export type AuthUserRole = z.infer<typeof UserRoleSchema>;
export type AuthUserStatus = z.infer<typeof UserStatusSchema>;

export const LoginRequestDtoSchema = z.object({
    username: z.string().trim().min(1, "用户名不能为空").max(64, "用户名不能超过 64 个字符"),
    password: z.string().min(1, "密码不能为空").max(256, "密码不能超过 256 个字符"),
});

export const CreateUserRequestDtoSchema = z.object({
    username: z.string().trim().min(2, "用户名至少 2 个字符").max(64, "用户名不能超过 64 个字符"),
    displayName: z.string().trim().max(80, "显示名不能超过 80 个字符").optional(),
    password: z.string().min(8, "密码至少 8 个字符"),
    role: UserRoleSchema.default("user"),
});

export const UpdateUserRequestDtoSchema = z.object({
    displayName: z.string().trim().max(80, "显示名不能超过 80 个字符").optional(),
    role: UserRoleSchema.optional(),
    status: UserStatusSchema.optional(),
});

export const ResetUserPasswordRequestDtoSchema = z.object({
    password: z.string().min(8, "密码至少 8 个字符"),
});

export type LoginRequestDto = z.infer<typeof LoginRequestDtoSchema>;
export type CreateUserRequestDto = z.infer<typeof CreateUserRequestDtoSchema>;
export type UpdateUserRequestDto = z.infer<typeof UpdateUserRequestDtoSchema>;
export type ResetUserPasswordRequestDto = z.infer<typeof ResetUserPasswordRequestDtoSchema>;

export type AuthUserDto = {
    id: string;
    username: string;
    displayName: string;
    role: AuthUserRole;
    sessionVersion: number;
};

export type AuthSessionDto = {
    authEnabled: boolean;
    user: AuthUserDto | null;
};

export type AdminUserListItemDto = {
    id: string;
    username: string;
    displayName: string;
    role: AuthUserRole;
    status: AuthUserStatus;
    sessionVersion: number;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    createdAt: string;
    updatedAt: string;
};
