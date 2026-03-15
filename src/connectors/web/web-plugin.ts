import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import type { Plugin, EngineContext } from '../../core/types.js'
import { SessionStore } from '../../core/session.js'
import { WebConnector } from './web-connector.js'
import { readWebSubchannels } from '../../core/config.js'
import { createChatRoutes, createMediaRoutes, type SSEClient } from './routes/chat.js'
import { createChannelsRoutes } from './routes/channels.js'
import { createConfigRoutes, createOpenbbRoutes } from './routes/config.js'
import { createEventsRoutes } from './routes/events.js'
import { createCronRoutes } from './routes/cron.js'
import { createHeartbeatRoutes } from './routes/heartbeat.js'
import { createTradingRoutes } from './routes/trading.js'
import { createTradingConfigRoutes } from './routes/trading-config.js'
import { createDevRoutes } from './routes/dev.js'
import { createToolsRoutes } from './routes/tools.js'
import { createMarketDataRoutes } from './routes/market-data.js'
import { createStrategyRoutes } from './routes/strategy.js'
import { createAuthRoutes } from './routes/auth.js'

export interface WebConfig {
  port: number
}

export type WsBroadcast = (event: { type: string; [key: string]: unknown }) => void

export class WebPlugin implements Plugin {
  name = 'web'
  private server: ReturnType<typeof serve> | null = null
  private wss: WebSocketServer | null = null
  /** SSE clients grouped by channel ID. Default channel: 'default'. */
  private sseByChannel = new Map<string, Map<string, SSEClient>>()
  private unregisterConnector?: () => void

  constructor(private config: WebConfig) {}

  async start(ctx: EngineContext) {
    // Load sub-channel definitions
    const subChannels = await readWebSubchannels()

    // Initialize sessions for the default channel and all sub-channels
    const sessions = new Map<string, SessionStore>()

    const defaultSession = new SessionStore('web/default')
    await defaultSession.restore()
    sessions.set('default', defaultSession)

    for (const ch of subChannels) {
      const session = new SessionStore(`web/${ch.id}`)
      await session.restore()
      sessions.set(ch.id, session)
    }

    // Initialize SSE map for known channels (entries are created lazily too)
    this.sseByChannel.set('default', new Map())
    for (const ch of subChannels) {
      this.sseByChannel.set(ch.id, new Map())
    }

    const app = new Hono()

    app.onError((err: Error, c: Context) => {
      if (err instanceof SyntaxError) {
        return c.json({ error: 'Invalid JSON' }, 400)
      }
      console.error('web: unhandled error:', err)
      return c.json({ error: err.message }, 500)
    })

    app.use('/api/*', cors())

    // ==================== WebSocket broadcast ====================
    const wsClients = new Set<WebSocket>()
    const wsBroadcast: WsBroadcast = (event) => {
      const data = JSON.stringify(event)
      for (const ws of wsClients) {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(data) } catch { /* ignore */ }
        }
      }
    }

    // ==================== Mount route modules ====================
    app.route('/api/chat', createChatRoutes({ ctx, sessions, sseByChannel: this.sseByChannel, wsBroadcast }))
    app.route('/api/channels', createChannelsRoutes({ sessions, sseByChannel: this.sseByChannel }))
    app.route('/api/media', createMediaRoutes())
    app.route('/api/config', createConfigRoutes({
      onConnectorsChange: async () => { await ctx.reconnectConnectors() },
    }))
    app.route('/api/openbb', createOpenbbRoutes())
    app.route('/api/events', createEventsRoutes(ctx))
    app.route('/api/cron', createCronRoutes(ctx))
    app.route('/api/heartbeat', createHeartbeatRoutes(ctx))
    app.route('/api/trading/config', createTradingConfigRoutes(ctx))
    app.route('/api/trading', createTradingRoutes(ctx))
    app.route('/api/dev', createDevRoutes(ctx.connectorCenter))
    app.route('/api/tools', createToolsRoutes(ctx.toolCenter))
    app.route('/api/auth', createAuthRoutes())

    if (ctx.marketDataEngine) {
      app.route('/api/market-data', createMarketDataRoutes(ctx.marketDataEngine))
    }

    if (ctx.strategyStore) {
      app.route('/api/strategy', createStrategyRoutes(ctx.strategyStore, ctx.backtestEngine))
    }

    // ==================== Serve UI (Vite build output) ====================
    const uiRoot = resolve('dist/ui')
    app.use('/*', serveStatic({ root: uiRoot }))
    app.get('*', serveStatic({ root: uiRoot, path: 'index.html' }))

    // ==================== Connector registration ====================
    // The web connector only targets the main 'default' channel (heartbeat/cron notifications).
    this.unregisterConnector = ctx.connectorCenter.register(
      new WebConnector(this.sseByChannel, defaultSession),
    )

    // ==================== Start server ====================
    this.server = serve({ fetch: app.fetch, port: this.config.port }, (info: { port: number }) => {
      console.log(`web plugin listening on http://localhost:${info.port}`)
    })

    // ==================== WebSocket server for real-time AI status broadcasting ====================
    this.wss = new WebSocketServer({ noServer: true })

    this.wss.on('connection', (ws) => {
      wsClients.add(ws)
      ws.on('close', () => wsClients.delete(ws))
      ws.on('error', () => wsClients.delete(ws))
    })

    this.server.on('upgrade', (request, socket, head) => {
      if (request.url === '/api/ws') {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request)
        })
      } else {
        socket.destroy()
      }
    })
  }

  async stop() {
    this.sseByChannel.clear()
    this.unregisterConnector?.()
    this.wss?.close()
    this.server?.close()
  }
}
