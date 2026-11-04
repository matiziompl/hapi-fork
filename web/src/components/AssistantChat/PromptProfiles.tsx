import * as Popover from '@radix-ui/react-popover'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { PromptProfileState, UpdatePromptProfileRequest } from '@hapi/protocol'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PlusIcon } from '@/components/icons'
import { useTranslation } from '@/lib/use-translation'

const buttonClass = 'flex h-8 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50'
const rowClass = 'w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-link)] disabled:opacity-50'
const inputClass = 'w-full rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'
const panelClass = 'z-[80] w-80 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-fg)] shadow-lg'

export function PersonaIcon() {
    return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>
}

function usePromptProfile(api: ApiClient, sessionId: string) {
    const client = useQueryClient()
    const key = ['prompt-profile', sessionId]
    const profile = useQuery({ queryKey: key, queryFn: () => api.getPromptProfile(sessionId), staleTime: 30_000, retry: false })
    const selection = useMutation({
        mutationFn: (input: UpdatePromptProfileRequest) => api.updatePromptProfile(sessionId, input),
        onMutate: () => client.cancelQueries({ queryKey: key }),
        onSuccess: (state: PromptProfileState) => client.setQueryData(key, state),
    })
    return { profile, selection }
}

export function PersonaPicker(props: { api: ApiClient; sessionId: string }) {
    const { api, sessionId } = props
    const { t } = useTranslation()
    const { profile, selection } = usePromptProfile(api, sessionId)
    const [open, setOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [createdPersonaId, setCreatedPersonaId] = useState<string | null>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const fieldId = useId()
    const selected = profile.data?.personas.find(persona => persona.id === profile.data.personaId)
    const creator = useMutation({
        mutationFn: async () => {
            // A failed selection can be retried without creating a duplicate.
            const id = createdPersonaId ?? (await api.createPersona({ name: name.trim(), description: description.trim() })).persona.id
            setCreatedPersonaId(id)
            await selection.mutateAsync({ personaId: id })
        },
        onSuccess: () => {
            setCreating(false)
            setName('')
            setDescription('')
            setCreatedPersonaId(null)
        },
    })
    const choose = async (personaId: string | null) => {
        try {
            await selection.mutateAsync({ personaId })
            setOpen(false)
        } catch { /* Error remains in the picker for retry. */ }
    }
    return <>
        <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (value) void profile.refetch() }}>
            <Popover.Trigger asChild>
                <button ref={triggerRef} type="button" className={`${buttonClass} ${selected ? 'text-[var(--app-link)]' : ''}`}
                    aria-label={selected ? `${t('composer.personas')}: ${selected.name}` : t('composer.personas')}
                    title={selected ? `${t('composer.personas')}: ${selected.name}` : t('composer.personas')}>
                    <PersonaIcon />
                    {selected ? <span className="max-w-24 truncate">{selected.name}</span> : null}
                </button>
            </Popover.Trigger>
            <Popover.Portal><Popover.Content side="top" align="start" sideOffset={8} collisionPadding={12} className={panelClass} aria-label={t('composer.personas')}>
                <div className="px-3 py-2 text-sm font-medium">{t('composer.personas')}</div>
                <div className="max-h-64 overflow-y-auto p-1">
                    <button type="button" className={rowClass} aria-pressed={!selected} disabled={selection.isPending} onClick={() => void choose(null)}>{t('composer.personaNone')}</button>
                    {profile.isPending ? <p role="status" className="px-3 py-2 text-sm text-[var(--app-hint)]">{t('composer.profilesLoading')}</p> : null}
                    {profile.data?.personas.map(persona => <button key={persona.id} type="button" className={rowClass} aria-pressed={selected?.id === persona.id} disabled={selection.isPending} onClick={() => void choose(persona.id)}>
                        <span className="block break-words font-medium">{persona.name}</span>
                        <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap break-words text-xs text-[var(--app-hint)]">{persona.description}</span>
                    </button>)}
                    {profile.data?.personas.length === 0 ? <p className="px-3 py-2 text-sm text-[var(--app-hint)]">{t('composer.personasEmpty')}</p> : null}
                    {profile.error || selection.error ? <p role="alert" className="px-3 py-2 text-sm text-[var(--app-badge-error-text)]">{(profile.error ?? selection.error)?.message}</p> : null}
                </div>
                <div className="flex justify-end border-t border-[var(--app-divider)] p-1">
                    <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]" aria-label={t('composer.personaCreate')} title={t('composer.personaCreate')} onClick={() => { setOpen(false); creator.reset(); setCreating(true) }}><PlusIcon className="h-5 w-5" /></button>
                </div>
            </Popover.Content></Popover.Portal>
        </Popover.Root>
        <Dialog open={creating} onOpenChange={value => { if (!creator.isPending) setCreating(value) }}>
            <DialogContent className="z-[80] max-w-xl" overlayClassName="z-[70]" onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus() }}>
                <DialogHeader><DialogTitle>{t('composer.personaCreate')}</DialogTitle><DialogDescription>{t('composer.personaHint')}</DialogDescription></DialogHeader>
                <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); if (name.trim() && description.trim() && !creator.isPending) creator.mutate() }}>
                    <div className="space-y-1.5"><label htmlFor={`${fieldId}-name`} className="block text-sm font-medium">{t('composer.personaName')}</label><input id={`${fieldId}-name`} autoFocus required maxLength={100} className={inputClass} value={name} disabled={creator.isPending || !!createdPersonaId} onChange={event => setName(event.target.value)} /></div>
                    <div className="space-y-1.5"><label htmlFor={`${fieldId}-description`} className="block text-sm font-medium">{t('composer.personaDescription')}</label><textarea id={`${fieldId}-description`} required maxLength={20000} rows={7} className={`${inputClass} min-h-40 resize-y`} value={description} disabled={creator.isPending || !!createdPersonaId} onChange={event => setDescription(event.target.value)} /></div>
                    {creator.error ? <p role="alert" className="text-sm text-[var(--app-badge-error-text)]">{creator.error.message}</p> : null}
                    <div className="flex justify-end"><button type="submit" disabled={!name.trim() || !description.trim() || creator.isPending} className="rounded-lg bg-[var(--app-button)] px-4 py-2 text-sm font-medium text-[var(--app-button-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50">{creator.isPending ? t('composer.profileSaving') : t('composer.personaSave')}</button></div>
                </form>
            </DialogContent>
        </Dialog>
    </>
}

