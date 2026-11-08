import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { DefaultAgentSelector } from './DefaultAgentSelector'

vi.mock('@/lib/use-translation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const reviewer: AgentProfile = { id: 'reviewer', name: 'Reviewer', description: 'Review changes.', source: 'project' }
type Catalog = { agents: AgentProfile[]; warning?: string }

function setup(listMachineAgentProfiles = vi.fn<(...args: unknown[]) => Promise<Catalog>>().mockResolvedValue({ agents: [reviewer] })) {
    const onChange = vi.fn()
    const props: ComponentProps<typeof DefaultAgentSelector> = {
        api: { listMachineAgentProfiles } as unknown as ApiClient,
        machineId: 'machine-1', flavor: 'codex', cwd: '/project', directoryExists: true,
        value: '', disabled: false, onChange,
    }
    return { props, onChange, listMachineAgentProfiles }
}

describe('DefaultAgentSelector', () => {
    it('loads profiles for the selected machine, CLI and workspace and forwards an explicit selection', async () => {
        const { props, onChange, listMachineAgentProfiles } = setup()
        const { rerender } = render(<DefaultAgentSelector {...props} />)
        await screen.findByRole('option', { name: 'Reviewer' })
        expect(listMachineAgentProfiles).toHaveBeenLastCalledWith('machine-1', 'codex', '/project')
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.change(screen.getByRole('combobox', { name: 'composer.conversationDefault' }), { target: { value: 'reviewer' } })
        expect(onChange).toHaveBeenCalledWith('reviewer')
        rerender(<DefaultAgentSelector {...props} machineId="machine-2" />)
        await waitFor(() => expect(listMachineAgentProfiles).toHaveBeenLastCalledWith('machine-2', 'codex', '/project'))
        rerender(<DefaultAgentSelector {...props} machineId="machine-2" flavor="agy" />)
        await waitFor(() => expect(listMachineAgentProfiles).toHaveBeenLastCalledWith('machine-2', 'agy', '/project'))
        rerender(<DefaultAgentSelector {...props} machineId="machine-2" flavor="agy" cwd="/another" />)
        await waitFor(() => expect(listMachineAgentProfiles).toHaveBeenLastCalledWith('machine-2', 'agy', '/another'))
    })

    it('does not discover profiles until a machine and existing workspace are selected', async () => {
        const { props, listMachineAgentProfiles } = setup()
        const { rerender } = render(<DefaultAgentSelector {...props} machineId={null} />)
        expect(screen.getByRole('combobox')).toBeDisabled()
        rerender(<DefaultAgentSelector {...props} cwd="" />)
        rerender(<DefaultAgentSelector {...props} directoryExists={undefined} />)
        rerender(<DefaultAgentSelector {...props} directoryExists={false} />)
        await act(async () => { await Promise.resolve() })
        expect(listMachineAgentProfiles).not.toHaveBeenCalled()
        expect(screen.getByRole('combobox')).toBeDisabled()
        expect(screen.getByText('newSession.agentProfileChooseDirectory')).toBeInTheDocument()
        rerender(<DefaultAgentSelector {...props} />)
        await screen.findByRole('option', { name: 'Reviewer' })
        expect(screen.getByRole('combobox')).toBeEnabled()
        rerender(<DefaultAgentSelector {...props} disabled />)
        expect(screen.getByRole('combobox')).toBeDisabled()
    })

    it('ignores a stale catalog response after the selected workspace changes', async () => {
        let resolveOld!: (result: Catalog) => void
        const old = new Promise<Catalog>(resolve => { resolveOld = resolve })
        const list = vi.fn<(...args: unknown[]) => Promise<Catalog>>()
            .mockReturnValueOnce(old)
            .mockResolvedValueOnce({ agents: [{ ...reviewer, id: 'writer', name: 'Writer' }] })
        const { props, onChange } = setup(list)
        const { rerender } = render(<DefaultAgentSelector {...props} />)
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
        expect(screen.getByRole('combobox')).toBeDisabled()
        rerender(<DefaultAgentSelector {...props} cwd="/another" />)
        await screen.findByRole('option', { name: 'Writer' })
        await act(async () => { resolveOld({ agents: [reviewer] }); await old })
        expect(screen.queryByRole('option', { name: 'Reviewer' })).not.toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'Writer' })).toBeInTheDocument()
        expect(onChange).not.toHaveBeenCalled()
    })

    it('shows discovery errors and retries without silently changing a missing selected profile', async () => {
        const list = vi.fn<(...args: unknown[]) => Promise<Catalog>>()
            .mockRejectedValueOnce(new Error('Runner offline'))
            .mockResolvedValueOnce({ agents: [reviewer], warning: 'Some definitions were skipped.' })
        const { props, onChange } = setup(list)
        render(<DefaultAgentSelector {...props} value="removed-agent" />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Runner offline')
        expect(screen.getByRole('combobox')).toHaveValue('removed-agent')
        fireEvent.click(screen.getByRole('button', { name: 'composer.agentsReload' }))
        await screen.findByRole('option', { name: 'Reviewer' })
        expect(screen.getByRole('alert')).toHaveTextContent('newSession.agentProfileUnavailable')
        expect(screen.getByRole('status')).toHaveTextContent('Some definitions were skipped.')
        expect(screen.getByRole('combobox')).toHaveValue('removed-agent')
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
        expect(onChange).toHaveBeenCalledWith('')
    })
})
