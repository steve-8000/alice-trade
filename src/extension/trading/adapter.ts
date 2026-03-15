/**
 * Unified Trading Tool Factory — multi-account source routing
 *
 * Creates THREE consolidated AI tools that route to accounts via `source` parameter:
 * - tradingQuery: All read operations (accounts, contracts, portfolio, orders, quotes, clock)
 * - tradingOrder: All staging mutations (place, modify, close, cancel)
 * - tradingGit: All git-flow operations (log, show, status, commit, push, sync, simulate)
 *
 * Replaces the old 19-tool set with 3 action-parameterized tools.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { AccountManager } from './account-manager.js'
import type { ITradingAccount } from './interfaces.js'
import type { ITradingGit } from './git/interfaces.js'
import type { GitState, OrderStatusUpdate } from './git/types.js'

// ==================== Resolver interface ====================

export interface AccountResolver {
  accountManager: AccountManager
  getGit: (accountId: string) => ITradingGit | undefined
  getGitState: (accountId: string) => Promise<GitState> | undefined
}

// ==================== Exported helpers (used by provider tools) ====================

export interface ResolvedAccount {
  account: ITradingAccount
  id: string
}

export function resolveAccounts(
  mgr: AccountManager,
  source?: string,
): ResolvedAccount[] {
  const summaries = mgr.listAccounts()
  if (!source) {
    return summaries
      .map((s) => ({ account: mgr.getAccount(s.id)!, id: s.id }))
      .filter((r) => r.account)
  }
  // Try id match first, then provider match
  const byId = mgr.getAccount(source)
  if (byId) return [{ account: byId, id: source }]

  const byProvider = summaries
    .filter((s) => s.provider === source)
    .map((s) => ({ account: mgr.getAccount(s.id)!, id: s.id }))
    .filter((r) => r.account)
  return byProvider
}

export function resolveOne(
  mgr: AccountManager,
  source: string,
): ResolvedAccount {
  const results = resolveAccounts(mgr, source)
  if (results.length === 0) {
    throw new Error(`No account found matching source "${source}". Use listAccounts to see available accounts.`)
  }
  if (results.length > 1) {
    throw new Error(
      `Multiple accounts match source "${source}": ${results.map((r) => r.id).join(', ')}. Use account id for exact match.`,
    )
  }
  return results[0]
}

function requireGit(resolver: AccountResolver, accountId: string): ITradingGit {
  const git = resolver.getGit(accountId)
  if (!git) throw new Error(`No git instance for account "${accountId}"`)
  return git
}

const sourceDesc = (required: boolean, extra?: string) => {
  const base = `Account source — matches account id (e.g. "alpaca-paper") or provider (e.g. "alpaca", "ccxt").`
  const req = required
    ? ' Required for this operation.'
    : ' Optional — omit to query all accounts.'
  return base + req + (extra ? ` ${extra}` : '')
}

// ==================== Tool factory ====================

export function createTradingTools(resolver: AccountResolver) {
  const { accountManager } = resolver

  return {
    // ==================== Query ====================

    tradingQuery: tool({
      description: `Query trading data: accounts, contracts, portfolio, orders, quotes, market clock.

Actions:
- accounts: List all registered trading accounts (discover source values)
- search: Search broker accounts for tradeable contracts matching a pattern
- contractDetails: Get full contract specification from a specific broker account
- account: Query account info (cash, equity, buyingPower, unrealizedPnL)
- portfolio: Query current portfolio holdings with PnL and allocation %
- orders: Query order history (filled, pending, cancelled)
- quote: Get latest quote/price for a contract (use aliceId from search)
- marketClock: Check if market is open, next open/close times`,
      inputSchema: z.object({
        action: z.enum(['accounts', 'search', 'contractDetails', 'account', 'portfolio', 'orders', 'quote', 'marketClock']).describe('Query type'),
        source: z.string().optional().describe(sourceDesc(false)),
        pattern: z.string().optional().describe('Symbol or keyword to search (for search action)'),
        symbol: z.string().optional().describe('Filter by ticker (for portfolio) or symbol to look up (for contractDetails)'),
        aliceId: z.string().optional().describe('Contract identifier (for quote, contractDetails)'),
        secType: z.string().optional().describe('Security type filter for contractDetails (e.g. "STK", "CRYPTO")'),
        currency: z.string().optional().describe('Currency filter for contractDetails (e.g. "USD", "USDT")'),
      }),
      execute: async (input) => {
        switch (input.action) {
          case 'accounts': {
            return accountManager.listAccounts()
          }

          case 'search': {
            if (!input.pattern) return { error: 'pattern is required for search' }
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return { error: 'No accounts available.' }

            const allResults: Array<Record<string, unknown>> = []
            for (const { account, id } of targets) {
              try {
                const descriptions = await account.searchContracts(input.pattern)
                for (const desc of descriptions) {
                  allResults.push({ source: id, ...desc })
                }
              } catch {
                // Skip accounts that fail to search
              }
            }

            if (allResults.length === 0) return { results: [], message: `No contracts found matching "${input.pattern}".` }
            return allResults
          }

          case 'contractDetails': {
            if (!input.source) return { error: 'source is required for contractDetails' }
            const { account, id } = resolveOne(accountManager, input.source)

            const query: Record<string, unknown> = {}
            if (input.symbol) query.symbol = input.symbol
            if (input.aliceId) query.aliceId = input.aliceId
            if (input.secType) query.secType = input.secType
            if (input.currency) query.currency = input.currency

            const details = await account.getContractDetails(query)
            if (!details) return { error: `No contract details found.` }
            return { source: id, ...details }
          }

          case 'account': {
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return { error: 'No accounts available.' }

            const results = await Promise.all(
              targets.map(async ({ account, id }) => {
                const info = await account.getAccount()
                return { source: id, ...info }
              }),
            )
            return results.length === 1 ? results[0] : results
          }

          case 'portfolio': {
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return { positions: [], message: 'No accounts available.' }

            const allPositions: Array<Record<string, unknown>> = []

            for (const { account, id } of targets) {
              const positions = await account.getPositions()
              const accountInfo = await account.getAccount()

              const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0)

              for (const pos of positions) {
                if (input.symbol && input.symbol !== 'all' && pos.contract.symbol !== input.symbol) continue

                const percentOfEquity =
                  accountInfo.equity > 0 ? (pos.marketValue / accountInfo.equity) * 100 : 0
                const percentOfPortfolio =
                  totalMarketValue > 0 ? (pos.marketValue / totalMarketValue) * 100 : 0

                allPositions.push({
                  source: id,
                  symbol: pos.contract.symbol,
                  side: pos.side,
                  qty: pos.qty,
                  avgEntryPrice: pos.avgEntryPrice,
                  currentPrice: pos.currentPrice,
                  marketValue: pos.marketValue,
                  unrealizedPnL: pos.unrealizedPnL,
                  unrealizedPnLPercent: pos.unrealizedPnLPercent,
                  costBasis: pos.costBasis,
                  leverage: pos.leverage,
                  margin: pos.margin,
                  liquidationPrice: pos.liquidationPrice,
                  percentageOfEquity: `${percentOfEquity.toFixed(1)}%`,
                  percentageOfPortfolio: `${percentOfPortfolio.toFixed(1)}%`,
                })
              }
            }

            if (allPositions.length === 0) {
              return { positions: [], message: 'No open positions.' }
            }
            return allPositions
          }

          case 'orders': {
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return []

            const results = await Promise.all(
              targets.map(async ({ account, id }) => {
                const orders = await account.getOrders()
                return orders.map((o) => ({ source: id, ...o }))
              }),
            )
            return results.flat()
          }

          case 'quote': {
            if (!input.aliceId) return { error: 'aliceId is required for quote' }
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return { error: 'No accounts available.' }

            const results: Array<Record<string, unknown>> = []
            for (const { account, id } of targets) {
              try {
                const quote = await account.getQuote({ aliceId: input.aliceId })
                results.push({ source: id, ...quote })
              } catch {
                // Skip accounts that don't support this contract
              }
            }

            if (results.length === 0) return { error: `No account could quote aliceId "${input.aliceId}".` }
            return results.length === 1 ? results[0] : results
          }

          case 'marketClock': {
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return { error: 'No accounts available.' }

            const results = await Promise.all(
              targets.map(async ({ account, id }) => {
                const clock = await account.getMarketClock()
                return { source: id, ...clock }
              }),
            )
            return results.length === 1 ? results[0] : results
          }
        }
      },
    }),

    // ==================== Order ====================

    tradingOrder: tool({
      description: `Stage a trading operation: place, modify, close, or cancel orders.

All operations are STAGED — call tradingGit(action: "commit") + tradingGit(action: "push") to execute.

Actions:
- place: Stage a new order (buy/sell). Supports qty-based or notional-based sizing.
- modify: Modify an existing pending order's price/quantity/type.
- close: Close an existing position (preferred over place+sell). Defaults to closing all shares.
- cancel: Cancel a pending order.`,
      inputSchema: z.object({
        action: z.enum(['place', 'modify', 'close', 'cancel']).describe('Operation type'),
        source: z.string().describe(sourceDesc(true)),
        aliceId: z.string().optional().describe('Contract identifier from searchContracts (required for place, close)'),
        symbol: z.string().optional().describe('Human-readable symbol for logging (e.g. "AAPL", "BTC"). Optional.'),
        side: z.enum(['buy', 'sell']).optional().describe('Buy or sell (required for place)'),
        type: z
          .enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop', 'trailing_stop_limit', 'moc'])
          .optional()
          .describe('Order type (required for place)'),
        qty: z.number().positive().optional().describe('Number of shares (supports fractional). Mutually exclusive with notional.'),
        notional: z.number().positive().optional().describe('Dollar amount to invest. Mutually exclusive with qty.'),
        price: z.number().positive().optional().describe('Limit price (required for limit/stop_limit orders)'),
        stopPrice: z.number().positive().optional().describe('Stop trigger price (required for stop/stop_limit orders)'),
        trailingAmount: z.number().positive().optional().describe('Trailing stop absolute offset in dollars'),
        trailingPercent: z.number().positive().optional().describe('Trailing stop percentage'),
        reduceOnly: z.boolean().optional().describe('Only reduce position (close only)'),
        timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok', 'opg', 'gtd']).optional().default('day').describe('Time in force (default: day)'),
        goodTillDate: z.string().optional().describe('Expiration date for GTD orders (ISO date string)'),
        extendedHours: z.boolean().optional().describe('Allow pre-market and after-hours trading'),
        parentId: z.string().optional().describe('Parent order ID for bracket orders'),
        ocaGroup: z.string().optional().describe('One-Cancels-All group name'),
        orderId: z.string().optional().describe('Order ID (required for modify, cancel)'),
      }),
      execute: (input) => {
        const { id } = resolveOne(accountManager, input.source)
        const git = requireGit(resolver, id)

        switch (input.action) {
          case 'place': {
            if (!input.aliceId || !input.side || !input.type) {
              return { error: 'aliceId, side, and type are required for place' }
            }
            return git.add({
              action: 'placeOrder',
              params: {
                aliceId: input.aliceId,
                symbol: input.symbol,
                side: input.side,
                type: input.type,
                qty: input.qty,
                notional: input.notional,
                price: input.price,
                stopPrice: input.stopPrice,
                trailingAmount: input.trailingAmount,
                trailingPercent: input.trailingPercent,
                reduceOnly: input.reduceOnly,
                timeInForce: input.timeInForce,
                goodTillDate: input.goodTillDate,
                extendedHours: input.extendedHours,
                parentId: input.parentId,
                ocaGroup: input.ocaGroup,
              },
            })
          }

          case 'modify': {
            if (!input.orderId) return { error: 'orderId is required for modify' }
            const { orderId, ...changes } = input
            return git.add({
              action: 'modifyOrder',
              params: {
                orderId,
                qty: changes.qty,
                price: changes.price,
                stopPrice: changes.stopPrice,
                trailingAmount: changes.trailingAmount,
                trailingPercent: changes.trailingPercent,
                type: changes.type,
                timeInForce: changes.timeInForce,
                goodTillDate: changes.goodTillDate,
              },
            })
          }

          case 'close': {
            if (!input.aliceId) return { error: 'aliceId is required for close' }
            return git.add({
              action: 'closePosition',
              params: {
                aliceId: input.aliceId,
                symbol: input.symbol,
                qty: input.qty,
              },
            })
          }

          case 'cancel': {
            if (!input.orderId) return { error: 'orderId is required for cancel' }
            return git.add({
              action: 'cancelOrder',
              params: { orderId: input.orderId },
            })
          }
        }
      },
    }),

    // ==================== Git ====================

    tradingGit: tool({
      description: `Git-like trading operations: log, show, status, commit, push, sync, simulate.

Actions:
- log: View trading decision history (like "git log --stat"). Check BEFORE making new decisions.
- show: View details of a specific trading commit (like "git show <hash>").
- status: View staging area status (staged ops, pending message, head commit).
- commit: Commit staged operations with a message (like "git commit -m"). Does NOT execute.
- push: Execute all committed operations against broker (like "git push").
- sync: Sync pending order statuses from broker (like "git pull"). Checks if limit/stop orders filled.
- simulate: Simulate price changes to see portfolio impact (dry run, read-only).`,
      inputSchema: z.object({
        action: z.enum(['log', 'show', 'status', 'commit', 'push', 'sync', 'simulate']).describe('Git operation'),
        source: z.string().optional().describe(sourceDesc(false, 'If omitted, operates on all accounts.')),
        hash: z.string().optional().describe('Commit hash to inspect (for show)'),
        message: z.string().optional().describe('Commit message explaining your trading decision (for commit)'),
        limit: z.number().int().positive().optional().describe('Number of recent commits to return (for log, default: 10)'),
        symbol: z.string().optional().describe('Filter commits by symbol (for log)'),
        priceChanges: z
          .array(
            z.object({
              symbol: z.string().describe('Ticker (e.g. "AAPL") or "all" for all holdings'),
              change: z.string().describe('Price change: "@150" for absolute, "+10%" or "-5%" for relative'),
            }),
          )
          .optional()
          .describe('Array of price changes to simulate (for simulate)'),
      }),
      execute: async (input) => {
        switch (input.action) {
          case 'log': {
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return []

            const allEntries: Array<Record<string, unknown>> = []
            for (const { id } of targets) {
              const git = resolver.getGit(id)
              if (!git) continue
              const entries = git.log({ limit: input.limit, symbol: input.symbol })
              for (const entry of entries) {
                allEntries.push({ source: id, ...entry })
              }
            }

            // Sort by timestamp descending
            allEntries.sort((a, b) => {
              const ta = new Date(a.timestamp as string).getTime()
              const tb = new Date(b.timestamp as string).getTime()
              return tb - ta
            })

            return input.limit ? allEntries.slice(0, input.limit) : allEntries
          }

          case 'show': {
            if (!input.hash) return { error: 'hash is required for show' }
            // Search all gits for the hash
            const summaries = accountManager.listAccounts()
            for (const s of summaries) {
              const git = resolver.getGit(s.id)
              if (!git) continue
              const commit = git.show(input.hash)
              if (commit) return { source: s.id, ...commit }
            }
            return { error: `Commit ${input.hash} not found in any account` }
          }

          case 'status': {
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return []

            const results: Array<Record<string, unknown>> = []
            for (const { id } of targets) {
              const git = resolver.getGit(id)
              if (!git) continue
              results.push({ source: id, ...git.status() })
            }
            return results.length === 1 ? results[0] : results
          }

          case 'commit': {
            if (!input.message) return { error: 'message is required for commit' }
            const targets = resolveAccounts(accountManager, input.source)
            const results: Array<Record<string, unknown>> = []

            for (const { id } of targets) {
              const git = resolver.getGit(id)
              if (!git) continue
              const status = git.status()
              if (status.staged.length === 0) continue
              results.push({ source: id, ...git.commit(input.message) })
            }

            if (results.length === 0) return { message: 'No staged operations to commit.' }
            return results.length === 1 ? results[0] : results
          }

          case 'push': {
            const targets = resolveAccounts(accountManager, input.source)
            const results: Array<Record<string, unknown>> = []

            for (const { id } of targets) {
              const git = resolver.getGit(id)
              if (!git) continue
              const status = git.status()
              if (!status.pendingMessage) continue
              const result = await git.push()
              results.push({ source: id, ...result })
            }

            if (results.length === 0) return { message: 'No committed operations to push.' }
            return results.length === 1 ? results[0] : results
          }

          case 'sync': {
            const targets = resolveAccounts(accountManager, input.source)
            const results: Array<Record<string, unknown>> = []

            for (const { id, account } of targets) {
              const git = resolver.getGit(id)
              if (!git) continue
              const gitState = resolver.getGitState(id)
              if (!gitState) continue

              const pendingOrders = git.getPendingOrderIds()
              if (pendingOrders.length === 0) continue

              const brokerOrders = await account.getOrders()
              const updates: OrderStatusUpdate[] = []

              for (const { orderId, symbol } of pendingOrders) {
                const brokerOrder = brokerOrders.find((o) => o.id === orderId)
                if (!brokerOrder) continue

                const newStatus = brokerOrder.status
                if (newStatus !== 'pending') {
                  updates.push({
                    orderId,
                    symbol,
                    previousStatus: 'pending',
                    currentStatus: newStatus,
                    filledPrice: brokerOrder.filledPrice,
                    filledQty: brokerOrder.filledQty,
                  })
                }
              }

              if (updates.length === 0) continue

              const state = await gitState
              const result = await git.sync(updates, state)
              results.push({ source: id, ...result })
            }

            if (results.length === 0) return { message: 'No pending orders to sync.', updatedCount: 0 }
            return results.length === 1 ? results[0] : results
          }

          case 'simulate': {
            if (!input.priceChanges) return { error: 'priceChanges is required for simulate' }
            const targets = resolveAccounts(accountManager, input.source)
            if (targets.length === 0) return { error: 'No accounts available.' }

            const results: Array<Record<string, unknown>> = []
            for (const { id } of targets) {
              const git = resolver.getGit(id)
              if (!git) continue
              const result = await git.simulatePriceChange(input.priceChanges)
              results.push({ source: id, ...result })
            }
            return results.length === 1 ? results[0] : results
          }
        }
      },
    }),
  }
}
