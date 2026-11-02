import { useState } from 'react'
import { isObject } from '@hapi/protocol'
import type { ChatToolCall } from '@/chat/types'
import { CodeBlock } from '@/components/CodeBlock'
import { getInputStringAny } from '@/lib/toolInputUtils'
import { extractCodexBashDisplay, extractReadFileContent, extractReadPathFromInput, extractTextFromResult, inferCodeLanguage,
    isReadFileToolCall, parseNumberedFileLines, unwrapOpencodeReadOutput } from './views/_results'

type FilePreview = { path: string; code: string; language: string; truncated: boolean; startLine?: number }

// Use only content already carried by the operation. The Hub cannot read the
// Runner's filesystem, and a later fetch would show a different file revision.
export function getFileCodePreviews(tool: ChatToolCall): FilePreview[] {
    const previews: FilePreview[] = []
    const add = (path: string | null, content: unknown, language?: string, startLine?: number) => {
        if (typeof content !== 'string' || content.includes('\0') || previews.length >= 8) return
        const bounded = content.slice(0, 8000).split('\n').slice(0, 80).join('\n')
        previews.push({ path: path ?? '', code: bounded, language: language ?? inferCodeLanguage(path, bounded) ?? 'text',
            truncated: bounded.length < content.length, startLine })
    }
    const input = tool.input
    if (isReadFileToolCall(tool.name, input)) {
        if (tool.state !== 'completed') return previews
        // A compound shell operation may read several files. Its combined
        // stdout cannot be attributed to a single path safely.
        if (isObject(input) && Array.isArray(input.parsed_cmd) && input.parsed_cmd.length !== 1) return previews
        const file = extractReadFileContent(tool.result)
        const shell = extractCodexBashDisplay(tool.result)
        if (shell?.exitCode != null && shell.exitCode !== 0) return previews
        const text = file?.content ?? extractTextFromResult(tool.result) ?? shell?.stdout
        if (text == null) return previews
        const unwrapped = unwrapOpencodeReadOutput(text)
        const path = file?.filePath ?? unwrapped.path ?? extractReadPathFromInput(input)
        const numbered = (unwrapped.isOpencodeRead || tool.nativeKind === 'agy-numbered-read')
            ? parseNumberedFileLines(unwrapped.body) : null
        add(path, numbered?.body ?? unwrapped.body, undefined, numbered?.startLine)
    } else if (isObject(input)) {
        const path = getInputStringAny(input, ['file_path', 'filePath', 'path'])
        if (['Write', 'write', 'write_file', 'create_file'].includes(tool.name)) {
            add(path, input.content ?? input.text)
        } else if (['Edit', 'edit', 'edit_file'].includes(tool.name)) {
            add(path, input.new_string ?? input.newText)
        } else if (tool.name === 'MultiEdit' && Array.isArray(input.edits)) {
            for (const edit of input.edits) if (isObject(edit)) add(path, edit.new_string)
        } else if (tool.name === 'CodexPatch' || tool.name === 'apply_patch') {
            if (typeof input.patch === 'string') {
                // Codex hooks carry the actual patch plus a path-only changes
                // map. Use the patch rather than inventing missing file content.
                const sections = input.patch.matchAll(/^\*\*\* (Add|Update) File: ([^\n]+)\n([\s\S]*?)(?=^\*\*\* (?:Add|Update|Delete) File:|^\*\*\* End Patch)/gm)
                for (const [, kind, filePath, body] of sections) {
                    add(filePath, kind === 'Add' ? body.replace(/^\+/gm, '').replace(/\n$/, '') : body, kind === 'Update' ? 'diff' : undefined)
                }
            } else if (isObject(input.changes)) {
                for (const [filePath, change] of Object.entries(input.changes)) {
                    if (isObject(change)) add(filePath, change.content ?? change.unified_diff, typeof change.unified_diff === 'string' ? 'diff' : undefined)
                }
            }
        }
    }
    return previews
}

export function FileCodePreview({ previews, state }: { previews: FilePreview[]; state: ChatToolCall['state'] }) {
    const [open, setOpen] = useState(false)
    return (
        <details className="min-w-0 rounded-xl border border-[var(--app-border)]" onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer rounded-xl px-3 py-2 text-xs text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]">
                Code preview
                {state !== 'completed' ? <span className="ml-2 text-[var(--app-hint)]">{state === 'error' ? 'Failed operation · proposed content' : 'Proposed content'}</span> : null}
            </summary>
            {open ? <div className="max-h-64 space-y-2 overflow-auto border-t border-[var(--app-border)] p-2">
                {previews.map((preview, index) => <div key={index} className="min-w-0">
                    {preview.path ? <div className="mb-1 break-all font-mono text-xs text-[var(--app-hint)]">{preview.path}</div> : null}
                    {preview.code ? <CodeBlock code={preview.code} language={preview.language} startLineNumber={preview.startLine}
                        collapseLongContent={false} showCopyButton={false} showWrapToggle={false} /> : <div className="text-xs text-[var(--app-hint)]">Empty content</div>}
                    {preview.truncated ? <p className="mt-1 text-xs text-[var(--app-hint)]">Preview truncated. Open the operation for full details.</p> : null}
                </div>)}
            </div> : null}
        </details>
    )
}
