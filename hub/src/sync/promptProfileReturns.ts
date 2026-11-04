import { contentWithPromptProfile, isObject, promptProfileDeliveryPrefix } from '@hapi/protocol'
import type { Store } from '../store'

// CLIs may mirror a delivered prompt into their transcript or return it after
// interruption. Match the exact durable snapshot before hiding any text.
function cleanReturnedText(store: Store, sessionId: string, text: string): { text: string; unverified: boolean } {
    const markers = /<hapi-profile id="([^"\n]+)">\n/g
    let output = ''
    let cursor = 0
    let unverified = false
    for (const marker of text.matchAll(markers)) {
        const at = marker.index!
        if (at < cursor) continue
        let localId: string
        try { localId = JSON.parse(`"${decodeURIComponent(marker[1]!)}"`) as string } catch { unverified = true; continue }
        const message = store.messages.getMessageByLocalId(sessionId, localId)
        if (!message) { unverified = true; continue }
        const prefix = promptProfileDeliveryPrefix(message.content)
        if (!prefix || !text.startsWith(prefix, at)) { unverified = true; continue }
        const delivered = contentWithPromptProfile(message.content)
        const original = isObject(message.content) && isObject(message.content.content) ? message.content.content.text : null
        const wire = isObject(delivered) && isObject(delivered.content) ? delivered.content.text : null
        const start = typeof wire === 'string' ? at - wire.indexOf(prefix) : -1
        if (typeof wire === 'string' && typeof original === 'string' && start >= cursor && text.startsWith(wire, start)) {
            output += text.slice(cursor, start) + original
            cursor = start + wire.length
            continue
        }
        output += text.slice(cursor, at)
        cursor = at + prefix.length
        // Preserve user-authored text literally, including examples of markers.
        if (typeof original === 'string' && text.startsWith(original, cursor)) {
            output += original
            cursor += original.length
        }
    }
    return { text: cursor ? output + text.slice(cursor) : text, unverified }
}

export function normalizePromptProfileReturn(store: Store, sessionId: string, content: unknown): unknown | null {
    if (!isObject(content) || !isObject(content.content)) return content
    const body = content.content
    if (content.role === 'user' && typeof body.text === 'string') {
        const { text, unverified } = cleanReturnedText(store, sessionId, body.text)
        if (isObject(content.meta) && content.meta.isTranscriptEcho === true && (text !== body.text || unverified)) return null
        if (text === body.text) return content
        return { ...content, content: { ...body, text } }
    }
    if (content.role === 'agent' && body.type === 'event' && isObject(body.data)
        && body.data.type === 'abort-restore' && typeof body.data.text === 'string') {
        const { text, unverified } = cleanReturnedText(store, sessionId, body.data.text)
        if (unverified) return { ...content, content: { ...body, data: {
            type: 'message', message: 'The interrupted prompt could not be safely restored because its saved profile is unavailable. Your draft was left unchanged.',
        } } }
        return text === body.data.text ? content : { ...content, content: { ...body, data: { ...body.data, text } } }
    }
    return content
}
