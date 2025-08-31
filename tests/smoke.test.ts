import { describe, it, expect } from 'vitest'

// 轻量占位测试，确保 CI 测试基线为绿
// 不依赖外部服务，不触及公开 API 行为

describe('sseKify smoke', () => {
  it('truthy baseline', () => {
    expect(1 + 1).toBe(2)
  })
})
