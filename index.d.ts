import { ServerResponse } from 'http'
import { EventEmitter } from 'events'

export type ConnectionId = string
export type UserId = string

export interface SendOptions {
  event?: string
  id?: string
}

export interface RegisterOptions {
  rooms?: string[]
  headers?: Record<string, string>
  keepAliveMs?: number
  retryMs?: number
  maxQueueItems?: number // 每连接最大排队条数（默认 100）
  maxQueueBytes?: number // 每连接最大排队字节数（默认 262144 = 256KiB）
  dropPolicy?: 'oldest' | 'newest' | 'disconnect' // 超限策略（默认 'oldest'）
}

export interface Envelope {
  type: 'all' | 'user' | 'room'
  target?: string
  data: any
  event?: string
  id?: string
  at: number
  origin?: string
}

export interface RedisLike {
  publish(channel: string, message: string): Promise<number> | number
  subscribe(channel: string): Promise<void> | void
  on(event: 'message' | 'error', cb: any): void
  close?(): Promise<void> | void
  // Optional KV capabilities for seq (if provided, sseKify will auto-inherit)
  incr?(key: string): Promise<number>
  expire?(key: string, seconds: number): Promise<number>
  pexpire?(key: string, ms: number): Promise<number>
  kv?: { incr: (k: string) => Promise<number>; expire: (k: string, s: number) => Promise<number>; pexpire: (k: string, ms: number) => Promise<number> }
}

export interface AutoFieldsOptions {
  timestamp?: 'iso' | 'epochMs' | false
  traceId?: { mode: 'off' | 'ifMissing'; getter?: () => string; fieldName?: string }
  requestId?: { mode: 'off' | 'ifMissing' | 'require'; getter?: () => string; fieldName?: string }
}

export interface SeqOptions {
  keyExtractor?: (d: any) => string | undefined
  startAt?: 0 | 1
  finalPredicate?: (d: any) => boolean
  fieldName?: string
  frameIdPolicy?: 'none' | 'timestamp' | 'snowflake' | ((d: any, nextSeq: number) => string)
  // KV store for global monotonic seq; if omitted, sseKify will try to inherit from top-level redis adapter
  redis?: { incr: (k: string) => Promise<number>; expire?: (k: string, s: number) => Promise<number> } | null
  redisKeyPrefix?: string
  redisTTLSeconds?: number
}

export interface SSEKifyOptions {
  // You can pass a Redis-like adapter instance or a Redis URL string
  redis?: RedisLike | string
  channel?: string
  keepAliveMs?: number
  retryMs?: number
  recentBufferSize?: number
  serializer?: (data: any) => string
  maxPayloadBytes?: number
  recentTTLMs?: number
  recentMaxUsers?: number

  // New: automatic field injection and seq
  autoFields?: AutoFieldsOptions
  enableSeq?: boolean
  seq?: SeqOptions
}

export interface RegisteredConnectionHandle {
  connId: string
  close(): void
  join(room: string): boolean
  leave(room: string): boolean
}

export declare class SSEKify extends EventEmitter {
  stopAccepting(): void
  shutdown(opts?: { announce?: boolean; event?: string; graceMs?: number }): Promise<void>
  stats(): {
    connections: number
    users: number
    rooms: number
    sent: number
    droppedOldest: number
    droppedNewest: number
    disconnectedByBackpressure: number
    queueItemsMax: number
    queueBytesMax: number
    errorCount: number
    // New metrics (since vX.Y.Z):
    seqIncrsLocal: number
    seqIncrsRedis: number
    lastSeqKvFallbackAt: number
  }
  clearRecent(userId?: UserId): void
  constructor(opts?: SSEKifyOptions)

  registerConnection(userId: UserId, res: ServerResponse, options?: RegisterOptions): RegisteredConnectionHandle

  sendToUser(userId: UserId, data: any, opts?: SendOptions): number
  sendToAll(data: any, opts?: SendOptions): number
  sendToRoom(room: string, data: any, opts?: SendOptions): number

  publish(data: any, userId?: UserId, opts?: SendOptions): Promise<void>
  publishToRoom(room: string, data: any, opts?: SendOptions): Promise<void>

  close(userId?: UserId): void
}

// Optional dependency at install time; the function always exists but may throw if ioredis is not installed.
export declare function createIORedisAdapter(url: string): RedisLike

declare const _default: {
  SSEKify: typeof SSEKify
  createIORedisAdapter: typeof createIORedisAdapter
}
export default _default
