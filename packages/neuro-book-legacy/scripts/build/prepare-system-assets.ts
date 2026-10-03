/** Source/build Adapter；Product 使用同一个 server-owned implementation。 */
const {runPrepareSystemAssetsCommand} = await import("nbook/server/runtime/prepare-system-assets-command");
await runPrepareSystemAssetsCommand();
