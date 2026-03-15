import Database from 'better-sqlite3'
import { resolve } from 'path'
import { mkdirSync } from 'fs'

const DB_PATH = resolve('data/market-data/candles.db')

export interface Candle {
  exchange: string
  symbol: string
  timeframe: string
  timestamp: number  // unix ms
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ConnectionConfig {
  id: string
  exchange: string
  symbols: string[]    // JSON stored
  timeframes: string[] // JSON stored
  historyDays: number
  enabled: boolean
  status: 'disconnected' | 'connecting' | 'syncing' | 'connected' | 'error'
  firstBuilt: string | null  // ISO date
  lastUpdate: string | null  // ISO date
  error: string | null
}

export class MarketDataStore {
  private db: Database.Database

  constructor() {
    mkdirSync(resolve('data/market-data'), { recursive: true })
    this.db = new Database(DB_PATH)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candles (
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        PRIMARY KEY (exchange, symbol, timeframe, timestamp)
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_candles_lookup
        ON candles (exchange, symbol, timeframe, timestamp);

      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        exchange TEXT NOT NULL,
        symbols TEXT NOT NULL DEFAULT '[]',
        timeframes TEXT NOT NULL DEFAULT '["1m"]',
        history_days INTEGER NOT NULL DEFAULT 30,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'disconnected',
        first_built TEXT,
        last_update TEXT,
        error TEXT
      );
    `)
  }

  // ---- Candle operations ----

  insertCandles(candles: Candle[]) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO candles (exchange, symbol, timeframe, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const tx = this.db.transaction((rows: Candle[]) => {
      for (const c of rows) {
        stmt.run(c.exchange, c.symbol, c.timeframe, c.timestamp, c.open, c.high, c.low, c.close, c.volume)
      }
    })
    tx(candles)
  }

  getCandles(exchange: string, symbol: string, timeframe: string, since?: number, until?: number, limit = 1000): Candle[] {
    let sql = 'SELECT * FROM candles WHERE exchange = ? AND symbol = ? AND timeframe = ?'
    const params: (string | number)[] = [exchange, symbol, timeframe]
    if (since) { sql += ' AND timestamp >= ?'; params.push(since) }
    if (until) { sql += ' AND timestamp <= ?'; params.push(until) }
    sql += ' ORDER BY timestamp ASC LIMIT ?'
    params.push(limit)
    return this.db.prepare(sql).all(...params) as Candle[]
  }

  getLatestCandle(exchange: string, symbol: string, timeframe: string): Candle | null {
    return (this.db.prepare(
      'SELECT * FROM candles WHERE exchange = ? AND symbol = ? AND timeframe = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(exchange, symbol, timeframe) as Candle) || null
  }

  getCandleCount(exchange: string, symbol: string, timeframe: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM candles WHERE exchange = ? AND symbol = ? AND timeframe = ?'
    ).get(exchange, symbol, timeframe) as { cnt: number }
    return row.cnt
  }

  getDateRange(exchange: string, symbol: string, timeframe: string): { oldest: number | null, newest: number | null } {
    const row = this.db.prepare(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM candles WHERE exchange = ? AND symbol = ? AND timeframe = ?'
    ).get(exchange, symbol, timeframe) as { oldest: number | null, newest: number | null }
    return row
  }

  // ---- Connection operations ----

  getConnections(): ConnectionConfig[] {
    const rows = this.db.prepare('SELECT * FROM connections').all() as any[]
    return rows.map(r => ({
      id: r.id,
      exchange: r.exchange,
      symbols: JSON.parse(r.symbols),
      timeframes: JSON.parse(r.timeframes),
      historyDays: r.history_days,
      enabled: !!r.enabled,
      status: r.status,
      firstBuilt: r.first_built,
      lastUpdate: r.last_update,
      error: r.error,
    }))
  }

  getConnection(id: string): ConnectionConfig | null {
    const r = this.db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as any
    if (!r) return null
    return {
      id: r.id, exchange: r.exchange,
      symbols: JSON.parse(r.symbols), timeframes: JSON.parse(r.timeframes),
      historyDays: r.history_days, enabled: !!r.enabled,
      status: r.status, firstBuilt: r.first_built, lastUpdate: r.last_update, error: r.error,
    }
  }

  upsertConnection(conn: ConnectionConfig) {
    this.db.prepare(`
      INSERT INTO connections (id, exchange, symbols, timeframes, history_days, enabled, status, first_built, last_update, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        exchange = excluded.exchange,
        symbols = excluded.symbols,
        timeframes = excluded.timeframes,
        history_days = excluded.history_days,
        enabled = excluded.enabled,
        status = excluded.status,
        first_built = COALESCE(connections.first_built, excluded.first_built),
        last_update = excluded.last_update,
        error = excluded.error
    `).run(
      conn.id, conn.exchange, JSON.stringify(conn.symbols), JSON.stringify(conn.timeframes),
      conn.historyDays, conn.enabled ? 1 : 0, conn.status,
      conn.firstBuilt, conn.lastUpdate, conn.error
    )
  }

  updateConnectionStatus(id: string, status: string, error?: string | null) {
    const now = new Date().toISOString()
    this.db.prepare(
      'UPDATE connections SET status = ?, error = ?, last_update = ? WHERE id = ?'
    ).run(status, error ?? null, now, id)
  }

  deleteConnection(id: string) {
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id)
  }

  deleteCandles(exchange: string, symbol?: string) {
    if (symbol) {
      this.db.prepare('DELETE FROM candles WHERE exchange = ? AND symbol = ?').run(exchange, symbol)
    } else {
      this.db.prepare('DELETE FROM candles WHERE exchange = ?').run(exchange)
    }
  }

  close() {
    this.db.close()
  }
}
