import Database from 'better-sqlite3'
import { resolve } from 'path'
import { mkdirSync } from 'fs'

const DB_PATH = resolve('data/strategy/strategy.db')

export interface Strategy {
  id: string
  name: string
  description: string       // Korean description
  type: 'trading' | 'risk'  // trading strategy or risk management
  config: Record<string, unknown>  // strategy parameters (JSON)
  enabled: boolean
  createdAt: string
  updatedAt: string
  source: 'ai' | 'user'     // who created it
  parentId: string | null    // if AI-refined, reference to original
}

export interface BacktestResult {
  id: string
  name: string
  exchange: string
  symbols: string[]          // JSON
  timeframe: string
  startDate: string          // ISO date
  endDate: string            // ISO date
  strategyIds: string[]      // JSON — active trading strategies used
  riskIds: string[]          // JSON — active risk strategies used
  strategyConfigs: Record<string, { name: string; config: Record<string, unknown> }> | null  // snapshot of strategy configs at test time
  status: 'running' | 'completed' | 'error'
  createdAt: string
  totalPnl: number | null
  totalTrades: number | null
  wins: number | null
  losses: number | null
  winRate: number | null
  dailyPnl: Record<string, number> | null
  weeklyPnl: Record<string, number> | null
  monthlyPnl: Record<string, number> | null
  error: string | null
}

export interface BacktestTrade {
  id: string
  backtestId: string
  symbol: string
  side: 'buy' | 'sell'
  entryPrice: number
  exitPrice: number | null
  quantity: number
  entryTime: string
  exitTime: string | null
  pnl: number | null
  status: 'open' | 'closed'
}

export class StrategyStore {
  private db: Database.Database

  constructor() {
    mkdirSync(resolve('data/strategy'), { recursive: true })
    this.db = new Database(DB_PATH)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'trading',
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        parent_id TEXT
      );

      CREATE TABLE IF NOT EXISTS backtest_results (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        exchange TEXT NOT NULL,
        symbols TEXT NOT NULL DEFAULT '[]',
        timeframe TEXT NOT NULL DEFAULT '1h',
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        strategy_ids TEXT NOT NULL DEFAULT '[]',
        risk_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'running',
        created_at TEXT NOT NULL,
        total_pnl REAL,
        total_trades INTEGER,
        wins INTEGER,
        losses INTEGER,
        win_rate REAL,
        daily_pnl TEXT,
        weekly_pnl TEXT,
        monthly_pnl TEXT,
        error TEXT
      );


      CREATE TABLE IF NOT EXISTS backtest_trades (
        id TEXT PRIMARY KEY,
        backtest_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL,
        quantity REAL NOT NULL,
        entry_time TEXT NOT NULL,
        exit_time TEXT,
        pnl REAL,
        status TEXT NOT NULL DEFAULT 'open',
        FOREIGN KEY (backtest_id) REFERENCES backtest_results(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest ON backtest_trades(backtest_id);
      CREATE INDEX IF NOT EXISTS idx_strategies_type ON strategies(type);
    `)
    // Migration: add strategy_configs column
    try { this.db.exec('ALTER TABLE backtest_results ADD COLUMN strategy_configs TEXT') } catch { /* already exists */ }
  }

  // ---- Strategy CRUD ----

  getStrategies(type?: 'trading' | 'risk'): Strategy[] {
    const sql = type
      ? 'SELECT * FROM strategies WHERE type = ? ORDER BY created_at DESC'
      : 'SELECT * FROM strategies ORDER BY created_at DESC'
    const rows = (type ? this.db.prepare(sql).all(type) : this.db.prepare(sql).all()) as any[]
    return rows.map(this.mapStrategy)
  }

  getStrategy(id: string): Strategy | null {
    const r = this.db.prepare('SELECT * FROM strategies WHERE id = ?').get(id) as any
    return r ? this.mapStrategy(r) : null
  }

  getEnabledStrategies(type: 'trading' | 'risk'): Strategy[] {
    const rows = this.db.prepare('SELECT * FROM strategies WHERE type = ? AND enabled = 1 ORDER BY created_at ASC').all(type) as any[]
    return rows.map(this.mapStrategy)
  }

  upsertStrategy(s: Strategy) {
    this.db.prepare(`
      INSERT INTO strategies (id, name, description, type, config, enabled, created_at, updated_at, source, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, description = excluded.description, config = excluded.config,
        enabled = excluded.enabled, updated_at = excluded.updated_at, source = excluded.source,
        parent_id = excluded.parent_id
    `).run(s.id, s.name, s.description, s.type, JSON.stringify(s.config), s.enabled ? 1 : 0,
      s.createdAt, s.updatedAt, s.source, s.parentId)
  }

  deleteStrategy(id: string) {
    this.db.prepare('DELETE FROM strategies WHERE id = ?').run(id)
  }

  toggleStrategy(id: string, enabled: boolean) {
    this.db.prepare('UPDATE strategies SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id)
  }

  // ---- Backtest CRUD ----

  getBacktestResults(limit = 50): BacktestResult[] {
    return (this.db.prepare(
      'SELECT id, name, exchange, symbols, timeframe, start_date, end_date, strategy_ids, risk_ids, strategy_configs, status, created_at, total_pnl, total_trades, wins, losses, win_rate, error FROM backtest_results ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as any[]).map((r: any) => ({
      id: r.id, name: r.name, exchange: r.exchange,
      symbols: JSON.parse(r.symbols || '[]'), timeframe: r.timeframe,
      startDate: r.start_date, endDate: r.end_date,
      strategyIds: JSON.parse(r.strategy_ids || '[]'),
      riskIds: JSON.parse(r.risk_ids || '[]'),
      strategyConfigs: r.strategy_configs ? JSON.parse(r.strategy_configs) : null,
      status: r.status, createdAt: r.created_at,
      totalPnl: r.total_pnl, totalTrades: r.total_trades,
      wins: r.wins, losses: r.losses, winRate: r.win_rate,
      dailyPnl: null, weeklyPnl: null, monthlyPnl: null, // skip for list
      error: r.error,
    }))
  }

  getBacktestResult(id: string): BacktestResult | null {
    const r = this.db.prepare('SELECT * FROM backtest_results WHERE id = ?').get(id) as any
    return r ? this.mapBacktest(r) : null
  }

  insertBacktest(b: BacktestResult) {
    this.db.prepare(`
      INSERT INTO backtest_results (id, name, exchange, symbols, timeframe, start_date, end_date, strategy_ids, risk_ids, strategy_configs, status, created_at,
        total_pnl, total_trades, wins, losses, win_rate, daily_pnl, weekly_pnl, monthly_pnl, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.id, b.name, b.exchange, JSON.stringify(b.symbols), b.timeframe, b.startDate, b.endDate,
      JSON.stringify(b.strategyIds), JSON.stringify(b.riskIds),
      b.strategyConfigs ? JSON.stringify(b.strategyConfigs) : null,
      b.status, b.createdAt,
      b.totalPnl, b.totalTrades, b.wins, b.losses, b.winRate,
      b.dailyPnl ? JSON.stringify(b.dailyPnl) : null,
      b.weeklyPnl ? JSON.stringify(b.weeklyPnl) : null,
      b.monthlyPnl ? JSON.stringify(b.monthlyPnl) : null,
      b.error)
  }

  updateBacktest(id: string, updates: Partial<BacktestResult>) {
    const fields: string[] = []
    const values: unknown[] = []
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.totalPnl !== undefined) { fields.push('total_pnl = ?'); values.push(updates.totalPnl) }
    if (updates.totalTrades !== undefined) { fields.push('total_trades = ?'); values.push(updates.totalTrades) }
    if (updates.wins !== undefined) { fields.push('wins = ?'); values.push(updates.wins) }
    if (updates.losses !== undefined) { fields.push('losses = ?'); values.push(updates.losses) }
    if (updates.winRate !== undefined) { fields.push('win_rate = ?'); values.push(updates.winRate) }
    if (updates.dailyPnl !== undefined) { fields.push('daily_pnl = ?'); values.push(JSON.stringify(updates.dailyPnl)) }
    if (updates.weeklyPnl !== undefined) { fields.push('weekly_pnl = ?'); values.push(JSON.stringify(updates.weeklyPnl)) }
    if (updates.monthlyPnl !== undefined) { fields.push('monthly_pnl = ?'); values.push(JSON.stringify(updates.monthlyPnl)) }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error) }
    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE backtest_results SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteBacktest(id: string) {
    this.db.prepare('DELETE FROM backtest_trades WHERE backtest_id = ?').run(id)
    this.db.prepare('DELETE FROM backtest_results WHERE id = ?').run(id)
  }

