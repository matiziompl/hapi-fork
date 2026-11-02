import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { formatAgentStatusTime, parseAgentStatusReport } from '@hapi/protocol'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import { useTranslation } from '@/lib/use-translation'

export function AgentStatusCard(props: Pick<SyntaxHighlighterProps, 'code'>) {
    const { t } = useTranslation()
    const report = parseAgentStatusReport(props.code)
    useMinuteTick(Boolean(report?.limits.length))
    if (!report) return <div role="alert">{t('agentStatus.invalid')}</div>
    const fields = [
        [t('agentStatus.model'), report.model],
        [t('agentStatus.reasoning'), report.reasoning],
        [t('agentStatus.permissions'), report.permissions],
        [t('agentStatus.directory'), report.directory],
        [t('agentStatus.state'), report.sessionState],
    ]

    return (
        <section aria-label={`${report.agent} — ${t('settings.chat.composerToolbar.item.status')}`}
            className="my-3 w-full min-w-0 max-w-2xl overflow-hidden rounded-lg border border-[var(--agent-status-border)] bg-[var(--agent-status-bg)] px-4 py-4 font-mono text-[13px] leading-6 text-[var(--agent-status-fg)] sm:px-5"
            style={{ whiteSpace: 'normal' }}>
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 6 6-6 6M13 18h7" /></svg>
                {report.agent}
            </div>
            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                {fields.map(([name, value]) => <div key={name} className="contents">
                    <dt className="text-[var(--agent-status-muted)]">{name}</dt>
                    <dd className="m-0 min-w-0 break-words [overflow-wrap:anywhere]">{value}</dd>
                </div>)}
            </dl>
            <div className="mt-5 space-y-4">
                {report.limits.map((limit, index) => {
                    const remaining = Math.round(limit.remainingPercent)
                    const minutes = limit.resetsAt === null ? null : Math.max(0, Math.ceil((limit.resetsAt - Date.now()) / 60_000))
                    return <div key={`${limit.label}-${index}`}>
                        <div className="mb-1 flex items-baseline justify-between gap-3">
                            <span className="min-w-0 break-words text-[var(--agent-status-muted)]">{limit.label}</span>
                            <span className={`shrink-0 tabular-nums ${remaining <= 15 ? 'text-[var(--agent-status-warning)]' : ''}`}>
                                {t('agentStatus.remaining', { percent: remaining })}
                            </span>
                        </div>
                        <div role="progressbar" aria-label={limit.label} aria-valuemin={0} aria-valuemax={100}
                            aria-valuenow={remaining} className="h-2.5 overflow-hidden bg-[var(--agent-status-border)]">
                            <div className={`h-full ${remaining <= 15 ? 'bg-[var(--agent-status-warning)]' : 'bg-[var(--agent-status-fill)]'}`} style={{ width: `${limit.remainingPercent}%` }} />
                        </div>
                        <div className="mt-1 text-xs tabular-nums text-[var(--agent-status-muted)]">
                            {t('agentStatus.reset')}: {limit.resetsAt === null ? t('agentStatus.unknown') : formatAgentStatusTime(limit.resetsAt)}
                            {minutes !== null ? ` · ${t('agentStatus.minutes', { minutes })}` : ''}
                        </div>
                    </div>
                })}
                {report.unavailableMessage ? <p className="m-0 text-xs text-[var(--agent-status-muted)]">{report.unavailableMessage}</p> : null}
            </div>
            <div className="mt-5 text-xs tabular-nums text-[var(--agent-status-muted)]">
                {t('agentStatus.checked')}: {formatAgentStatusTime(report.checkedAt)}
            </div>
        </section>
    )
}
