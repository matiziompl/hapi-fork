import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { I18nProvider } from '@/lib/i18n-context'
import { Autocomplete, type SkillAutocompleteState } from './Autocomplete'

function suggestion(key: string): Suggestion {
    return {
        key,
        text: key,
        label: key,
    }
}

describe('Autocomplete', () => {
    let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | undefined
    let scrollIntoView: ReturnType<typeof vi.fn>

    beforeEach(() => {
        originalScrollIntoView = HTMLElement.prototype.scrollIntoView
        scrollIntoView = vi.fn()
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoView,
        })
    })

    afterEach(() => {
        if (originalScrollIntoView) {
            Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
                configurable: true,
                value: originalScrollIntoView,
            })
        } else {
            delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
        }
        vi.restoreAllMocks()
    })

    it('lets selected rows reach both edges of the overlay', () => {
        const { container } = render(
            <Autocomplete
                suggestions={[suggestion('first'), suggestion('second')]}
                selectedIndex={1}
                onSelect={vi.fn()}
            />
        )

        const list = container.firstElementChild
        expect(list).not.toHaveClass('pt-1')
        expect(list).not.toHaveClass('pb-1')
        expect(screen.getByRole('button', { name: 'second' })).toHaveClass(
            'bg-[var(--app-button)]',
            'text-[var(--app-button-text)]'
        )
    })

    it('does not re-scroll when suggestions only change identity', () => {
        const { rerender } = render(
            <Autocomplete
                suggestions={[suggestion('first'), suggestion('second')]}
                selectedIndex={0}
                onSelect={vi.fn()}
            />
        )
        expect(scrollIntoView).toHaveBeenCalledTimes(1)

        scrollIntoView.mockClear()
        rerender(
            <Autocomplete
                suggestions={[suggestion('first'), suggestion('second')]}
                selectedIndex={0}
                onSelect={vi.fn()}
            />
        )

        expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('previews matching skills and expands the selected description before inserting its full reference', () => {
        const onSelect = vi.fn()
        const skills = ['general', 'review'].map(name => ({
            ...suggestion(`$ponytail:ponytail-${name}`),
            description: `Full ${name} description`,
        }))
        render(<Autocomplete suggestions={skills} selectedIndex={1} onSelect={onSelect} />)
        expect(screen.getAllByRole('button')).toHaveLength(2)
        expect(screen.getByText('Full general description')).toHaveClass('line-clamp-2')
        expect(screen.getByText('Full review description')).not.toHaveClass('line-clamp-2')
        fireEvent.click(screen.getByRole('button', { name: /\$ponytail:ponytail-review/ }))
        expect(onSelect).toHaveBeenCalledWith(1)
    })

    it('shows loading separately from an empty catalog or a search with no matches', () => {
        const state: SkillAutocompleteState = {
            isLoading: true, error: null, hasSkills: false, onRetry: vi.fn(),
        }
        const { rerender } = render(
            <I18nProvider><Autocomplete suggestions={[]} selectedIndex={-1} onSelect={vi.fn()} skillState={state} /></I18nProvider>
        )
        expect(screen.getByRole('status')).toHaveTextContent('Loading skills')
        expect(screen.queryByRole('button')).toBeNull()
        rerender(
            <I18nProvider><Autocomplete suggestions={[]} selectedIndex={-1} onSelect={vi.fn()} skillState={{ ...state, isLoading: false }} /></I18nProvider>
        )
        expect(screen.getByRole('status')).toHaveTextContent('No skills available in this session')
        fireEvent.click(screen.getByRole('button', { name: 'Reload skills' }))
        expect(state.onRetry).toHaveBeenCalledTimes(1)
        rerender(
            <I18nProvider><Autocomplete suggestions={[]} selectedIndex={-1} onSelect={vi.fn()} skillState={{ ...state, isLoading: false, hasSkills: true }} /></I18nProvider>
        )
        expect(screen.getByRole('status')).toHaveTextContent('No matching skills. Type $ to see all skills.')
    })

    it('keeps cached skill previews visible on a failed refresh and offers a retry', () => {
        const onRetry = vi.fn()
        render(
            <I18nProvider>
                <Autocomplete
                    suggestions={[suggestion('$ponytail:ponytail-general')]}
                    selectedIndex={0}
                    onSelect={vi.fn()}
                    skillState={{ isLoading: false, hasSkills: true, error: 'Enumeration RPC timed out', onRetry }}
                />
            </I18nProvider>
        )
        expect(screen.getByRole('button', { name: '$ponytail:ponytail-general' })).toBeVisible()
        expect(screen.getByRole('alert')).toHaveTextContent('Could not load skills.')
        expect(screen.getByRole('alert')).toHaveTextContent('Enumeration RPC timed out')
        fireEvent.click(screen.getByRole('button', { name: 'Reload skills' }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })
})
