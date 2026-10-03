/** Source checkout Adapter；正式实现由 Auth Module 拥有。 */
const {runCreateAdminCli} = await import("nbook/server/auth/create-admin-command");
await runCreateAdminCli();
