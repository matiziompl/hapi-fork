import { expect, it, vi } from 'vitest'
import { MessageQueue2 } from './MessageQueue2'

it('leaves messages cancelable while a native terminal holds the dequeue gate', async () => {
    const queue = new MessageQueue2(() => 'mode')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const entered = vi.fn(() => gate)
    queue.push('prompt', {}, 'prompt-id')
    const pending = queue.waitForMessagesAndGetAsString(undefined, entered)
    await vi.waitFor(() => expect(entered).toHaveBeenCalled())
    expect(queue.size()).toBe(1)
    expect(queue.cancelByLocalId('prompt-id')).toBe(true)
    release()
    expect(await pending).toBeNull()
})
