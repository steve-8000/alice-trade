import { useState, useEffect, useRef, useCallback } from 'react'

export interface WSMessage {
  type: 'ai-stream' | 'ai-done' | 'ai-error' | 'ai-start'
  channelId?: string
  event?: unknown
  text?: string
  error?: string
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const [aiWorking, setAiWorking] = useState(false)
  const [lastTool, setLastTool] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ text: string; channelId: string } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef<Set<(msg: WSMessage) => void>>(new Set())

  useEffect(() => {
    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      if (disposed) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/api/ws`)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WSMessage
          // Track AI working state
          if (msg.type === 'ai-start') { setAiWorking(true); setLastTool(null) }
          if (msg.type === 'ai-stream') {
            setAiWorking(true)
            const ev = msg.event as { type?: string; name?: string } | undefined
            if (ev?.type === 'tool_use' && ev.name) setLastTool(ev.name)
            if (ev?.type === 'text') setLastTool(null)
          }
          if (msg.type === 'ai-done') {
            setAiWorking(false); setLastTool(null)
            setLastResult({ text: msg.text || '', channelId: msg.channelId || 'default' })
          }
          if (msg.type === 'ai-error') { setAiWorking(false); setLastTool(null) }
          // Notify all listeners
          for (const fn of listenersRef.current) fn(msg)
        } catch { /* ignore parse errors */ }
      }
    }

    connect()
    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [])

  const addListener = useCallback((fn: (msg: WSMessage) => void) => {
    listenersRef.current.add(fn)
    return () => { listenersRef.current.delete(fn) }
  }, [])

  const clearLastResult = useCallback(() => setLastResult(null), [])

  return { connected, aiWorking, lastTool, lastResult, clearLastResult, addListener }
}
