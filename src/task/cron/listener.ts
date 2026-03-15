/**
 * Cron Listener — subscribes to `cron.fire` events from the EventLog
 * and routes them through the AgentCenter for processing.
 *
 * Flow:
 *   eventLog 'cron.fire' → agentCenter.askWithSession(payload, session)
 *                         → connectorCenter.notify(reply)
 *                         → eventLog 'cron.done' / 'cron.error'
 *
 * The listener owns a dedicated SessionStore for cron conversations,
 * independent of user chat sessions (Telegram, Web, etc.).
 */

import type { EventLog, EventLogEntry } from '../../core/event-log.js'
import type { AgentCenter } from '../../core/agent-center.js'
import { SessionStore } from '../../core/session.js'
import type { ConnectorCenter } from '../../core/connector-center.js'
import type { CronFirePayload } from './engine.js'
import { HEARTBEAT_JOB_NAME } from '../heartbeat/heartbeat.js'

// ==================== Types ====================

export interface CronListenerOpts {
  connectorCenter: ConnectorCenter
  eventLog: EventLog
  agentCenter: AgentCenter
  /** Optional: inject a session for testing. Otherwise creates a dedicated cron session. */
  session?: SessionStore
}

export interface CronListener {
  start(): void
  stop(): void
  /** Abort any currently running AI generation. */
  abortCurrent(): boolean
  /** Is a cron job AI generation currently running? */
  isProcessing(): boolean
}

// ==================== Factory ====================

export function createCronListener(opts: CronListenerOpts): CronListener {
  const { connectorCenter, eventLog, agentCenter } = opts
  const session = opts.session ?? new SessionStore('cron/default')

  let unsubscribe: (() => void) | null = null
  let processing = false
  let currentAbort: AbortController | null = null

  async function handleFire(entry: EventLogEntry): Promise<void> {
    const payload = entry.payload as CronFirePayload

    // Guard: heartbeat events are handled by the heartbeat listener
    if (payload.jobName === HEARTBEAT_JOB_NAME) return

    // Guard: skip if already processing (serial execution)
    if (processing) {
      console.warn(`cron-listener: skipping job ${payload.jobId} (already processing)`)
      return
    }

    processing = true
    currentAbort = new AbortController()
    const startMs = Date.now()

    try {
      // Ask the AI engine with the cron payload
      const result = await agentCenter.askWithSession(payload.payload, session, {
        historyPreamble: 'The following is the recent cron session conversation. This is an automated cron job execution.',
      })

      // Check if aborted
      if (currentAbort.signal.aborted) {
        console.log(`cron-listener: job ${payload.jobId} was aborted`)
        return
      }

      // Send notification through the last-interacted connector
      try {
        await connectorCenter.notify(result.text, {
          media: result.media,
          source: 'cron',
        })
      } catch (sendErr) {
        console.warn(`cron-listener: send failed for job ${payload.jobId}:`, sendErr)
      }

      // Log success
      await eventLog.append('cron.done', {
        jobId: payload.jobId,
        jobName: payload.jobName,
        reply: result.text,
        durationMs: Date.now() - startMs,
      })
    } catch (err) {
      console.error(`cron-listener: error processing job ${payload.jobId}:`, err)

      // Log error
      await eventLog.append('cron.error', {
        jobId: payload.jobId,
        jobName: payload.jobName,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      })
    } finally {
      processing = false
      currentAbort = null
    }
  }

  return {
    start() {
      if (unsubscribe) return // already started
      unsubscribe = eventLog.subscribeType('cron.fire', (entry) => {
        handleFire(entry).catch((err) => {
          console.error('cron-listener: unhandled error in handleFire:', err)
        })
      })
    },

    stop() {
      currentAbort?.abort()
      unsubscribe?.()
      unsubscribe = null
    },

    abortCurrent() {
      if (!processing || !currentAbort) return false
      currentAbort.abort()
      console.log('cron-listener: aborted current job')
      return true
    },

    isProcessing() {
      return processing
    },
  }
}
