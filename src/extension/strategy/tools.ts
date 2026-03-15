import { tool } from 'ai'
import { z } from 'zod'
import type { StrategyStore } from './store.js'

export function createStrategyTools(store: StrategyStore) {
  return {
    strategyAdd: tool({
      description: '새로운 트레이딩 전략 또는 리스크 관리 전략을 추가합니다. 전략 설명은 반드시 한국어로 작성해야 합니다.',
      inputSchema: z.object({
        name: z.string().describe('전략 이름 (영문)'),
        description: z.string().describe('전략에 대한 상세 설명 (반드시 한국어로 작성)'),
        type: z.enum(['trading', 'risk']).describe('전략 유형: trading(트레이딩) 또는 risk(리스크 관리)'),
        config: z.record(z.string(), z.unknown()).describe('전략 매개변수 (JSON 형태, 예: {"rsiPeriod": 14, "overbought": 70})'),
      }),
      execute: async (input) => {
        const id = `${input.type}-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        store.upsertStrategy({
          id, name: input.name, description: input.description,
          type: input.type, config: input.config, enabled: false,
          createdAt: now, updatedAt: now, source: 'ai', parentId: null,
        })
        return { success: true, id, message: `전략 "${input.name}"이(가) 추가되었습니다. UI에서 활성화할 수 있습니다.` }
      },
    }),

    strategyList: tool({
      description: '등록된 전략 목록을 조회합니다.',
      inputSchema: z.object({
        type: z.enum(['trading', 'risk', 'all']).optional().default('all').describe('조회할 전략 유형'),
      }),
      execute: async (input) => {
        const type = input.type === 'all' ? undefined : input.type
        return { strategies: store.getStrategies(type) }
      },
    }),

    strategyUpdate: tool({
      description: '기존 전략의 매개변수를 수정합니다. 전략 설명은 반드시 한국어로 작성해야 합니다.',
      inputSchema: z.object({
        id: z.string().describe('수정할 전략 ID'),
        name: z.string().optional().describe('새 전략 이름'),
        description: z.string().optional().describe('새 전략 설명 (한국어)'),
        config: z.record(z.string(), z.unknown()).optional().describe('새 매개변수'),
      }),
      execute: async (input) => {
        const existing = store.getStrategy(input.id)
        if (!existing) return { error: `전략 "${input.id}"을(를) 찾을 수 없습니다.` }
        store.upsertStrategy({
          ...existing,
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          config: input.config ?? existing.config,
          updatedAt: new Date().toISOString(),
        })
        return { success: true, message: `전략 "${existing.name}"이(가) 수정되었습니다.` }
      },
    }),

    strategyDelete: tool({
      description: '전략을 삭제합니다.',
      inputSchema: z.object({ id: z.string().describe('삭제할 전략 ID') }),
      execute: async (input) => {
        store.deleteStrategy(input.id)
        return { success: true, message: '전략이 삭제되었습니다.' }
      },
    }),

    strategyRefine: tool({
      description: '백테스트 결과를 기반으로 기존 전략의 매개변수를 미세조정하여 새로운 AI 추천 전략을 생성합니다. 반드시 한국어로 설명을 작성하세요.',
      inputSchema: z.object({
        parentId: z.string().describe('원본 전략 ID'),
        name: z.string().describe('새 전략 이름'),
        description: z.string().describe('미세조정 내용 설명 (한국어)'),
        config: z.record(z.string(), z.unknown()).describe('조정된 매개변수'),
        reason: z.string().describe('조정 이유 (한국어)'),
      }),
      execute: async (input) => {
        const parent = store.getStrategy(input.parentId)
        if (!parent) return { error: `원본 전략 "${input.parentId}"을(를) 찾을 수 없습니다.` }
        const id = `${parent.type}-refined-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        store.upsertStrategy({
          id, name: input.name,
          description: `${input.description}\n\n조정 이유: ${input.reason}\n원본: ${parent.name}`,
          type: parent.type, config: input.config, enabled: false,
          createdAt: now, updatedAt: now, source: 'ai', parentId: input.parentId,
        })
        return { success: true, id, message: `AI 추천 전략 "${input.name}"이(가) 추가되었습니다.` }
      },
    }),

    strategyGetActive: tool({
      description: '현재 활성화된 트레이딩 전략과 리스크 관리 전략을 조회합니다.',
      inputSchema: z.object({}),
      execute: async () => ({
        tradingStrategies: store.getEnabledStrategies('trading'),
        riskStrategies: store.getEnabledStrategies('risk'),
      }),
    }),

    backtestGetResults: tool({
      description: '과거 백테스트 결과 목록을 조회합니다.',
      inputSchema: z.object({}),
      execute: async () => ({ results: store.getBacktestResults() }),
    }),

    backtestGetDetail: tool({
      description: '특정 백테스트의 상세 결과와 매매 기록을 조회합니다.',
      inputSchema: z.object({ id: z.string().describe('백테스트 ID') }),
      execute: async (input) => {
        const result = store.getBacktestResult(input.id)
        if (!result) return { error: '백테스트를 찾을 수 없습니다.' }
        const trades = store.getBacktestTrades(input.id)
        return { result, trades }
      },
    }),

    backtestRun: tool({
      description: '활성화된 전략을 바탕으로 과거 데이터에 대한 백테스트를 실행합니다. AI가 직접 전략 로직을 시뮬레이션하고 매매 기록을 생성해야 합니다.',
      inputSchema: z.object({
        name: z.string().describe('백테스트 이름'),
        exchange: z.string().describe('거래소 (예: binance)'),
        symbols: z.array(z.string()).describe('테스트할 심볼 목록'),
        timeframe: z.string().default('1h').describe('캔들 타임프레임'),
        startDate: z.string().describe('시작 날짜 (ISO)'),
        endDate: z.string().describe('종료 날짜 (ISO)'),
        trades: z.array(z.object({
          symbol: z.string(),
          side: z.enum(['buy', 'sell']),
          entryPrice: z.number(),
          exitPrice: z.number(),
          quantity: z.number(),
          entryTime: z.string(),
          exitTime: z.string(),
          pnl: z.number(),
        })).describe('시뮬레이션된 매매 기록'),
        dailyPnl: z.record(z.string(), z.number()).optional().describe('일별 PNL'),
        weeklyPnl: z.record(z.string(), z.number()).optional().describe('주별 PNL'),
        monthlyPnl: z.record(z.string(), z.number()).optional().describe('월별 PNL'),
      }),
      execute: async (input) => {
        const id = `bt-${Date.now().toString(36)}`
        const now = new Date().toISOString()
        const activeStrategies = store.getEnabledStrategies('trading')
        const activeRisk = store.getEnabledStrategies('risk')

        const wins = input.trades.filter(t => t.pnl > 0).length
        const losses = input.trades.filter(t => t.pnl <= 0).length
        const totalPnl = input.trades.reduce((s, t) => s + t.pnl, 0)

        store.insertBacktest({
          id, name: input.name, exchange: input.exchange,
          symbols: input.symbols, timeframe: input.timeframe,
          startDate: input.startDate, endDate: input.endDate,
          strategyIds: activeStrategies.map(s => s.id),
          riskIds: activeRisk.map(s => s.id),
          status: 'completed', createdAt: now,
          totalPnl, totalTrades: input.trades.length,
          wins, losses, winRate: input.trades.length > 0 ? wins / input.trades.length : 0,
          dailyPnl: input.dailyPnl || null,
          weeklyPnl: input.weeklyPnl || null,
          monthlyPnl: input.monthlyPnl || null,
          error: null,
        })

        const backtestTrades = input.trades.map((t, i) => ({
          id: `${id}-t${i}`, backtestId: id,
          symbol: t.symbol, side: t.side as 'buy' | 'sell',
          entryPrice: t.entryPrice, exitPrice: t.exitPrice,
          quantity: t.quantity, entryTime: t.entryTime, exitTime: t.exitTime,
          pnl: t.pnl, status: 'closed' as const,
        }))
        store.insertTrades(backtestTrades)

        return {
          success: true, id,
          summary: { totalPnl, totalTrades: input.trades.length, wins, losses, winRate: input.trades.length > 0 ? (wins / input.trades.length * 100).toFixed(1) + '%' : '0%' },
        }
      },
    }),
  }
}
