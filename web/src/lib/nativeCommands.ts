// Commands can contain private settings; keep their drafts out of URLs and
// persistent browser storage. Reading is repeatable for React StrictMode.
const drafts = new Map<string, string>()
export function saveNativeCommandDraft(sessionId: string, command: string): void { drafts.set(sessionId, command) }
export function getNativeCommandDraft(sessionId: string): string { return drafts.get(sessionId) ?? '' }
export function clearNativeCommandDraft(sessionId: string): void { drafts.delete(sessionId) }
