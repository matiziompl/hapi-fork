import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { SkillsResponse } from '@/types/api'
import { useActiveSuggestions } from '@/hooks/useActiveSuggestions'
import { queryKeys } from '@/lib/query-keys'
import { applySuggestion } from '@/utils/applySuggestion'
import { useSkills } from './useSkills'

const ponytailSkills = ['audit', 'debt', 'gain', 'general', 'help', 'review'].map(name => ({
    name: `ponytail:ponytail-${name}`,
    description: `Ponytail ${name} description`,
}))
const catalog: SkillsResponse = {
    success: true,
    skills: [...ponytailSkills, { name: 'skill-creator', description: 'Create a skill' }],
}

function setup(getSkills: ReturnType<typeof vi.fn>, cached?: SkillsResponse) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    if (cached) client.setQueryData(queryKeys.skills('session-1'), cached)
    const api = { getSkills } as unknown as ApiClient
    const wrapper = ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(({ text }: { text: string | null }) => {
        const skills = useSkills(api, 'session-1')
        const [suggestions, selected, , , clear, isOpen] = useActiveSuggestions(text, skills.getSuggestions)
        return { ...skills, suggestions, selected, clear, isOpen }
    }, { wrapper, initialProps: { text: null as string | null } })
    return { ...hook, client }
}

describe('skill autocomplete', () => {
    beforeEach(() => localStorage.clear())

    it('previews every matching plugin skill with its full name and description after $pony', async () => {
        let resolve!: (value: SkillsResponse) => void
        const getSkills = vi.fn(() => new Promise<SkillsResponse>(done => { resolve = done }))
        const { result, rerender, client } = setup(getSkills)
        rerender({ text: '$pony' })
        await act(async () => resolve(catalog))
        await waitFor(() => expect(result.current.suggestions).toHaveLength(6))
        expect(result.current.suggestions.map(item => [item.text, item.description])).toEqual(
            ponytailSkills.map(skill => [`$${skill.name}`, skill.description])
        )
        expect(getSkills).toHaveBeenCalledTimes(1)
        const selected = result.current.suggestions.find(item => item.text.endsWith('-review'))!
        expect(applySuggestion('Use $pony', { start: 9, end: 9 }, selected.text, ['$', '@', '/'], true).text)
            .toBe('Use $ponytail:ponytail-review ')
        rerender({ text: '$' })
        await waitFor(() => expect(result.current.suggestions).toHaveLength(7))
        client.clear()
    })

    it('retries a failed initial catalog when the user enters a prefix directly', async () => {
        const getSkills = vi.fn()
            .mockResolvedValueOnce({ success: false, error: 'Enumeration RPC timed out' })
            .mockResolvedValue(catalog)
        const { result, rerender, client } = setup(getSkills)
        await waitFor(() => expect(result.current.error).toBe('Enumeration RPC timed out'))
        rerender({ text: '$pony' })
        await waitFor(() => expect(result.current.suggestions).toHaveLength(6))
        expect(getSkills).toHaveBeenCalledTimes(2)
        client.clear()
    })

    it('refreshes a cached catalog for a partial prefix once while keeping cached previews visible', async () => {
        let resolve!: (value: SkillsResponse) => void
        const getSkills = vi.fn(() => new Promise<SkillsResponse>(done => { resolve = done }))
        const { result, rerender, client } = setup(getSkills, { success: true, skills: ponytailSkills.slice(0, 1) })
        rerender({ text: '$pony' })
        await waitFor(() => expect(getSkills).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(result.current.suggestions).toHaveLength(1))
        expect(result.current.isLoading).toBe(true)
        rerender({ text: '$ponyt' })
        rerender({ text: '$ponytail' })
        await act(async () => resolve(catalog))
        await waitFor(() => expect(result.current.suggestions).toHaveLength(6))
        expect(getSkills).toHaveBeenCalledTimes(1)
        client.clear()
    })

    it('keeps a dismissed picker closed when a delayed catalog arrives', async () => {
        let resolve!: (value: SkillsResponse) => void
        const getSkills = vi.fn(() => new Promise<SkillsResponse>(done => { resolve = done }))
        const { result, rerender, client } = setup(getSkills)
        rerender({ text: '$pony' })
        await waitFor(() => expect(result.current.isOpen).toBe(true))
        act(() => result.current.clear())
        await act(async () => resolve(catalog))
        await waitFor(() => expect(result.current.skills).toHaveLength(7))
        expect(result.current.isOpen).toBe(false)
        expect(result.current.suggestions).toEqual([])
        rerender({ text: '$ponyt' })
        await waitFor(() => expect(result.current.suggestions).toHaveLength(6))
        client.clear()
    })

    it('allows an explicit retry after a failed picker refresh without a request loop', async () => {
        const getSkills = vi.fn().mockResolvedValue({ success: false, error: 'Runner unavailable' })
        const { result, rerender, client } = setup(getSkills, { success: true, skills: ponytailSkills })
        rerender({ text: '$pony' })
        await waitFor(() => expect(result.current.error).toBe('Runner unavailable'))
        expect(result.current.suggestions).toHaveLength(6)
        expect(getSkills).toHaveBeenCalledTimes(1)
        getSkills.mockResolvedValue(catalog)
        act(() => result.current.refresh())
        await waitFor(() => expect(result.current.error).toBeNull())
        expect(getSkills).toHaveBeenCalledTimes(2)
        client.clear()
    })
})
