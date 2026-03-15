/**
 * ToolCenter — unified tool registry with core/extended split.
 *
 * Core tools are always sent to the AI model.
 * Extended tools are registered but only loaded on demand via the `loadToolGroup` meta-tool.
 * This reduces per-request token usage (~15K savings for 30+ deferred tools).
 */

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'
import { readToolsConfig } from './config.js'

interface ToolEntry {
  tool: Tool
  group: string
}

/** Groups that are always included in every AI request. Keep this minimal. */
const CORE_GROUPS = new Set(['thinking', 'brain', 'strategy', 'cron'])

export class ToolCenter {
  private tools: Record<string, ToolEntry> = {}
  /** Groups that have been dynamically loaded for the current session */
  private loadedGroups = new Set<string>()

  /** Batch-register tool definitions under a group. Later registrations overwrite same-name tools. */
  register(tools: Record<string, Tool>, group: string): void {
    for (const [name, t] of Object.entries(tools)) {
      this.tools[name] = { tool: t, group }
    }
  }

  /** Mark a group as loaded (for dynamic tool loading). */
  loadGroup(group: string): string[] {
    this.loadedGroups.add(group)
    const names: string[] = []
    for (const [name, entry] of Object.entries(this.tools)) {
      if (entry.group === group) names.push(name)
    }
    return names
  }

  /** Reset loaded groups (e.g., on new session). */
  resetLoadedGroups(): void {
    this.loadedGroups.clear()
  }

  /** Get the catalog of all extended (non-core) tool groups for the system prompt. */
  getExtendedCatalog(): Array<{ group: string; tools: Array<{ name: string; description: string }> }> {
    const groups: Record<string, Array<{ name: string; description: string }>> = {}
    for (const [name, entry] of Object.entries(this.tools)) {
      if (CORE_GROUPS.has(entry.group)) continue
      if (!groups[entry.group]) groups[entry.group] = []
      groups[entry.group].push({
        name,
        description: (entry.tool.description ?? '').slice(0, 80),
      })
    }
    return Object.entries(groups).map(([group, tools]) => ({ group, tools }))
  }

  /** Create the meta-tool that lets AI dynamically load tool groups. */
  createLoadToolGroupTool(): Record<string, Tool> {
    const self = this
    return {
      loadToolGroup: tool({
        description: 'Load an extended tool group to make its tools available. Call this before using tools from non-core groups. Use getToolCatalog to see available groups first.',
        inputSchema: z.object({
          group: z.string().describe('Tool group name to load (e.g. "market-data", "trading", "analysis")'),
        }),
        execute: async (input) => {
          const loaded = self.loadGroup(input.group)
          if (loaded.length === 0) return { error: `Group "${input.group}" not found or has no tools.` }
          return { success: true, group: input.group, loadedTools: loaded }
        },
      }),
    }
  }

  /** Vercel AI SDK format — returns core + dynamically loaded tools (reads disabled list from disk). */
  async getVercelTools(): Promise<Record<string, Tool>> {
    const { disabled } = await readToolsConfig()
    const disabledSet = disabled.length > 0 ? new Set(disabled) : null
    const result: Record<string, Tool> = {}

    for (const [name, entry] of Object.entries(this.tools)) {
      if (disabledSet?.has(name)) continue
      // Include if core group OR dynamically loaded
      if (CORE_GROUPS.has(entry.group) || this.loadedGroups.has(entry.group)) {
        result[name] = entry.tool
      }
    }

    // Always include the meta-tool
    const metaTools = this.createLoadToolGroupTool()
    for (const [name, t] of Object.entries(metaTools)) {
      result[name] = t
    }

    return result
  }

  /** MCP format — returns ALL tools (MCP clients manage their own context). */
  async getMcpTools(): Promise<Record<string, Tool>> {
    const { disabled } = await readToolsConfig()
    const disabledSet = disabled.length > 0 ? new Set(disabled) : null
    const result: Record<string, Tool> = {}
    for (const [name, entry] of Object.entries(this.tools)) {
      if (!disabledSet?.has(name)) result[name] = entry.tool
    }
    return result
  }

  /** Full tool inventory with group metadata (for frontend / API). */
  getInventory(): Array<{ name: string; group: string; description: string }> {
    return Object.entries(this.tools).map(([name, entry]) => ({
      name,
      group: entry.group,
      description: (entry.tool.description ?? '').slice(0, 200),
    }))
  }

  /** Tool name list (for logging / debugging). */
  list(): string[] {
    return Object.keys(this.tools)
  }
}
