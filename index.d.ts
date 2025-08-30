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
