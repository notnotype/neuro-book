/**
 * 按 Docker/Unix 常见写法展开配置文本中的环境变量占位符。
 */
export function expandEnvTemplate(text: string, env: NodeJS.ProcessEnv = process.env): string {
    return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}/g, (_match, name: string, _defaultPart: string | undefined, defaultValue: string | undefined) => {
        const value = env[name];
        if (value !== undefined) {
            return value;
        }
        return defaultValue ?? "";
    });
}
