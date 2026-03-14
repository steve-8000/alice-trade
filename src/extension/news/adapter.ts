/**
 * News AI Tools
 *
 * newsGetCompany: 个股新闻，用于事件驱动和异动归因。
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { NewsClientLike } from '@/openbb/sdk/types'

export function createNewsTools(
  newsClient: NewsClientLike,
  providers: { companyProvider: string },
) {
  return {
    newsGetCompany: tool({
      description: `Get news for a specific company.

Returns recent news articles related to the given stock symbol.
Essential for understanding price movements, earnings reactions, and corporate events.

If unsure about the symbol, use marketSearchForResearch to find it.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker symbol, e.g. "AAPL", "TSLA"'),
        limit: z.number().int().positive().optional().describe('Number of articles to return (default: 20)'),
      }),
      execute: async ({ symbol, limit }) => {
        const params: Record<string, unknown> = { symbol, provider: providers.companyProvider }
        if (limit) params.limit = limit
        return await newsClient.getCompanyNews(params)
      },
    }),
  }
}
