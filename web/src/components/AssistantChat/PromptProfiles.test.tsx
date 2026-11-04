import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { PersonaPicker, AgentProfilePicker } from './PromptProfiles'

afterEach(cleanup)
const persona = { id: 'p1', name: 'Reviewer', description: 'Find regressions.' }
function setup() {
    let state = { personas: [persona], personaId: null as string | null, agent: null }
    const api = {
        getPromptProfile: vi.fn(async () => state),
        updatePromptProfile: vi.fn(async (_id, input) => { state = { ...state, ...input }; return state }),
        createPersona: vi.fn(async input => ({ persona: { id: 'p2', ...input } })),
        listAgentProfiles: vi.fn(async () => ({ agents: [
            { id: 'a1', name: 'code-reviewer', description: 'Reviews correctness.', source: 'user' },
            { id: 'a2', name: 'frontend-artisan', description: 'Accessible interfaces.', source: 'project' },
        ] })),
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
    await screen.findByRole('button', { name: /frontend-artisan/ })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), { target: { value: 'correctness' } })
    expect(screen.queryByRole('button', { name: /frontend-artisan/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /code-reviewer/ }))
    await waitFor(() => expect(api.updatePromptProfile).toHaveBeenCalledWith('s1', { agentId: 'a1' }))
})

test('shows discovery failures with retry instead of pretending that the catalog is empty', async () => {
    const { api, renderPicker } = setup()
    api.listAgentProfiles.mockRejectedValueOnce(new Error('Runner offline'))
    renderPicker('agent')
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Runner offline')
    fireEvent.click(screen.getByRole('button', { name: 'Reload agents' }))
    expect(await screen.findByRole('button', { name: /code-reviewer/ })).toBeTruthy()
})
