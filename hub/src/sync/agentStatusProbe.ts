// Executed on the session machine through the existing Bash RPC. No prompts,
// thread mutations, credential reads or changes to the Runner are involved.
export const AGENT_STATUS_PROBE = String.raw`
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const flavor = process.argv[1];
if (!['codex', 'agy'].includes(flavor)) process.exit(1);
const env = { ...process.env };
for (const key of Object.keys(env)) {
    if (key.startsWith('HAPI_') || key.startsWith('HAPPY_')) delete env[key];
}
if (flavor === 'agy') {
    env.GEMINI_FORCE_FILE_STORAGE = 'true';
    for (const key of Object.keys(env)) if (key.startsWith('SSH_')) delete env[key];
}
const child = spawn(flavor, flavor === 'agy'
    ? ['--print', '/usage', '--output-format', 'json', '--print-timeout', '10s']
    : ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let settled = false;
let output = '';
let bytes = 0;
const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    process.stdout.write(JSON.stringify(result) + '\n');
    child.stdin.destroy();
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        const kill = setTimeout(() => child.kill('SIGKILL'), 500);
        kill.unref();
        child.once('close', () => clearTimeout(kill));
    }
};
const timer = setTimeout(() => finish({ success: false, error: 'Status request timed out. Try again.' }), 12000);
child.on('error', () => finish({ success: false, error: 'Agent executable unavailable on the session machine.' }));
child.stdin.on('error', () => {});
child.stderr.on('data', () => {});
child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 262144) return finish({ success: false, error: 'Agent status output exceeded its size limit.' });
    if (flavor === 'agy') output += chunk.toString();
});
if (flavor === 'codex') {
    const lines = createInterface({ input: child.stdout });
    const send = value => { if (!settled) child.stdin.write(JSON.stringify(value) + '\n'); };
    lines.on('line', line => {
        let value;
        try { value = JSON.parse(line); } catch { return; }
        if (value.id !== 1 && value.id !== 2) return;
        if (value.error) return finish({ success: false, error: 'Codex could not read account limits. Check login and account support.' });
        if (value.id === 1) {
            send({ method: 'initialized' });
            send({ id: 2, method: 'account/rateLimits/read' });
        } else finish({ success: true, data: value.result });
    });
    send({ id: 1, method: 'initialize', params: {
        clientInfo: { name: 'hapi-status', version: '1' },
        capabilities: { experimentalApi: true }
    } });
}
child.on('close', code => {
    if (settled) return;
    if (flavor === 'agy' && code === 0) {
        try {
            const value = JSON.parse(output);
            if (value.status === 'SUCCESS' && value.command?.name === 'usage' && Array.isArray(value.command.data?.groups)) {
                return finish({ success: true, data: value.command.data });
            }
        } catch {}
    }
    finish({ success: false, error: 'Account limits unavailable. Check login and the installed agent version.' });
});
`

export function buildAgentStatusCommand(flavor: 'codex' | 'agy'): string {
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    return `node -e ${quote(AGENT_STATUS_PROBE)} ${quote(flavor)}`
}
