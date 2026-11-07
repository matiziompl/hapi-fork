import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { AgentProfile, PromptProfileState } from '@hapi/protocol'
import { I18nProvider } from '@/lib/i18n-context'
import { PersonaPicker, AgentProfilePicker } from './PromptProfiles'

afterEach(cleanup)
const persona = { id: 'p1', name: 'Reviewer', description: 'Find regressions.' }
function setup() {
    const agents: AgentProfile[] = [
        { id: 'a1', name: 'code-reviewer', description: 'Reviews correctness.', source: 'user' },
        { id: 'a2', name: 'frontend-artisan', description: 'Accessible interfaces.', source: 'project' },
    ]
    let state: PromptProfileState = { personas: [persona], personaId: null, agent: null, defaultAgent: null }
    const api = {
        getPromptProfile: vi.fn(async () => state),
        updatePromptProfile: vi.fn(async (_id, input) => {
            if ('personaId' in input) state = { ...state, personaId: input.personaId }
            if ('agentId' in input) state = { ...state, agent: agents.find(agent => agent.id === input.agentId) ?? null }
            if ('defaultAgentId' in input) state = { ...state, defaultAgent: agents.find(agent => agent.id === input.defaultAgentId) ?? null, ...(input.defaultAgentId ? { agent: agents.find(agent => agent.id === input.defaultAgentId)! } : {}) }
            if (input.useDefaultAgent) state = { ...state, agent: state.defaultAgent }
            return state
        }),
        createPersona: vi.fn(async input => ({ persona: { id: 'p2', ...input } })),
        listAgentProfiles: vi.fn(async () => ({ agents })),
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const renderPicker = (kind: 'persona' | 'agent') => render(
        <QueryClientProvider client={client}><I18nProvider>
            {kind === 'persona'
                ? <PersonaPicker api={api as unknown as ApiClient} sessionId="s1" />
                : <AgentProfilePicker api={api as unknown as ApiClient} sessionId="s1" active />}
        </I18nProvider></QueryClientProvider>,
    )
    return { api, renderPicker }
}

test('selects a persona and can disable it without putting its description in the composer', async () => {
    const { api, renderPicker } = setup()
    renderPicker('persona')
    fireEvent.click(screen.getByRole('button', { name: 'Personas' }))
    fireEvent.click(await screen.findByRole('button', { name: /Reviewer/ }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { personaId: 'p1' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Personas: Reviewer/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Personas: Reviewer/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'No persona' }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { personaId: null }))
})

test('plus opens the larger creator with name and description and saves a real persona', async () => {
    const { api, renderPicker } = setup()
    renderPicker('persona')
    fireEvent.click(screen.getByRole('button', { name: 'Personas' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create persona' }))
    expect(screen.getByRole('dialog', { name: 'Create persona' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Architect' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Design small systems.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save persona' }))
    await waitFor(() => expect(api.createPersona).toHaveBeenCalledWith({ name: 'Architect', description: 'Design small systems.' }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { personaId: 'p2' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('searches discovered profiles for this session and chooses an actual catalog id', async () => {
    const { api, renderPicker } = setup()
    renderPicker('agent')
    expect(api.listAgentProfiles).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    await screen.findByRole('button', { name: /frontend-artisan Accessible/ })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'correctness' } })
    expect(screen.queryByRole('button', { name: /frontend-artisan Accessible/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /code-reviewer Reviews/ }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { agentId: 'a1' }))
})

test('shows discovery failures with retry instead of pretending that the catalog is empty', async () => {
    const { api, renderPicker } = setup()
    api.listAgentProfiles.mockRejectedValueOnce(new Error('Runner offline'))
    renderPicker('agent')
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Runner offline')
    fireEvent.click(screen.getByRole('button', { name: 'Reload agents' }))
    expect(await screen.findByRole('button', { name: /code-reviewer Reviews/ })).toBeTruthy()
})

test('right click exposes a conversation default action without selecting the agent', async () => {
    const { api, renderPicker } = setup()
    renderPicker('agent')
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: /code-reviewer Reviews/ }))
    expect(api.updatePromptProfile).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set as default for this conversation' }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { defaultAgentId: 'a1' }))
})

test('provides an accessible star action without requiring a mouse context menu', async () => {
    const { api, renderPicker } = setup()
    renderPicker('agent')
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set code-reviewer as conversation default' }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { defaultAgentId: 'a1' }))
})

test('keeps the starred default while switching profiles and restores it explicitly', async () => {
    const { api, renderPicker } = setup()
    renderPicker('agent')
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set code-reviewer as conversation default' }))
    const star = await screen.findByRole('button', { name: 'Remove code-reviewer as conversation default' })
    expect(star).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /code-reviewer Active profile Reviews/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /frontend-artisan Accessible/ }))
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Agent: frontend-artisan' }))
    expect(await screen.findByRole('button', { name: 'Remove code-reviewer as conversation default' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Return to default' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agent: code-reviewer' })).toBeTruthy())
    expect(screen.getByRole('button', { name: /code-reviewer Active profile Reviews/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Remove conversation default' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Return to default' })).toBeNull())
    expect(screen.getByRole('button', { name: /code-reviewer Active profile Reviews/ })).toHaveAttribute('aria-pressed', 'true')
    expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { useDefaultAgent: true })
})

test('opens a portaled menu from the keyboard and Escape returns focus to its row', async () => {
    const { renderPicker } = setup()
    renderPicker('agent')
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    const row = await screen.findByRole('button', { name: /code-reviewer Reviews/ })
    row.focus()
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    const menu = await screen.findByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(row).toHaveFocus()
    expect(screen.getByRole('searchbox')).toBeTruthy()
})