  // ---- Backtest Trades ----

  insertTrades(trades: BacktestTrade[]) {
    const stmt = this.db.prepare(`
      INSERT INTO backtest_trades (id, backtest_id, symbol, side, entry_price, exit_price, quantity, entry_time, exit_time, pnl, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const tx = this.db.transaction((rows: BacktestTrade[]) => {
      for (const t of rows) {
        stmt.run(t.id, t.backtestId, t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.entryTime, t.exitTime, t.pnl, t.status)
      }
    })
    tx(trades)
  }

  getBacktestTrades(backtestId: string): BacktestTrade[] {
    return (this.db.prepare('SELECT * FROM backtest_trades WHERE backtest_id = ? ORDER BY entry_time ASC').all(backtestId) as any[]).map(r => ({
      id: r.id, backtestId: r.backtest_id, symbol: r.symbol, side: r.side,
      entryPrice: r.entry_price, exitPrice: r.exit_price, quantity: r.quantity,
      entryTime: r.entry_time, exitTime: r.exit_time, pnl: r.pnl, status: r.status,
    }))
  }

  // ---- Helpers ----

  private mapStrategy(r: any): Strategy {
    return {
      id: r.id, name: r.name, description: r.description, type: r.type,
      config: JSON.parse(r.config || '{}'), enabled: !!r.enabled,
      createdAt: r.created_at, updatedAt: r.updated_at,
      source: r.source, parentId: r.parent_id,
    }
  }

  private mapBacktest(r: any): BacktestResult {
    return {
      id: r.id, name: r.name, exchange: r.exchange,
      symbols: JSON.parse(r.symbols || '[]'), timeframe: r.timeframe,
      startDate: r.start_date, endDate: r.end_date,
      strategyIds: JSON.parse(r.strategy_ids || '[]'),
      riskIds: JSON.parse(r.risk_ids || '[]'),
      strategyConfigs: r.strategy_configs ? JSON.parse(r.strategy_configs) : null,
      status: r.status, createdAt: r.created_at,
      totalPnl: r.total_pnl, totalTrades: r.total_trades,
      wins: r.wins, losses: r.losses, winRate: r.win_rate,
      dailyPnl: r.daily_pnl ? JSON.parse(r.daily_pnl) : null,
      weeklyPnl: r.weekly_pnl ? JSON.parse(r.weekly_pnl) : null,
      monthlyPnl: r.monthly_pnl ? JSON.parse(r.monthly_pnl) : null,
      error: r.error,
    }
  }

  close() { this.db.close() }
}
