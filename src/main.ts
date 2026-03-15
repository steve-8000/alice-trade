import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
// Engine removed — AgentCenter is the top-level AI entry point
import { loadConfig, loadTradingConfig } from './core/config.js'
import type { Plugin, EngineContext, ReconnectResult } from './core/types.js'
import { McpPlugin } from './server/mcp.js'
import { TelegramPlugin } from './connectors/telegram/index.js'
import { WebPlugin } from './connectors/web/index.js'
import { McpAskPlugin } from './connectors/mcp-ask/index.js'
import { createThinkingTools } from './extension/thinking-kit/index.js'
import {
  AccountManager,
  CcxtAccount,
  createCcxtProviderTools,
  wireAccountTrading,
  createTradingTools,
  createPlatformFromConfig,
  createAccountFromConfig,
  validatePlatformRefs,
} from './extension/trading/index.js'
import type { AccountSetup, GitExportState, ITradingGit, IPlatform } from './extension/trading/index.js'
import { Brain, createBrainTools } from './extension/brain/index.js'
import type { BrainExportState } from './extension/brain/index.js'
import { getSDKExecutor, buildRouteMap, SDKCryptoClient } from './openbb/sdk/index.js'
import type { CryptoClientLike } from './openbb/sdk/types.js'
import { buildSDKCredentials } from './openbb/credential-map.js'
import { OpenBBCryptoClient } from './openbb/crypto/client.js'
import { OpenBBServerPlugin } from './server/opentypebb.js'
import { createAnalysisTools } from './extension/analysis-kit/index.js'
import { SessionStore } from './core/session.js'
import { ConnectorCenter } from './core/connector-center.js'
import { ToolCenter } from './core/tool-center.js'
import { AgentCenter } from './core/agent-center.js'
import { GenerateRouter } from './core/ai-provider-manager.js'
import { VercelAIProvider } from './ai-providers/vercel-ai-sdk/vercel-provider.js'
import { ClaudeCodeProvider } from './ai-providers/claude-code/claude-code-provider.js'
import { AgentSdkProvider } from './ai-providers/agent-sdk/agent-sdk-provider.js'
import { createEventLog } from './core/event-log.js'
import { createCronEngine, createCronListener, createCronTools } from './task/cron/index.js'
import { createHeartbeat } from './task/heartbeat/index.js'
import { MarketDataStore, MarketDataEngine, createMarketDataTools } from './extension/market-data/index.js'
import { StrategyStore, createStrategyTools, BacktestEngine } from './extension/strategy/index.js'

// ==================== Persistence paths ====================

const BRAIN_FILE = resolve('data/brain/commit.json')

/** Per-account git state path. Falls back to legacy paths for backward compat.
 *  TODO: remove LEGACY_GIT_PATHS before v1.0 */
function gitFilePath(accountId: string): string {
  return resolve(`data/trading/${accountId}/commit.json`)
}
const LEGACY_GIT_PATHS: Record<string, string> = {
  'bybit-main': resolve('data/crypto-trading/commit.json'),
}
const FRONTAL_LOBE_FILE = resolve('data/brain/frontal-lobe.md')
const EMOTION_LOG_FILE = resolve('data/brain/emotion-log.md')
const PERSONA_FILE = resolve('data/brain/persona.md')
const PERSONA_DEFAULT = resolve('data/default/persona.default.md')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Read a file, copying from default if it doesn't exist yet. */
async function readWithDefault(target: string, defaultFile: string): Promise<string> {
  try { return await readFile(target, 'utf-8') } catch { /* not found — copy default */ }
  try {
    const content = await readFile(defaultFile, 'utf-8')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    return content
  } catch { return '' }
}

/** Create a git commit persistence callback for a given file path. */
function createGitPersister(filePath: string) {
  return async (state: GitExportState) => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(state, null, 2))
  }
}

/** Read saved git state from disk, trying primary path then legacy fallback. */
async function loadGitState(accountId: string): Promise<GitExportState | undefined> {
  const primary = gitFilePath(accountId)
  try {
    return JSON.parse(await readFile(primary, 'utf-8')) as GitExportState
  } catch { /* try legacy */ }
  const legacy = LEGACY_GIT_PATHS[accountId]
  if (legacy) {
    try {
      return JSON.parse(await readFile(legacy, 'utf-8')) as GitExportState
    } catch { /* no saved state */ }
  }
  return undefined
}

