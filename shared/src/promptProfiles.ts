import { z } from 'zod'
import { isObject } from './utils'

export const CreatePersonaRequestSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(20_000),
})
export type CreatePersonaRequest = z.infer<typeof CreatePersonaRequestSchema>
export const PersonaSchema = CreatePersonaRequestSchema.extend({ id: z.string().min(1) })
export type Persona = z.infer<typeof PersonaSchema>

export const AgentProfileSchema = z.object({
    id: z.string().min(1).max(1000),
    name: z.string().min(1).max(200),
    description: z.string().max(4000),
    source: z.string().max(1000),
})
export type AgentProfile = z.infer<typeof AgentProfileSchema>
export type PromptProfileState = {
    personas: Persona[]
    personaId: string | null
    agent: AgentProfile | null
}

export const UpdatePromptProfileRequestSchema = z.object({
    personaId: z.string().min(1).max(100).nullable().optional(),
    agentId: z.string().min(1).max(1000).nullable().optional(),
}).refine(value => value.personaId !== undefined || value.agentId !== undefined)
export type UpdatePromptProfileRequest = z.infer<typeof UpdatePromptProfileRequestSchema>

// Stored text stays exactly as typed. Only delivery to the existing CLI
// protocol expands this immutable snapshot (including reconnect and retry).
export function contentWithPromptProfile(content: unknown): unknown {
    if (!isObject(content) || content.role !== 'user' || !isObject(content.content)
        || typeof content.content.text !== 'string' || !isObject(content.meta)
        || typeof content.meta.hapiPromptPrefix !== 'string' || !content.meta.hapiPromptPrefix) return content
    const text = content.content.text
    const prefix = promptProfileDeliveryPrefix(content)
    const skill = /^(\s*\$\S+)(\s*)/.exec(text)
    const delivered = skill
        ? skill[1] + (skill[2] || '\n') + prefix + text.slice(skill[0].length)
        : prefix + text
    return { ...content, content: { ...content.content, text: delivered } }
}

export function promptProfileDeliveryPrefix(content: unknown): string {
    if (!isObject(content) || !isObject(content.meta) || typeof content.meta.hapiPromptPrefix !== 'string') return ''
    const prefix = content.meta.hapiPromptPrefix
    const id = content.meta.hapiPromptId
    return typeof id === 'string' && prefix
        ? `<hapi-profile id="${encodeURIComponent(JSON.stringify(id).slice(1, -1))}">\n${prefix}</hapi-profile>\n\n`
        : prefix
}

export function withoutPromptProfilePrefix(content: unknown, text: string): string {
    const prefix = promptProfileDeliveryPrefix(content)
    if (!prefix) return text
    const delivered = contentWithPromptProfile(content)
    if (isObject(content) && isObject(content.content) && typeof content.content.text === 'string'
        && isObject(delivered) && isObject(delivered.content) && delivered.content.text === text) return content.content.text
    if (text.startsWith(prefix)) return text.slice(prefix.length)
    const skill = /^\s*\$\S+\s+/.exec(text)
    const at = skill?.[0].length ?? -1
    return at >= 0 && text.startsWith(prefix, at) ? text.slice(0, at) + text.slice(at + prefix.length) : text
}
