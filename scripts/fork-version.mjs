import { readFileSync, writeFileSync } from 'node:fs'

const command = process.argv[2]
if (!['--sync', '--check', '--bump'].includes(command)) {
    console.error('Usage: bun scripts/fork-version.mjs --sync|--check|--bump')
    process.exit(1)
}
try {
    const sourcePath = 'shared/src/buildInfo.ts'
    const source = readFileSync(sourcePath, 'utf8')
    const match = source.match(/export const FORK_VERSION = '((?:0|[1-9]\d*)\.(?:0|[1-9]\d*))'/)
    if (!match) throw new Error('Missing or malformed FORK_VERSION in shared/src/buildInfo.ts')
    const [major, minor] = match[1].split('.')
    const version = command === '--bump' ? `${major}.${BigInt(minor) + 1n}` : match[1]
    const readme = readFileSync('README.md', 'utf8')
    const start = '<!-- hapi-fork-version:start -->'
    const end = '<!-- hapi-fork-version:end -->'
    const footer = `${start}\nCurrent fork version: **v${version}**\n${end}\n`
    const hasMarker = readme.includes(start) || readme.includes(end)
    const existing = /<!-- hapi-fork-version:start -->[\s\S]*?<!-- hapi-fork-version:end -->/
    if (hasMarker && (!existing.test(readme) || readme.split(start).length !== 2 || readme.split(end).length !== 2)) {
        throw new Error('Malformed or duplicate README version footer; repair it before updating the version')
    }
    const body = readme.replace(existing, '').trimEnd()
    const updated = `${body}\n\n${footer}`
    if (command === '--check') {
        if (readme !== updated) throw new Error('README version is stale; run bun run version:sync')
    } else {
        if (command === '--bump') writeFileSync(sourcePath, source.replace(match[0], `export const FORK_VERSION = '${version}'`))
        if (readme !== updated) writeFileSync('README.md', updated)
    }
    console.log(`Fork v${version}: ${command.slice(2)} complete`)
} catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
}
