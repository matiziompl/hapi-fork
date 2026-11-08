import { useEffect, useState } from 'react'
import type { AgentFlavor, AgentProfile } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { SelectControl } from '@/components/ui/select-control'
import { useTranslation } from '@/lib/use-translation'

export function DefaultAgentSelector(props: {
    api: ApiClient
    machineId: string | null
    flavor: AgentFlavor
    cwd: string
    directoryExists: boolean | undefined
    value: string
    disabled: boolean
    onChange: (id: string) => void
}) {
    const { t } = useTranslation()
    const [catalog, setCatalog] = useState<{ agents: AgentProfile[]; warning?: string; error?: string; loading?: boolean }>({ agents: [] })
    const [reload, setReload] = useState(0)
    const enabled = !!props.machineId && !!props.cwd && props.directoryExists === true
    useEffect(() => {
        let current = true
        setCatalog({ agents: [], loading: enabled })
        if (enabled) {
            Promise.resolve().then(() => props.api.listMachineAgentProfiles(props.machineId!, props.flavor, props.cwd)).then(
                result => { if (current) setCatalog(result) },
                error => { if (current) setCatalog({ agents: [], error: error instanceof Error ? error.message : String(error) }) },
            )
        }
        return () => { current = false }
    }, [props.api, props.machineId, props.flavor, props.cwd, enabled, reload])
    return <div className="space-y-2 px-3 py-2">
        <label className="block space-y-2 text-sm">
            <span className="font-medium">{t('composer.conversationDefault')}</span>
            <SelectControl value={props.value} disabled={props.disabled || !enabled || catalog.loading} onChange={event => props.onChange(event.target.value)} className="rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50">
                <option value="">{t('composer.agentDefault')}</option>
                {props.value && !catalog.agents.some(agent => agent.id === props.value) ? <option value={props.value}>{props.value}</option> : null}
                {catalog.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </SelectControl>
        </label>
        <p className="text-xs text-[var(--app-hint)]">{t(enabled ? 'newSession.agentProfileHint' : 'newSession.agentProfileChooseDirectory')}</p>
        {catalog.loading ? <p role="status" className="text-xs text-[var(--app-hint)]">{t('composer.profilesLoading')}</p> : null}
        {catalog.error ? <p role="alert" className="text-xs text-[var(--app-badge-error-text)]">{catalog.error}</p> : null}
        {catalog.warning ? <p role="status" className="text-xs text-[var(--app-hint)]">{catalog.warning}</p> : null}
        {enabled && props.value && !catalog.loading && !catalog.error && !catalog.agents.some(agent => agent.id === props.value) ? <p role="alert" className="text-xs text-[var(--app-badge-error-text)]">{t('newSession.agentProfileUnavailable')}</p> : null}
        {enabled ? <button type="button" disabled={props.disabled || catalog.loading} className="text-xs text-[var(--app-link)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]" onClick={() => setReload(value => value + 1)}>{t('composer.agentsReload')}</button> : null}
    </div>
}
