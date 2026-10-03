export type ApiFetchOptions = {
    notify?: boolean;
    errorMessage?: string | false;
} & Record<string, unknown>;

export async function apiFetch<T>(request: string, options?: ApiFetchOptions): Promise<T> {
    return await (globalThis.$fetch as any)(request, options as Parameters<typeof $fetch>[1]) as T;
}
