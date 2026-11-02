import { memo, useEffect, useRef } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useTranslation } from '@/lib/use-translation'

export interface SkillAutocompleteState {
    isLoading: boolean
    error: string | null
    hasSkills: boolean
    onRetry: () => void
}

interface AutocompleteProps {
    suggestions: readonly Suggestion[]
    selectedIndex: number
    onSelect: (index: number) => void
    skillState?: SkillAutocompleteState
}

function SkillStatus({ state, hasMatches }: { state: SkillAutocompleteState; hasMatches: boolean }) {
    const { t } = useTranslation()
    if (!state.isLoading && !state.error && hasMatches) return null
    const message = state.isLoading ? t('composer.skillsLoading')
        : state.error ? t('composer.skillsLoadFailed')
        : state.hasSkills ? t('composer.skillsNoMatches')
        : t('composer.skillsEmpty')
    return (
        <div className="px-3 py-2 text-xs text-[var(--app-hint)]">
            <div role={state.error && !state.isLoading ? 'alert' : 'status'}>
                {message}
                {!state.isLoading && state.error && <div className="mt-1 break-words">{state.error}</div>}
            </div>
            {!state.isLoading && (state.error || !state.hasSkills) && (
                <button
                    type="button"
                    className="mt-2 cursor-pointer text-[var(--app-link)] underline underline-offset-2"
                    onMouseDown={event => event.preventDefault()}
                    onClick={state.onRetry}
                >
                    {t('composer.skillsReload')}
                </button>
            )}
        </div>
    )
}

/**
 * Autocomplete suggestions list component
 */
export const Autocomplete = memo(function Autocomplete(props: AutocompleteProps) {
    const { suggestions, selectedIndex, onSelect, skillState } = props
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (selectedIndex < 0 || selectedIndex >= suggestions.length) return
        const listEl = listRef.current
        if (!listEl) return
        const selectedEl = listEl.querySelector<HTMLButtonElement>(
            `[data-suggestion-index="${selectedIndex}"]`
        )
        selectedEl?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex, suggestions.length])

    if (suggestions.length === 0 && !skillState) {
        return null
    }

    return (
        <div ref={listRef}>
            {suggestions.map((suggestion, index) => (
                <button
                    key={suggestion.key}
                    type="button"
                    data-suggestion-index={index}
                    className={`flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
                        index === selectedIndex
                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                            : 'text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)]'
                    }`}
                    onClick={() => onSelect(index)}
                    onMouseDown={(e) => e.preventDefault()} // Prevent blur on textarea
                >
                    <span className="w-full break-words font-medium">{suggestion.label}</span>
                    {suggestion.description && (
                        <span className={`w-full min-h-[2.25rem] break-words text-xs leading-snug ${
                            suggestion.text.startsWith('$') && index === selectedIndex ? '' : 'line-clamp-2'
                        } ${
                            index === selectedIndex
                                ? 'opacity-80'
                                : 'text-[var(--app-hint)]'
                        }`}>
                            {suggestion.description}
                        </span>
                    )}
                </button>
            ))}
            {skillState && <SkillStatus state={skillState} hasMatches={suggestions.length > 0} />}
        </div>
    )
})
