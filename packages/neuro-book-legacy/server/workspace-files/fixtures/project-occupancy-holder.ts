import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectLockModule} from "nbook/server/workspace-files/project-lock";

const workspaceRoot = process.env.NBOOK_TEST_WORKSPACE_ROOT;
const projectRoot = process.env.NBOOK_TEST_PROJECT_ROOT;
if (!workspaceRoot || !projectRoot) {
    throw new Error("跨进程Occupancy fixture缺少Workspace Root或Project root");
}

/** 等待parent关闭stdin，并用有界超时避免测试异常时永久持有Occupancy。 */
async function waitForReleaseSignal(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("等待parent释放Occupancy的信号超时"));
        }, 15_000);
        process.stdin.once("end", () => {
            clearTimeout(timeout);
            resolve();
        });
        process.stdin.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        process.stdin.resume();
    });
}

const handle = await new ProjectLockModule(absoluteFsPath(workspaceRoot))
    .acquireOccupancy(projectWorkspaceRef(projectRoot));
process.stdout.write("NBOOK_OCCUPANCY_READY\n");

try {
    await waitForReleaseSignal();
} finally {
    await handle.release();
}

process.stdout.write("NBOOK_OCCUPANCY_RELEASED\n");
