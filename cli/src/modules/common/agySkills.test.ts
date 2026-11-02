import { describe, expect, it } from 'vitest'
import { parseAgySkills } from './agySkills'

describe('AGY native skill catalog', () => {
    it('uses the native names and paths including plugin and manifest skills', () => {
        const skills = [{ name: 'plugin:build', description: 'Build', path: '/external/plugin/SKILL.md' },
            { name: 'my-skill', path: '/manifest/skill/SKILL.md', builtin: true }]
        expect(parseAgySkills(JSON.stringify({ status: 'SUCCESS', command: { name: 'skills', data: { skills } } }))).toEqual(skills)
    })
    it('distinguishes an empty catalog from a failed or malformed CLI response', () => {
        expect(parseAgySkills(JSON.stringify({ status: 'SUCCESS', command: { name: 'skills', data: { skills: [] } } }))).toEqual([])
        expect(() => parseAgySkills('{"status":"ERROR","error":"Sign in"}')).toThrow('Sign in')
        expect(() => parseAgySkills('{}')).toThrow()
        expect(() => parseAgySkills('{"status":"SUCCESS","command":{"name":"skills","data":{"skills":[{"name":"oops"}]}}}')).toThrow()
    })
})
