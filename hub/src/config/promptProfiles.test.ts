import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyPromptProfileSelection, getPromptProfilePrefix, readPromptProfile, updatePromptProfile } from './promptProfiles'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

test('conversation defaults survive active overrides, clearing, restore and resume without leaking', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hapi-default-profile-'))
    directories.push(dir)
    const reviewer = { id: 'reviewer', name: 'Reviewer', description: '', source: 'project', instruction: 'Review carefully.' }
    const writer = { ...reviewer, id: 'writer', name: 'Writer', instruction: 'Write clearly.' }
    expect((await readPromptProfile(dir, 'one', 's1')).defaultAgent).toBeNull()
    await updatePromptProfile(dir, 'one', 's1', { defaultAgentId: reviewer.id }, undefined, reviewer)
    await updatePromptProfile(dir, 'one', 's1', { agentId: writer.id }, writer)
    expect((await readPromptProfile(dir, 'one', 's1')).defaultAgent?.id).toBe('reviewer')
    expect(await getPromptProfilePrefix(dir, 'one', 's1')).toContain('Write clearly.')
    await copyPromptProfileSelection(dir, 'one', 's1', 'resumed')
    await updatePromptProfile(dir, 'one', 'resumed', { useDefaultAgent: true })
    expect(await getPromptProfilePrefix(dir, 'one', 'resumed')).toContain('Review carefully.')
    expect((await readPromptProfile(dir, 'one', 's1')).agent?.id).toBe('writer')
    expect((await readPromptProfile(dir, 'two', 's1')).defaultAgent).toBeNull()
    expect((await readPromptProfile(dir, 'one', 'other')).defaultAgent).toBeNull()
    await updatePromptProfile(dir, 'one', 's1', { defaultAgentId: null })
    expect((await readPromptProfile(dir, 'one', 's1')).agent?.id).toBe('writer')
    await updatePromptProfile(dir, 'one', 's1', { useDefaultAgent: true })
    expect(await getPromptProfilePrefix(dir, 'one', 's1')).toBe('')
})
