# sseKify 用户连接数统计功能使用指南

## 概述

sseKify 现在支持获取同一个 userId 的连接数量，包括以下新功能：

- 获取指定用户的连接数量
- 获取指定用户的所有连接ID
- 获取所有用户的连接统计信息
- 检查用户是否在线

## 新增方法

### 1. `getUserConnectionCount(userId)`

获取指定用户的连接数量。

```javascript
const { SSEKify } = require('ssekify')
const sse = new SSEKify()

// 获取用户 'alice' 的连接数
const count = sse.getUserConnectionCount('alice')
console.log(`用户 alice 的连接数: ${count}`)
```

**参数:**
- `userId` (string): 用户ID

**返回值:**
- `number`: 该用户的连接数量，如果用户不存在或ID无效则返回 0

### 2. `getUserConnectionIds(userId)`

获取指定用户的所有连接ID。

```javascript
// 获取用户的所有连接ID
const connectionIds = sse.getUserConnectionIds('alice')
console.log(`用户 alice 的连接ID: [${connectionIds.join(', ')}]`)
```

**参数:**
- `userId` (string): 用户ID

**返回值:**
- `string[]`: 该用户的所有连接ID数组

### 3. `getAllUsersConnectionStats()`

获取所有用户的连接统计信息。

```javascript
// 获取所有用户的连接统计
const allStats = sse.getAllUsersConnectionStats()
console.log('所有用户连接统计:', allStats)
// 输出示例: { "alice": 2, "bob": 1, "charlie": 3 }
```

**返回值:**
- `Object.<string, number>`: 用户ID到连接数的映射对象

### 4. `isUserOnline(userId)`

检查用户是否在线（有至少一个连接）。

```javascript
// 检查用户是否在线
const isOnline = sse.isUserOnline('alice')
console.log(`用户 alice 是否在线: ${isOnline}`)
```

**参数:**
- `userId` (string): 用户ID

**返回值:**
- `boolean`: 用户是否在线

## 实际应用示例

### 示例 1: 消息发送前检查用户状态

```javascript
function sendMessageToUser(userId, message) {
    const connectionCount = sse.getUserConnectionCount(userId)

    if (connectionCount === 0) {
        console.log(`用户 ${userId} 不在线，无法发送消息`)
        return false
    }

    const sentCount = sse.sendToUser(userId, {
        type: 'message',
        content: message,
        timestamp: new Date().toISOString()
    })

    console.log(`消息已发送给用户 ${userId}，送达 ${sentCount} 个连接`)
    return true
}
```

### 示例 2: 实时连接监控

```javascript
// 监听连接事件
sse.on('connect', ({ userId, connId }) => {
    const count = sse.getUserConnectionCount(userId)
    const connectionIds = sse.getUserConnectionIds(userId)

    console.log(`用户 ${userId} 新建连接:`)
    console.log(`  连接ID: ${connId}`)
    console.log(`  总连接数: ${count}`)
    console.log(`  所有连接: [${connectionIds.join(', ')}]`)
})

// 监听断开事件
sse.on('disconnect', ({ userId, connId }) => {
    const count = sse.getUserConnectionCount(userId)

    console.log(`用户 ${userId} 断开连接:`)
    console.log(`  断开连接ID: ${connId}`)
    console.log(`  剩余连接数: ${count}`)
    console.log(`  是否仍在线: ${sse.isUserOnline(userId)}`)
})
```

### 示例 3: HTTP API 接口

```javascript
const express = require('express')
const app = express()

// 获取用户连接数 API
app.get('/api/user/:userId/connections', (req, res) => {
    const userId = req.params.userId

    res.json({
        userId,
        connectionCount: sse.getUserConnectionCount(userId),
        connectionIds: sse.getUserConnectionIds(userId),
        isOnline: sse.isUserOnline(userId),
        timestamp: new Date().toISOString()
    })
})

// 获取所有用户统计 API
app.get('/api/stats', (req, res) => {
    const userStats = sse.getAllUsersConnectionStats()
    const globalStats = sse.stats()

    res.json({
        global: {
            totalConnections: globalStats.connections,
            totalUsers: globalStats.users
        },
        users: userStats,
        onlineUsers: Object.keys(userStats),
        timestamp: new Date().toISOString()
    })
})
```

### 示例 4: 连接限制控制

```javascript
const MAX_CONNECTIONS_PER_USER = 5

// 注册连接时检查限制
app.get('/sse/:userId', (req, res) => {
    const userId = req.params.userId
    const currentCount = sse.getUserConnectionCount(userId)

    if (currentCount >= MAX_CONNECTIONS_PER_USER) {
        res.status(429).json({
            error: '用户连接数超出限制',
            currentConnections: currentCount,
            maxConnections: MAX_CONNECTIONS_PER_USER
        })
        return
    }

    // 建立连接
    const { connId } = sse.registerConnection(userId, res)
    console.log(`用户 ${userId) 建立连接，当前连接数: ${sse.getUserConnectionCount(userId)}`)
})
```

## 性能特点

1. **实时更新**: 连接数量随着连接建立和断开实时更新
2. **内存高效**: 基于内部 Map 数据结构，查询时间复杂度为 O(1)
3. **线程安全**: 所有操作都是同步的，无需担心并发问题
4. **零配置**: 新方法开箱即用，无需额外配置

## 注意事项

1. **用户ID验证**: 传入无效的 userId（null、undefined、空字符串）会返回 0 或空数组
2. **连接清理**: 当用户的所有连接都断开时，该用户会从内部统计中移除
3. **内存占用**: 每个连接会占用少量内存来存储连接信息
4. **跨实例**: 这些统计信息是单实例的，如果需要跨实例统计需要额外实现

## 运行示例

启动演示服务器：

```bash
cd D:\Project\sseKify
node examples/user-connection-stats.js
```

然后可以测试：

```bash
# 建立连接
curl http://localhost:3000/sse/alice
curl http://localhost:3000/sse/alice  # 同一用户的第二个连接

# 查询连接数
curl http://localhost:3000/api/user/alice/connections/count

# 查询全局统计
curl http://localhost:3000/api/users/connections/stats

# 发送消息
curl -X POST -H "Content-Type: application/json" \
     -d '{"message":"Hello!"}' \
     http://localhost:3000/api/user/alice/message
```

现在你可以轻松地在 sseKify 项目中获取任何用户的实时连接数量了！
