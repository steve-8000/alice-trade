/**
 * Unified API client — re-exports domain modules as the `api` namespace.
 * Existing imports like `import { api } from '../api'` continue to work.
 */
import { chatApi } from './chat'
import { configApi } from './config'
import { eventsApi } from './events'
import { cronApi } from './cron'
import { heartbeatApi } from './heartbeat'
import { tradingApi } from './trading'
import { openbbApi } from './openbb'
import { devApi } from './dev'
import { toolsApi } from './tools'
import { channelsApi } from './channels'
export const api = {
  chat: chatApi,
  config: configApi,
  events: eventsApi,
  cron: cronApi,
  heartbeat: heartbeatApi,
  trading: tradingApi,
  openbb: openbbApi,
  dev: devApi,
  tools: toolsApi,
  channels: channelsApi,
}

// Re-export all types for convenience
export type {
  WebChannel,
  VercelAiSdkOverride,
  ChatMessage,
  ChatResponse,
  ToolCall,
  StreamingToolCall,
  ChatHistoryItem,
  AppConfig,
  AIProviderConfig,
  EventLogEntry,
  CronSchedule,
  CronJobState,
  CronJob,
  TradingAccount,
  AccountInfo,
  Position,
  WalletCommitLog,
  ReconnectResult,
  ConnectorsConfig,
  NewsCollectorConfig,
  NewsCollectorFeed,
} from './types'
export type { EventQueryResult } from './events'
