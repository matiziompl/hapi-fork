import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getTerminalTheme } from '@/lib/terminalTheme'
import { useAgentTerminalSocket } from '@/hooks/useAgentTerminalSocket'
import { useQuickKeyInput, QuickKeyRows } from '@/components/QuickKeys/QuickKeys'
import { useAppContext } from '@/lib/app-context'

type AgentTerminalViewProps = {
    sessionId: string
    visible: boolean
    className?: string
}

// Interactive view of the agent PTY. The chat composer remains the primary way
// to send messages (multiline, IME, mobile), but this terminal also accepts raw
// keystrokes + quick keys so a viewer can drive TUI screens the composer cannot
// express (escape a /usage screen, answer a /model dialog, send Ctrl-C).
export function AgentTerminalView(props: AgentTerminalViewProps) {
    const { sessionId, visible, className } = props
    const { token, baseUrl } = useAppContext()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)

    const {
        state,
        connect,
        disconnect,
        resubscribe,
        unsubscribe,
        onOutput,
        resize,
        sendInput,
    } = useAgentTerminalSocket({
        baseUrl,
        token,
        sessionId,
    })

    // Raw keystrokes (terminal typing AND quick keys) share one sticky-modifier
    // state, then go to the agent PTY via sendInput.
    const { ctrlActive, altActive, dispatch, toggleModifier } = useQuickKeyInput({ onSend: sendInput })

    const onOutputRef = useRef(onOutput)
    useEffect(() => {
        onOutputRef.current = onOutput
    }, [onOutput])

    const resizeRef = useRef(resize)
    useEffect(() => {
        resizeRef.current = resize
    }, [resize])

    // Dispatch is stable, but the terminal is created once (mount effect), so
    // read it through a ref to avoid re-creating the terminal on identity change.
    const dispatchRef = useRef(dispatch)
    useEffect(() => {
        dispatchRef.current = dispatch
    }, [dispatch])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const abortController = new AbortController()

        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            theme: getTerminalTheme(),
            convertEol: true,
            customGlyphs: true,
            cols: 80,
            rows: 12,
        })

        const fitAddon = new FitAddon()
        fitAddonRef.current = fitAddon
        terminal.loadAddon(fitAddon)
        terminal.open(container)

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(() => {
                fitAddon.fit()
                // Push the fitted size to the agent PTY so the TUI re-renders at
                // the viewer's dimensions (and repaints — no black screen).
                resizeRef.current(terminal.cols, terminal.rows)
            })
        })
        observer.observe(container)

        onOutputRef.current((data) => {
            terminal.write(data)
        })

        // Interactive: forward typed keystrokes to the agent PTY (with sticky
        // modifiers applied) so a viewer can drive TUI screens the chat composer
        // cannot express (e.g. escape a /usage screen, answer a dialog).
        const inputDisposable = terminal.onData((data) => {
            dispatchRef.current(data)
        })

        abortController.signal.addEventListener('abort', () => {
            observer.disconnect()
            inputDisposable.dispose()
            fitAddon.dispose()
            terminal.dispose()
        })

        requestAnimationFrame(() => {
            fitAddon.fit()
        })
        terminalRef.current = terminal

        return () => abortController.abort()
    }, [])

    useEffect(() => {
        connect()
        return () => disconnect()
    }, [connect, disconnect])

    useEffect(() => {
        if (!visible) return
        resubscribe()
        requestAnimationFrame(() => {
            fitAddonRef.current?.fit()
            const terminal = terminalRef.current
            if (terminal) {
                // On (re)entry: sync size and trigger a repaint so the current
                // screen shows instead of a stale/black buffer replay.
                resizeRef.current(terminal.cols, terminal.rows)
            }
        })
        // Leaving the terminal view (hidden or unmounted) → unsubscribe so the
        // CLI can stop streaming the PTY when no viewers remain.
        return () => unsubscribe()
    }, [visible, resubscribe, unsubscribe])

    const statusColor = state.status === 'connected'
        ? 'bg-emerald-500'
        : state.status === 'connecting'
            ? 'bg-amber-400 animate-pulse'
            : state.status === 'error'
                ? 'bg-red-500'
                : 'bg-[var(--app-hint)]'

    return (
        <div className={`hapi-terminal-frame flex flex-col min-h-0 ${className ?? ''}`}>
            <div className="hapi-terminal-heading flex items-center gap-2 px-3 py-2">
                <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                <span className="text-xs text-[var(--terminal-heading-fg)]">
                    {state.status === 'connected' ? 'Agent terminal connected' :
                     state.status === 'connecting' ? 'Connecting...' :
                     state.status === 'error' ? `Error: ${state.error}` :
                     'Disconnected'}
                </span>
            </div>

            <div ref={containerRef} className="hapi-terminal flex-1 min-h-0 p-3" />

            <div className="flex flex-col gap-1 bg-[var(--app-bg)] px-2 pb-2 pt-1">
                <QuickKeyRows
                    ctrlActive={ctrlActive}
                    altActive={altActive}
                    disabled={state.status !== 'connected'}
                    onPress={(sequence) => {
                        dispatch(sequence)
                        terminalRef.current?.focus()
                    }}
                    onToggleModifier={(modifier) => {
                        toggleModifier(modifier)
                        terminalRef.current?.focus()
                    }}
                />
            </div>
        </div>
    )
}
