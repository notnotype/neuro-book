import type {AuthUserDto} from "nbook/shared/dto/auth.dto";

declare module "#auth-utils" {
    interface User extends AuthUserDto {}

    interface UserSession {
        user?: User;
    }
}

export {};