export function AgentProfilePicker(props: { api: ApiClient; sessionId: string; active: boolean }) {
    const { api, sessionId, active } = props
    const { t } = useTranslation()
    const { profile, selection } = usePromptProfile(api, sessionId)
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const catalog = useQuery({
        queryKey: ['agent-profiles', sessionId], queryFn: () => api.listAgentProfiles(sessionId),
        enabled: open && active, staleTime: 0, gcTime: 5 * 60_000, retry: false,
    })
    const agents = catalog.data?.agents.filter(agent => `${agent.name} ${agent.description}`.toLowerCase().includes(search.toLowerCase())) ?? []
    const choose = async (agentId: string | null) => {
        try { await selection.mutateAsync({ agentId }); setOpen(false) } catch { /* Keep selection errors visible. */ }
    }
    return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (value) { setSearch(''); void profile.refetch() } }}>
        <Popover.Trigger asChild><button type="button" className={buttonClass} aria-label={profile.data?.agent ? `${t('composer.agent')}: ${profile.data.agent.name}` : t('composer.agent')} title={profile.data?.agent?.name ?? t('composer.agent')}>
            <span className="max-w-28 truncate">{profile.data?.agent?.name ?? t('composer.agent')}</span><svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m2 4 3 3 3-3" /></svg>
        </button></Popover.Trigger>
        <Popover.Portal><Popover.Content side="top" align="end" sideOffset={8} collisionPadding={12} className={panelClass} aria-label={t('composer.agent')}>
            <div className="p-2"><input type="search" aria-label={t('composer.agentsSearch')} placeholder={t('composer.agentsSearch')} className={inputClass} value={search} onChange={event => setSearch(event.target.value)} /></div>
            <p className="px-3 pb-2 text-xs text-[var(--app-hint)]">{t('composer.agentProfileHint')}</p>
            <div className="max-h-64 overflow-y-auto px-1 pb-1">
                <button type="button" className={rowClass} aria-pressed={!profile.data?.agent} disabled={selection.isPending} onClick={() => void choose(null)}>{t('composer.agentDefault')}</button>
                {!active ? <p role="status" className="px-3 py-2 text-sm text-[var(--app-hint)]">{t('composer.agentsInactive')}</p> : catalog.isPending ? <p role="status" className="px-3 py-2 text-sm text-[var(--app-hint)]">{t('composer.profilesLoading')}</p> : null}
                {agents.map(agent => <button type="button" key={agent.id} className={rowClass} aria-pressed={profile.data?.agent?.id === agent.id} disabled={selection.isPending} onClick={() => void choose(agent.id)}>
                    <span className="block break-words font-medium">{agent.name}</span><span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-[var(--app-hint)]">{agent.description}</span>
                </button>)}
                {active && !catalog.isPending && !catalog.error && !catalog.data?.warning && agents.length === 0 ? <p role="status" className="px-3 py-2 text-sm text-[var(--app-hint)]">{t(search ? 'composer.agentsNoMatch' : 'composer.agentsEmpty')}</p> : null}
                {catalog.data?.warning ? <p role="status" className="px-3 py-2 text-xs text-[var(--app-hint)]">{catalog.data.warning}</p> : null}
                {catalog.error || profile.error || selection.error ? <p role="alert" className="px-3 py-2 text-sm text-[var(--app-badge-error-text)]">{(catalog.error ?? profile.error ?? selection.error)?.message}</p> : null}
            </div>
            {active ? <div className="flex justify-end border-t border-[var(--app-divider)] p-1"><button type="button" className={buttonClass} disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>{t('composer.agentsReload')}</button></div> : null}
        </Popover.Content></Popover.Portal>
    </Popover.Root>
}
