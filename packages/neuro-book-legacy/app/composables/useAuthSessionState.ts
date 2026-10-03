import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

/**
 * 保存客户端路由鉴权已经读取到的 session，避免首页重复串行请求 /api/auth/me。
 */
export function useAuthSessionState() {
    const session = useState<AuthSessionDto | null>("auth-session", () => null);

    const setSession = (nextSession: AuthSessionDto | null): void => {
        session.value = nextSession;
    };

    return {
        session,
        setSession,
    };
}

