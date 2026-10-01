import type {OwnedProcessLease} from "@notnotype/owned-process";

export const CHECK_IDS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"] as const;
export type CheckId = typeof CHECK_IDS[number];
export type CheckResult = "pass" | "fail" | "pending";
export interface Observation {
    id: string;
    result: CheckResult;
    evidence: string;
}
export interface CheckReport {
    id: CheckId;
    result: CheckResult;
    durationMs: number;
    evidence: string;
    logPath: string;
    observations: Observation[];
}
export interface RunningProduct {
    lease: OwnedProcessLease;
    outputLogPath: string;
    completion: Promise<{code: number | null; signal: string | null}>;
    port: number;
    url: string;
    stateRoot: string;
    token: string;
    leasePath: string;
    stop(): Promise<string>;
    dispose(): Promise<void>;
}
export interface SmokeContext {
    appRoot: string;
    repoRoot: string;
    imageRoot: string;
    tempRoot: string;
    evidenceRoot: string;
    browserExecutable: string;
    selected: ReadonlySet<CheckId>;
    log(id: string, message: string): void;
    check(id: CheckId, run: (observe: (observation: Observation) => void) => Promise<void>): Promise<void>;
    prepare(stateRoot: string, id: CheckId): Promise<void>;
    start(stateRoot: string, id: CheckId, options?: {port?: number; direct?: boolean; ready?: boolean}): Promise<RunningProduct>;
    freePort(): Promise<number>;
    environment(stateRoot: string, development: boolean): Promise<NodeJS.ProcessEnv>;
}
