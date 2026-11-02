import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToolCard } from './ToolCard'
import type { ToolCallBlock } from '@/chat/types'
import { I18nProvider } from '@/lib/i18n-context'

vi.mock('@/components/CodeBlock', () => ({ CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre> }))

function showTool(name: string, input: unknown, result?: unknown, state: 'completed' | 'error' = 'completed') {
    const block: ToolCallBlock = {
        kind: 'tool-call', id: 'file-tool', localId: null, createdAt: 1, children: [],
        tool: { id: 'file-tool', name, input, result, state, createdAt: 1, startedAt: 1,
            completedAt: 2, execStartedAt: null, execCompletedAt: null, description: null },
    }
    return render(<I18nProvider><ToolCard block={block} api={{} as never} metadata={null}
        sessionId="session" terminalToolDisplayMode="compact" disabled={false} onDone={() => {}} /></I18nProvider>)
}

async function expandPreview() {
    const summary = screen.getByText('Code preview')
    fireEvent.click(summary)
    await waitFor(() => expect(summary.closest('details')?.open).toBe(true))
}

describe('inline file code preview', () => {
    it('lazily expands newly written code beside the operation without opening a dialog', async () => {
        showTool('Write', { file_path: '/project/test.ts', content: 'const created = true' })
        expect(screen.queryByText('const created = true')).toBeNull()
        await expandPreview()
        expect(await screen.findByText('const created = true')).toBeTruthy()
        expect(screen.queryByRole('dialog')).toBeNull()
    })
    it('previews read results already supplied by the agent', async () => {
        showTool('Read', { file_path: '/project/test.py' }, { file: { content: 'print("hello")', filePath: '/project/test.py' } })
        await expandPreview()
        expect(await screen.findByText('print("hello")')).toBeTruthy()
    })
    it('previews Codex file additions and patches', async () => {
        showTool('CodexPatch', { changes: { '/project/new.ts': { type: 'add', content: 'export const value = 1' } } })
        await expandPreview()
        expect(await screen.findByText('export const value = 1')).toBeTruthy()
    })
    it('previews the patch payload supplied by the Codex tool hook', async () => {
        showTool('CodexPatch', { patch: '*** Begin Patch\n*** Add File: /project/new.ts\n+export const hook = 1\n*** End Patch', changes: { '/project/new.ts': { kind: 'add' } } })
        await expandPreview()
        expect(await screen.findByText('export const hook = 1')).toBeTruthy()
    })
    it('previews a single parsed Codex read from its stdout', async () => {
        showTool('CodexBash', { parsed_cmd: [{ type: 'read', name: '/project/code.ts' }] },
            { stdout: 'const fromRead = true', stderr: '', exit_code: 0 })
        await expandPreview()
        expect(await screen.findByText('const fromRead = true')).toBeTruthy()
    })
    it('bounds large code previews and points to the full operation', async () => {
        showTool('Write', { path: '/project/large.txt', content: 'a'.repeat(30_000) })
        await expandPreview()
        const pre = document.querySelector('pre')
        expect(pre?.textContent?.length).toBeLessThanOrEqual(8000)
        expect(screen.getByText(/Preview truncated/)).toBeTruthy()
    })
    it('does not present a failed read as file content', () => {
        showTool('Read', { file_path: '/project/missing' }, 'File not found', 'error')
        expect(screen.queryByText('Code preview')).toBeNull()
    })
})
