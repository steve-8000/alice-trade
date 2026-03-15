/**
 * Cron Tools — AI-facing tool definitions for the cron engine.
 *
 * Exposes a single `cron` tool with action parameter for list/add/update/remove/runNow.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { CronEngine } from './engine.js'

// ==================== Schema ====================

const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('at'),
    at: z.string().describe('ISO timestamp for one-shot execution, e.g. "2025-06-01T14:00:00Z"'),
  }),
  z.object({
    kind: z.literal('every'),
    every: z.string().describe('Repeating interval, e.g. "2h", "30m", "5m30s"'),
  }),
  z.object({
    kind: z.literal('cron'),
    cron: z.string().describe('5-field cron expression, e.g. "0 9 * * 1-5" (weekdays 9am)'),
  }),
])

// ==================== Factory ====================

export function createCronTools(cronEngine: CronEngine) {
  return {
    cron: tool({
      description:
        'Manage cron jobs: list, add, update, remove, or run now.\n\n' +
        '- list: Show all scheduled jobs with their status and next run time\n' +
        '- add: Create a new scheduled job (requires name, payload, schedule)\n' +
        '- update: Modify an existing job (requires id, plus fields to change)\n' +
        '- remove: Delete a job permanently (requires id)\n' +
        '- runNow: Manually trigger a job immediately (requires id)',
      inputSchema: z.object({
        action: z.enum(['list', 'add', 'update', 'remove', 'runNow']).describe('Operation to perform'),
        id: z.string().optional().describe('Job id (required for update, remove, runNow)'),
        name: z.string().optional().describe('Short descriptive name (required for add)'),
        payload: z.string().optional().describe('Reminder/instruction text delivered when the job fires (required for add)'),
        schedule: scheduleSchema.optional().describe('When the job should run (required for add)'),
        enabled: z.boolean().optional().describe('Whether the job is enabled (for add/update)'),
        sessionTarget: z
          .enum(['main', 'isolated'])
          .optional()
          .describe('Where to run: "main" injects into heartbeat session, "isolated" runs in a fresh session'),
      }),
      execute: async (input) => {
        switch (input.action) {
          case 'list': {
            return cronEngine.list()
          }

          case 'add': {
            if (!input.schedule) {
              return { error: 'schedule is required' }
            }
            if (!input.name || !input.payload) {
              return { error: 'name and payload are required for add' }
            }
            const id = await cronEngine.add({
              name: input.name,
              payload: input.payload,
              schedule: input.schedule,
              enabled: input.enabled,
            })
            return { id }
          }

          case 'update': {
            if (!input.id) return { error: 'id is required for update' }
            try {
              await cronEngine.update(input.id, {
                name: input.name,
                payload: input.payload,
                schedule: input.schedule,
                enabled: input.enabled,
              })
              return { ok: true }
            } catch (err) {
              return { error: err instanceof Error ? err.message : String(err) }
            }
          }

          case 'remove': {
            if (!input.id) return { error: 'id is required for remove' }
            try {
              await cronEngine.remove(input.id)
              return { ok: true }
            } catch (err) {
              return { error: err instanceof Error ? err.message : String(err) }
            }
          }

          case 'runNow': {
            if (!input.id) return { error: 'id is required for runNow' }
            try {
              await cronEngine.runNow(input.id)
              return { ok: true }
            } catch (err) {
              return { error: err instanceof Error ? err.message : String(err) }
            }
          }
        }
      },
    }),
  }
}
