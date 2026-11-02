import { describe, expect, it } from 'vitest'
import { findNativeCliCommand } from '@hapi/protocol/slashCommands'
import { getNativeCommandDraft, saveNativeCommandDraft, clearNativeCommandDraft } from './nativeCommands'

describe('native command drafts', () => {
    it('keeps commands outside URLs and preserves them until an explicit submit', () => {
        saveNativeCommandDraft('sid', '/config')
        expect(getNativeCommandDraft('sid')).toBe('/config')
        expect(getNativeCommandDraft('sid')).toBe('/config')
        expect(getNativeCommandDraft('other')).toBe('')
        clearNativeCommandDraft('sid')
        expect(getNativeCommandDraft('sid')).toBe('')
    })
    it('routes the complete documented command set to real CLI screens', () => {
        for (const name of ['skills', 'apps', 'plugins', 'review', 'import', 'presets', 'voice', 'cd', 'daemon', 'export', 'quit']) {
            expect(findNativeCliCommand(`/${name}`, 'codex')?.execution).toBe('native')
        }
        for (const name of ['skills', 'agents', 'settings', 'hooks', 'credits', 'plan', 'boost', 'teamwork', 'schedule', 'fork', 'rewind']) {
            expect(findNativeCliCommand(`/${name}`, 'agy')?.execution).toBe('native')
        }
    })
})
