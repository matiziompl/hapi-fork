import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { registerAgyModelHandlers } from './handlers/agyModels'
import { registerBashHandlers } from './handlers/bash'
import { registerClaudeModelHandlers } from './handlers/claudeModels'
import { registerCodexModelHandlers } from './handlers/codexModels'
import { registerCursorModelHandlers } from './handlers/cursorModels'
import { registerOpencodeModelHandlers } from './handlers/opencodeModels'
import { registerOpencodeModelVariantsHandlers } from './handlers/opencodeModelVariants'
import { registerPiModelHandlers } from './handlers/piModels'
import { registerGrokModelHandlers } from './handlers/grokModels'
import { registerCopilotModelHandlers } from './handlers/copilotModels'
import { registerKimiModelHandlers } from './handlers/kimiModels'
import { registerDirectoryHandlers } from './handlers/directories'
import { registerDifftasticHandlers } from './handlers/difftastic'
import { registerFileHandlers } from './handlers/files'
import { registerGitHandlers } from './handlers/git'
import { registerRipgrepHandlers } from './handlers/ripgrep'
import { registerSlashCommandHandlers } from './handlers/slashCommands'
import { registerSkillsHandlers } from './handlers/skills'
import { registerUploadHandlers } from './handlers/uploads'

export function registerCommonHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    registerAgyModelHandlers(rpcHandlerManager)
    registerClaudeModelHandlers(rpcHandlerManager)
    registerCodexModelHandlers(rpcHandlerManager)
    registerCursorModelHandlers(rpcHandlerManager)
    registerOpencodeModelHandlers(rpcHandlerManager)
    registerOpencodeModelVariantsHandlers(rpcHandlerManager)
    registerPiModelHandlers(rpcHandlerManager)
    registerGrokModelHandlers(rpcHandlerManager)
    registerCopilotModelHandlers(rpcHandlerManager)
    registerKimiModelHandlers(rpcHandlerManager)
    registerWorkingDirectoryHandlers(rpcHandlerManager, workingDirectory)
    registerSkillsHandlers(rpcHandlerManager, workingDirectory)
    registerUploadHandlers(rpcHandlerManager)
}

/** Rebind file operations after a native Codex /cd without replacing its catalogs or controls. */
export function registerWorkingDirectoryHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    registerBashHandlers(rpcHandlerManager, workingDirectory)
    registerFileHandlers(rpcHandlerManager, workingDirectory)
    registerDirectoryHandlers(rpcHandlerManager, workingDirectory)
    registerRipgrepHandlers(rpcHandlerManager, workingDirectory)
    registerDifftasticHandlers(rpcHandlerManager, workingDirectory)
    registerSlashCommandHandlers(rpcHandlerManager, workingDirectory)
    registerGitHandlers(rpcHandlerManager, workingDirectory)
}
