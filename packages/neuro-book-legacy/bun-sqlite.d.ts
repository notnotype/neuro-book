declare module "bun:sqlite" {
    export class Database {
        constructor(path: string);
        run(sql: string, ...params: unknown[]): unknown;
        query(sql: string): {
            all(...params: unknown[]): unknown[];
            get(...params: unknown[]): unknown;
        };
        transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
        loadExtension(path: string): void;
        close(): void;
    }
}