async function main() {
  const config = await loadConfig()

  // ==================== Trading Account Manager ====================

  const accountManager = new AccountManager()
  // Mutable map: accountId → setup. Needed for reconnect (re-wiring) and git lookups.
  const accountSetups = new Map<string, AccountSetup>()

  // ==================== Platform-driven Account Init ====================

  const tradingConfig = await loadTradingConfig()
  const platformRegistry = new Map<string, IPlatform>()
  for (const pc of tradingConfig.platforms) {
    platformRegistry.set(pc.id, createPlatformFromConfig(pc))
  }
  validatePlatformRefs([...platformRegistry.values()], tradingConfig.accounts)

  /** Initialize and register a single account. Returns true if successful. */
  async function initAccount(
    accountCfg: { id: string; platformId: string; guards: Array<{ type: string; options: Record<string, unknown> }> },
    platform: IPlatform,
  ): Promise<boolean> {
    const account = createAccountFromConfig(platform, accountCfg)
    try {
      await account.init()
    } catch (err) {
      console.warn(`trading: ${accountCfg.id} init failed (non-fatal):`, err)
      return false
    }
    const savedState = await loadGitState(accountCfg.id)
    const filePath = gitFilePath(accountCfg.id)
    const setup = wireAccountTrading(account, {
      guards: accountCfg.guards,
      savedState,
      onCommit: createGitPersister(filePath),
    })
    accountManager.addAccount(account, accountCfg.platformId)
    accountSetups.set(account.id, setup)
    console.log(`trading: ${account.label} initialized`)
    return true
  }

  // CCXT accounts — async background init (loadMarkets is slow)
  const ccxtAccountConfigs: Array<{ cfg: typeof tradingConfig.accounts[number]; platform: IPlatform }> = []

  for (const accCfg of tradingConfig.accounts) {
    const platform = platformRegistry.get(accCfg.platformId)!
    ccxtAccountConfigs.push({ cfg: accCfg, platform })
  }

  // CCXT init in background — register tools when ready
  const ccxtInitPromise = ccxtAccountConfigs.length > 0
    ? (async () => {
        for (const { cfg, platform } of ccxtAccountConfigs) {
          await initAccount(cfg, platform)
        }
      })()
    : Promise.resolve()

  // ==================== Brain ====================

  const [brainExport, persona] = await Promise.all([
    readFile(BRAIN_FILE, 'utf-8').then((r) => JSON.parse(r) as BrainExportState).catch(() => undefined),
    readWithDefault(PERSONA_FILE, PERSONA_DEFAULT),
  ])

  const brainDir = resolve('data/brain')
  const brainOnCommit = async (state: BrainExportState) => {
    await mkdir(brainDir, { recursive: true })
    await writeFile(BRAIN_FILE, JSON.stringify(state, null, 2))
    await writeFile(FRONTAL_LOBE_FILE, state.state.frontalLobe)
    const latest = state.commits[state.commits.length - 1]
    if (latest?.type === 'emotion') {
      const prev = state.commits.length > 1
        ? state.commits[state.commits.length - 2]?.stateAfter.emotion ?? 'unknown'
        : 'unknown'
      await appendFile(EMOTION_LOG_FILE,
        `## ${latest.timestamp}\n**${prev} → ${latest.stateAfter.emotion}**\n${latest.message}\n\n`)
    }
  }

  const brain = brainExport
    ? Brain.restore(brainExport, { onCommit: brainOnCommit })
    : new Brain({ onCommit: brainOnCommit })

  const frontalLobe = brain.getFrontalLobe()
  const emotion = brain.getEmotion().current
  const instructionParts = [
    '/no_think',
    persona,
    '---',
    '## Current Brain State',
    '',
    `**Frontal Lobe:** ${frontalLobe || '(empty)'}`,
    '',
    `**Emotion:** ${emotion}`,
  ]

  // ==================== Strategy Store ====================

  const strategyStore = new StrategyStore()

  const activeRiskStrategies = strategyStore.getEnabledStrategies('risk')
  if (activeRiskStrategies.length > 0) {
    instructionParts.push('\n---\n## Active Risk Management Rules (MUST be applied to ALL trades)')
    for (const rs of activeRiskStrategies) {
      instructionParts.push(`\n### ${rs.name}\n${rs.description}\nParameters: ${JSON.stringify(rs.config)}`)
    }
  }

  const activeStrategies = strategyStore.getEnabledStrategies('trading')
  if (activeStrategies.length > 0) {
    instructionParts.push('\n---\n## Active Trading Strategies')
    for (const s of activeStrategies) {
      instructionParts.push(`\n### ${s.name}\n${s.description}\nParameters: ${JSON.stringify(s.config)}`)
    }
  }

  instructionParts.push(`
---
## Core Rules
- Respond in the same language the user uses (Korean/English).
- Strategy descriptions MUST be in Korean.
- Context limit: 130K tokens. Keep responses concise.
- Do NOT fetch large candle data yourself — use backtest engine.
- Available exchange data: **binance** only (BTC/USDT, ETH/USDT). Always use exchange="binance".
- When user asks to add/create strategy → MUST call strategy({action:"add"}) to persist it.

## Tools
- \`strategy\`: add/list/update/delete/refine/getActive. Config = numeric params only.
- \`backtest\`: run/list/detail. Runs server-side engine with active strategies.
- \`marketData\`: candles/price/summary/status from SQLite DB.
- \`loadToolGroup\`: load extended tools (trading, market-data, analysis).
- \`brainRead\`/\`brainUpdate\`: read/update cognitive state.
- \`think\`: record analysis and plans before acting.

## CRITICAL: Backtest Engine Config Keys
The engine auto-detects indicators from config keys. Include ANY of these to activate:
**WaveTrend:** wtChannelLen(9), wtAverageLen(12), wtMALen(3), obLevel(53), osLevel(-53)
**RSI filter:** rsiPeriod(14), rsiOverbought(70), rsiOversold(30)
**StochRSI:** stochLen(14), stochRsiLen(14), kSmooth(3), dSmooth(3), stochOverbought(80), stochOversold(20)
**EMA Cross:** fastEma(9), slowEma(21)
**MACD:** macdFastPeriod(12), macdSlowPeriod(26), macdSignalPeriod(9)
**Bollinger:** bbPeriod(20), bbStdDev(2)
**MFI filter:** useMfiFilter(true), mfiPeriod(60)
**General:** cooldownBars(0), allowLong(true), allowShort(true), minSignalStrength(auto)
**Risk:** stopPct, takePct, dailyLossLimitPct, maxConsecutiveLosses, maxOpenPositions, riskPerTradePct
Multiple indicators = AND filter (majority voting). Tune by changing these numeric values.
**TUNING RULES**: To get DIFFERENT backtest results you MUST change numeric values. Examples:
- Tighten entry: increase obLevel(53→60), decrease osLevel(-53→-60), add cooldownBars(0→8)
- Add RSI filter: set rsiPeriod(14), rsiOverbought(65), rsiOversold(35)
- Add EMA trend: set fastEma(9), slowEma(21) — only enters when fast>slow
- Add Stoch filter: set stochLen(14), stochOverbought(75), stochOversold(25)
- Use customFilters for ADX trend strength: [{"indicator":"adx","period":14,"operator":"above","value":25,"role":"longFilter"}]
- Each test MUST change at least 2-3 numeric params from the previous test. Do NOT just change text descriptions.

Available customFilter indicators: close, high, low, volume, sma, ema, rsi, atr, vwap, williamsR, cci, adx, roc, momentum, obv, mfi, psar, ichimoku_tenkan, ichimoku_kijun, donchian_upper, donchian_lower, keltner_upper, keltner_lower, stddev, cmf, highest, lowest, dema, tema, wma, hma, trix, chop, aroon_up, aroon_down, ultimate_osc, ppo, dpo, mass_index, stoch_k, stoch_d, macd_line, macd_signal, macd_histogram, bb_upper, bb_lower, bb_middle, wt1, wt2, sma_volume
Operators: above, below, crossAbove, crossBelow
Roles: longEntry, shortEntry, longFilter, shortFilter, longExit, shortExit
`)

  // ==================== Event Log ====================

  const eventLog = await createEventLog()

  // ==================== Cron ====================

  const cronEngine = createCronEngine({ eventLog })

  // ==================== OpenBB Clients ====================

  const { providers } = config.openbb

  let cryptoClient: CryptoClientLike

  if (config.openbb.dataBackend === 'openbb') {
    const url = config.openbb.apiUrl
    const keys = config.openbb.providerKeys
    cryptoClient = new OpenBBCryptoClient(url, providers.crypto, keys)
  } else {
    const executor = getSDKExecutor()
    const routeMap = buildRouteMap()
    const credentials = buildSDKCredentials(config.openbb.providerKeys)
    cryptoClient = new SDKCryptoClient(executor, 'crypto', providers.crypto, credentials, routeMap)
  }

  // OpenBB API server is started later via optionalPlugins

  // ==================== Tool Center ====================

  const toolCenter = new ToolCenter()
  toolCenter.register(createThinkingTools(), 'thinking')

  // One unified set of trading tools — routes via `source` parameter at runtime
  toolCenter.register(
    createTradingTools({
      accountManager,
      getGit: (id) => accountSetups.get(id)?.git,
      getGitState: (id) => accountSetups.get(id)?.getGitState(),
    }),
    'trading',
  )

  toolCenter.register(createBrainTools(brain), 'brain')
  toolCenter.register(createCronTools(cronEngine), 'cron')
  toolCenter.register(createAnalysisTools(cryptoClient), 'analysis')

  // ==================== Market Data Engine ====================

  const marketDataStore = new MarketDataStore()
  const marketDataEngine = new MarketDataEngine(marketDataStore)
  toolCenter.register(createMarketDataTools(marketDataStore), 'market-data')
  const backtestEngine = new BacktestEngine(marketDataStore, strategyStore)
  toolCenter.register(createStrategyTools(strategyStore, backtestEngine), 'strategy')

  // Start all enabled connections in background
  marketDataEngine.startAll()

  // Build extended tool catalog for system prompt
  const catalog = toolCenter.getExtendedCatalog()
  if (catalog.length > 0) {
    instructionParts.push('\n---\n## Available Tool Groups (use `loadToolGroup` to activate)\n')
    for (const { group, tools } of catalog) {
      instructionParts.push(`**${group}**: ${tools.map(t => t.name).join(', ')}`)
    }
    instructionParts.push('\nCall `loadToolGroup({group: "group-name"})` before using tools from these groups.')
  }
  // Rebuild instructions with catalog
  const fullInstructions = instructionParts.join('\n')

  console.log(`tool-center: ${toolCenter.list().length} tools registered (core: ${['thinking', 'brain', 'strategy', 'cron'].join(', ')})`)

  // ==================== AI Provider Chain ====================

  const vercelProvider = new VercelAIProvider(
    () => toolCenter.getVercelTools(),
    fullInstructions,
    config.agent.maxSteps,
    config.agent.maxTokens,
  )
  const claudeCodeProvider = new ClaudeCodeProvider(fullInstructions)
  const agentSdkProvider = new AgentSdkProvider(
    () => toolCenter.getVercelTools(),
    fullInstructions,
  )
  const router = new GenerateRouter(vercelProvider, claudeCodeProvider, agentSdkProvider)

  const agentCenter = new AgentCenter({
    router,
    compaction: config.compaction,
  })

  // ==================== Connector Center ====================

  const connectorCenter = new ConnectorCenter(eventLog)

  // ==================== Cron Lifecycle ====================

  await cronEngine.start()
  const cronSession = new SessionStore('cron/default')
  await cronSession.restore()
  const cronListener = createCronListener({ connectorCenter, eventLog, agentCenter, session: cronSession })
  cronListener.start()
  console.log('cron: engine + listener started')

  // ==================== Heartbeat ====================

  const heartbeat = createHeartbeat({
    config: config.heartbeat,
    connectorCenter, cronEngine, eventLog, agentCenter,
  })
  await heartbeat.start()
  if (config.heartbeat.enabled) {
    console.log(`heartbeat: enabled (every ${config.heartbeat.every})`)
  }

  // ==================== Account Reconnect ====================

  const reconnectingAccounts = new Set<string>()

  const reconnectAccount = async (accountId: string): Promise<ReconnectResult> => {
    if (reconnectingAccounts.has(accountId)) {
      return { success: false, error: 'Reconnect already in progress' }
    }
    reconnectingAccounts.add(accountId)
    try {
      // Re-read trading config to pick up credential/guard changes
      const freshTrading = await loadTradingConfig()

      // Close old account
      const currentAccount = accountManager.getAccount(accountId)
      if (currentAccount) {
        await currentAccount.close()
        accountManager.removeAccount(accountId)
        accountSetups.delete(accountId)
      }

      // Find this account in fresh config
      const accCfg = freshTrading.accounts.find((a) => a.id === accountId)
      if (!accCfg) {
        return { success: true, message: `Account "${accountId}" not found in config (removed or disabled)` }
      }

      // Build platform registry from fresh config
      const freshPlatforms = new Map<string, IPlatform>()
      for (const pc of freshTrading.platforms) {
        freshPlatforms.set(pc.id, createPlatformFromConfig(pc))
      }

      const platform = freshPlatforms.get(accCfg.platformId)
      if (!platform) {
        return { success: false, error: `Platform "${accCfg.platformId}" not found for account "${accountId}"` }
      }

      const ok = await initAccount(accCfg, platform)
      if (!ok) {
        return { success: false, error: `Account "${accountId}" init failed` }
      }

      // Re-register CCXT-specific tools
      toolCenter.register(
        createCcxtProviderTools({
          accountManager,
          getGit: (id) => accountSetups.get(id)?.git,
          getGitState: (id) => accountSetups.get(id)?.getGitState(),
        }),
        'trading-ccxt',
      )

      const label = accountManager.getAccount(accountId)?.label ?? accountId
      console.log(`reconnect: ${label} online`)
      return { success: true, message: `${label} reconnected` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`reconnect: ${accountId} failed:`, msg)
      return { success: false, error: msg }
    } finally {
      reconnectingAccounts.delete(accountId)
    }
  }

  // ==================== Plugins ====================

  // Core plugins — always-on, not toggleable at runtime
  const corePlugins: Plugin[] = []

  // MCP Server is always active when a port is set — Claude Code provider depends on it for tools
  if (config.connectors.mcp.port) {
    corePlugins.push(new McpPlugin(toolCenter, config.connectors.mcp.port))
  }

  // Web UI is always active (no enabled flag)
  if (config.connectors.web.port) {
    corePlugins.push(new WebPlugin({ port: config.connectors.web.port }))
  }

  // Optional plugins — toggleable at runtime via reconnectConnectors()
  const optionalPlugins = new Map<string, Plugin>()

  if (config.connectors.mcpAsk.enabled && config.connectors.mcpAsk.port) {
    optionalPlugins.set('mcp-ask', new McpAskPlugin({ port: config.connectors.mcpAsk.port }))
  }

  if (config.connectors.telegram.enabled && config.connectors.telegram.botToken) {
    optionalPlugins.set('telegram', new TelegramPlugin({
      token: config.connectors.telegram.botToken,
      allowedChatIds: config.connectors.telegram.chatIds,
    }))
  }

  if (config.openbb.apiServer.enabled) {
    optionalPlugins.set('openbb-server', new OpenBBServerPlugin({ port: config.openbb.apiServer.port }))
  }

  // ==================== Connector Reconnect ====================

  let connectorsReconnecting = false
  const reconnectConnectors = async (): Promise<ReconnectResult> => {
    if (connectorsReconnecting) return { success: false, error: 'Reconnect already in progress' }
    connectorsReconnecting = true
    try {
      const fresh = await loadConfig()
      const changes: string[] = []

      // --- MCP Ask ---
      const mcpAskWanted = fresh.connectors.mcpAsk.enabled && !!fresh.connectors.mcpAsk.port
      const mcpAskRunning = optionalPlugins.has('mcp-ask')
      if (mcpAskRunning && !mcpAskWanted) {
        await optionalPlugins.get('mcp-ask')!.stop()
        optionalPlugins.delete('mcp-ask')
        changes.push('mcp-ask stopped')
      } else if (!mcpAskRunning && mcpAskWanted) {
        const p = new McpAskPlugin({ port: fresh.connectors.mcpAsk.port! })
        await p.start(ctx)
        optionalPlugins.set('mcp-ask', p)
        changes.push('mcp-ask started')
      }

      // --- Telegram ---
      const telegramWanted = fresh.connectors.telegram.enabled && !!fresh.connectors.telegram.botToken
      const telegramRunning = optionalPlugins.has('telegram')
      if (telegramRunning && !telegramWanted) {
        await optionalPlugins.get('telegram')!.stop()
        optionalPlugins.delete('telegram')
        changes.push('telegram stopped')
      } else if (!telegramRunning && telegramWanted) {
        const p = new TelegramPlugin({
          token: fresh.connectors.telegram.botToken!,
          allowedChatIds: fresh.connectors.telegram.chatIds,
        })
        await p.start(ctx)
        optionalPlugins.set('telegram', p)
        changes.push('telegram started')
      }

      // --- OpenBB API Server ---
      const openbbWanted = fresh.openbb.apiServer.enabled
      const openbbRunning = optionalPlugins.has('openbb-server')
      if (openbbRunning && !openbbWanted) {
        await optionalPlugins.get('openbb-server')!.stop()
        optionalPlugins.delete('openbb-server')
        changes.push('openbb-server stopped')
      } else if (!openbbRunning && openbbWanted) {
        const p = new OpenBBServerPlugin({ port: fresh.openbb.apiServer.port })
        await p.start(ctx)
        optionalPlugins.set('openbb-server', p)
        changes.push('openbb-server started')
      } else if (openbbRunning && openbbWanted) {
        const current = optionalPlugins.get('openbb-server') as OpenBBServerPlugin
        if (current.port !== fresh.openbb.apiServer.port) {
          await current.stop()
          optionalPlugins.delete('openbb-server')
          const p = new OpenBBServerPlugin({ port: fresh.openbb.apiServer.port })
          await p.start(ctx)
          optionalPlugins.set('openbb-server', p)
          changes.push(`openbb-server restarted on port ${fresh.openbb.apiServer.port}`)
        }
      }

      if (changes.length > 0) {
        console.log(`reconnect: connectors — ${changes.join(', ')}`)
      }
      return { success: true, message: changes.length > 0 ? changes.join(', ') : 'no changes' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('reconnect: connectors failed:', msg)
      return { success: false, error: msg }
    } finally {
      connectorsReconnecting = false
    }
  }

  // ==================== Engine Context ====================

  const ctx: EngineContext = {
    config, connectorCenter, agentCenter, eventLog, heartbeat, cronEngine, toolCenter,
    accountManager, marketDataEngine, strategyStore, backtestEngine,
    getAccountGit: (id: string): ITradingGit | undefined => accountSetups.get(id)?.git,
    reconnectAccount,
    reconnectConnectors,
  }

  for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
    await plugin.start(ctx)
    console.log(`plugin started: ${plugin.name}`)
  }

  console.log('engine: started')

  // ==================== CCXT Background Injection ====================
  // CCXT accounts init in background (loadMarkets is slow). When done, register
  // CCXT-specific tools so the next agent call picks them up automatically.
  ccxtInitPromise.then(() => {
    // Check if any CCXT accounts were successfully registered
    const hasCcxt = Array.from(accountSetups.values()).some(
      (s) => s.account instanceof CcxtAccount,
    )
    if (!hasCcxt) return

    toolCenter.register(
      createCcxtProviderTools({
        accountManager,
        getGit: (id) => accountSetups.get(id)?.git,
        getGitState: (id) => accountSetups.get(id)?.getGitState(),
      }),
      'trading-ccxt',
    )
    console.log('ccxt: provider tools registered')
  }).catch((err) => {
    console.error('ccxt: background init failed:', err instanceof Error ? err.message : String(err))
  })

  // ==================== Shutdown ====================

  let stopped = false
  const shutdown = async () => {
    stopped = true
    heartbeat.stop()
    cronListener.stop()
    cronEngine.stop()
    for (const plugin of [...corePlugins, ...optionalPlugins.values()]) {
      await plugin.stop()
    }
    marketDataEngine.stopAll()
    marketDataStore.close()
    strategyStore.close()
    await eventLog.close()
    await accountManager.closeAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  // ==================== Tick Loop ====================

  while (!stopped) {
    await sleep(config.engine.interval)
  }
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
