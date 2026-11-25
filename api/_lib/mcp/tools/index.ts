/** Outils du serveur MCP, dans l'ordre de tools/list. */
import { z } from 'zod'
import type { MemberRole } from '../../../../src/shared/types.js'
import { financeSummaryTool, getProjectTool, listMyTasksTool, listProjectsTool, listProspectsTool, searchTool } from './read.js'
import { createTaskTool, updateTaskTool } from './tasks.js'
import type { McpTool } from './types.js'

export const MCP_TOOLS: readonly McpTool[] = [
  searchTool,
  listProjectsTool,
  getProjectTool,
  listMyTasksTool,
  createTaskTool,
  updateTaskTool,
  financeSummaryTool,
  listProspectsTool,
] as readonly McpTool[]

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name)
}

export function toolsForRole(role: MemberRole): McpTool[] {
  return MCP_TOOLS.filter((tool) => tool.roles.includes(role))
}

/** JSON Schema d'entrée publié par tools/list (dérivé du schéma zod, sans « $schema »). */
export function inputSchemaOf(tool: McpTool): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  return schema
}

/** Description MCP d'un outil (élément de tools/list). */
export function describeTool(tool: McpTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputSchemaOf(tool),
    annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly, openWorldHint: false },
  }
}
