declare module "proper-lockfile" {
    export type LockOptions = {
        lockfilePath?: string;
        realpath?: boolean;
        stale?: number;
        update?: number;
        retries?: number | {
            retries?: number;
            factor?: number;
            minTimeout?: number;
            maxTimeout?: number;
            randomize?: boolean;
        };
        onCompromised?: (error: Error) => void;
    };

    export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
    export function lockSync(file: string, options?: LockOptions): () => void;
    export function check(file: string, options?: Pick<LockOptions, "lockfilePath" | "realpath" | "stale">): Promise<boolean>;
}
