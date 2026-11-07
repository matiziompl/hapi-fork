import { randomUUID } from 'node:crypto'
import type { AgentProfile, CreatePersonaRequest, Persona, PromptProfileState, UpdatePromptProfileRequest } from '@hapi/protocol'
import { getSettingsFile, readSettingsOrThrowCached, updateSettings } from './settings'

export type SelectedAgentProfile = AgentProfile & { instruction: string }
export type StoredPromptProfiles = {
    personas: Persona[]
    sessions: Record<string, { personaId: string | null; agent: SelectedAgentProfile | null; defaultAgent?: SelectedAgentProfile | null }>
}

export class PromptProfileError extends Error {
    constructor(message: string, readonly status: 400 | 409) { super(message) }
}

function profilesForNamespace(profiles: Record<string, StoredPromptProfiles> | undefined, namespace: string): StoredPromptProfiles {
    return profiles && Object.hasOwn(profiles, namespace) ? profiles[namespace]! : { personas: [], sessions: {} }
}

function selectionForSession(profiles: StoredPromptProfiles, sessionId: string) {
    return Object.hasOwn(profiles.sessions, sessionId) ? profiles.sessions[sessionId]! : { personaId: null, agent: null }
}

function toState(profiles: StoredPromptProfiles, sessionId: string): PromptProfileState {
    const selection = selectionForSession(profiles, sessionId)
    const agent = selection.agent
    return {
        personas: profiles.personas,
        personaId: selection.personaId,
        agent: agent ? { id: agent.id, name: agent.name, description: agent.description, source: agent.source } : null,
        defaultAgent: selection.defaultAgent ? {
            id: selection.defaultAgent.id, name: selection.defaultAgent.name,
            description: selection.defaultAgent.description, source: selection.defaultAgent.source,
        } : null,
    }
}

export async function readPromptProfile(dataDir: string, namespace: string, sessionId: string): Promise<PromptProfileState> {
    const settings = await readSettingsOrThrowCached(getSettingsFile(dataDir))
    return toState(profilesForNamespace(settings.promptProfiles, namespace), sessionId)
}

export async function createPersona(dataDir: string, namespace: string, input: CreatePersonaRequest): Promise<Persona> {
    return updateSettings(getSettingsFile(dataDir), settings => {
        const profiles = profilesForNamespace(settings.promptProfiles, namespace)
        if (profiles.personas.some(persona => persona.name.toLowerCase() === input.name.toLowerCase())) {
            throw new PromptProfileError('A persona with this name already exists', 409)
        }
        if (profiles.personas.length >= 200) throw new PromptProfileError('Persona limit reached (200)', 400)
        const persona = { id: randomUUID(), ...input }
        return {
            settings: { ...settings, promptProfiles: { ...settings.promptProfiles, [namespace]: { ...profiles, personas: [...profiles.personas, persona] } } },
            result: persona,
        }
    })
}

export async function updatePromptProfile(
    dataDir: string, namespace: string, sessionId: string,
    input: UpdatePromptProfileRequest, agent?: SelectedAgentProfile | null, defaultAgent?: SelectedAgentProfile | null,
): Promise<PromptProfileState> {
    return updateSettings(getSettingsFile(dataDir), settings => {
        const profiles = profilesForNamespace(settings.promptProfiles, namespace)
        if (input.personaId && !profiles.personas.some(persona => persona.id === input.personaId)) {
            throw new PromptProfileError('Persona not found', 400)
        }
        const previous = selectionForSession(profiles, sessionId)
        const selection = {
            personaId: input.personaId === undefined ? previous.personaId : input.personaId,
            agent: input.useDefaultAgent ? previous.defaultAgent ?? null
                : input.defaultAgentId ? defaultAgent ?? null
                : input.agentId === undefined ? previous.agent : agent ?? null,
            defaultAgent: input.defaultAgentId === undefined ? previous.defaultAgent ?? null : defaultAgent ?? null,
        }
        const next = { ...profiles, sessions: { ...profiles.sessions, [sessionId]: selection } }
        return {
            settings: { ...settings, promptProfiles: { ...settings.promptProfiles, [namespace]: next } },
            result: toState(next, sessionId),
        }
    })
}

export async function getPromptProfilePrefix(dataDir: string, namespace: string, sessionId: string): Promise<string> {
    const settings = await readSettingsOrThrowCached(getSettingsFile(dataDir))
    const profiles = profilesForNamespace(settings.promptProfiles, namespace)
    const selection = selectionForSession(profiles, sessionId)
    const persona = profiles.personas.find(value => value.id === selection.personaId)
    const sections = [
        ...(selection.agent ? [`${selection.agent.instruction}`] : []),
        ...(persona ? [`Persona: ${persona.name}\n${persona.description}`] : []),
    ]
    return sections.length ? `${sections.join('\n\n')}\n\n` : ''
}

export async function copyPromptProfileSelection(dataDir: string, namespace: string, from: string, to: string): Promise<void> {
    if (from === to) return
    await updateSettings(getSettingsFile(dataDir), settings => {
        const profiles = profilesForNamespace(settings.promptProfiles, namespace)
        if (!Object.hasOwn(profiles.sessions, from) || Object.hasOwn(profiles.sessions, to)) return { settings, result: undefined, write: false }
        return {
            settings: { ...settings, promptProfiles: { ...settings.promptProfiles, [namespace]: {
                ...profiles, sessions: { ...profiles.sessions, [to]: profiles.sessions[from]! },
            } } }, result: undefined,
        }
    })
}
