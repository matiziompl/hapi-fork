import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { formatAgentStatusTime } from '@hapi/protocol'
import { AgentStatusCard } from './AgentStatusCard'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

afterEach(() => { cleanup(); vi.useRealTimers() })

const report = {
    version: 1, agent: 'Codex', model: 'GPT-6.1-Sol', reasoning: 'xhigh', permissions: 'yolo',
    directory: '/workspace', sessionState: 'idle', checkedAt: Date.parse('2026-11-01T20:00:50Z'),
    limits: [{ label: '300 min limit', remainingPercent: 14, resetsAt: Date.parse('2026-11-01T22:33:59Z') }],
    unavailableMessage: null,
}

function renderCard(code = JSON.stringify(report)) {
    return render(<I18nProvider><AgentStatusCard code={code} /></I18nProvider>)
}

describe('CLI-style agent status', () => {
    it('renders the persisted chat report through the existing Markdown pipeline without exposing its JSON', () => {
        render(<I18nProvider><MarkdownRenderer content={`\`\`\`hapi-status\n${JSON.stringify(report)}\n\`\`\``} /></I18nProvider>)
        expect(screen.getByRole('progressbar', { name: '300 min limit' })).toBeInTheDocument()
        expect(document.body.textContent).not.toContain('remainingPercent')
    })
    it('shows real quota as an accessible bar, with 24-hour Polish time and whole minutes', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-11-01T20:00:00Z'))
        renderCard()
        expect(screen.getByRole('progressbar', { name: '300 min limit' })).toHaveAttribute('aria-valuenow', '14')
        expect(screen.getByText('14% remaining')).toBeInTheDocument()
        expect(screen.getByText(/23:33/)).toBeInTheDocument()
        expect(screen.getByText(/154 min/)).toBeInTheDocument()
        expect(screen.getByText(/21:00/)).toBeInTheDocument()
        expect(document.body.textContent).not.toMatch(/UTC|CET|CEST|\bAM\b|\bPM\b|23:33:59/)
    })

    it('keeps unknown quotas explicit without inventing a progress bar', () => {
        renderCard(JSON.stringify({ ...report, limits: [], unavailableMessage: 'Account quota is unknown.' }))
        expect(screen.queryByRole('progressbar')).toBeNull()
        expect(screen.getByText('Account quota is unknown.')).toBeInTheDocument()
    })

    it('does not render malformed or out-of-range provider data as a valid quota', () => {
        renderCard(JSON.stringify({ ...report, limits: [{ ...report.limits[0], remainingPercent: 120 }] }))
        expect(screen.queryByRole('progressbar')).toBeNull()
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('uses Polish DST rules even when the browser runs in another timezone', () => {
        expect(formatAgentStatusTime(Date.parse('2026-01-10T22:05:59Z'))).toBe('10.01.2026, 23:05')
        expect(formatAgentStatusTime(Date.parse('2026-07-10T22:05:59Z'))).toBe('11.07.2026, 00:05')
    })
})
