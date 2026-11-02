import type { ITheme } from '@xterm/xterm'

export function getTerminalTheme(): ITheme {
    const styles = getComputedStyle(document.documentElement)
    const color = (name: string) => styles.getPropertyValue(`--terminal-${name}`).trim() || undefined
    // ANSI colors retain xterm defaults; the console palette is shared with
    // its frame in CSS and remains black/green in either app theme.
    return {
        background: color('bg'),
        foreground: color('fg'),
        cursor: color('cursor'),
        cursorAccent: color('bg'),
        selectionBackground: color('selection-bg'),
        selectionForeground: color('selection-fg'),
    }
}
