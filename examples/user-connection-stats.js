// 用户连接数统计功能演示
const express = require('express')
const { SSEKify } = require('../lib/index.js')

const app = express()
const sse = new SSEKify()

// 中间件
app.use(express.json())

// SSE 连接端点
app.get('/sse/:userId', (req, res) => {
    const userId = req.params.userId

    // 连接前显示当前连接数
    const beforeCount = sse.getUserConnectionCount(userId)
    console.log(`📊 用户 ${userId} 连接前: ${beforeCount} 个连接`)

    const { connId } = sse.registerConnection(userId, res, {
        rooms: ['global']
    })

    // 连接后显示新的连接数和连接ID
    const afterCount = sse.getUserConnectionCount(userId)
    const connectionIds = sse.getUserConnectionIds(userId)

    console.log(`✅ 用户 ${userId} 连接成功`)
    console.log(`   连接ID: ${connId}`)
    console.log(`   连接后数量: ${afterCount}`)
    console.log(`   所有连接ID: [${connectionIds.join(', ')}]`)
    console.log(`   用户在线状态: ${sse.isUserOnline(userId)}`)
})

// 获取用户连接数 API
app.get('/api/user/:userId/connections/count', (req, res) => {
    const userId = req.params.userId
    const count = sse.getUserConnectionCount(userId)

    res.json({
        userId,
        connectionCount: count,
        isOnline: sse.isUserOnline(userId),
        timestamp: new Date().toISOString()
    })
})

// 获取用户连接详情 API
app.get('/api/user/:userId/connections/details', (req, res) => {
    const userId = req.params.userId
    const count = sse.getUserConnectionCount(userId)
    const connectionIds = sse.getUserConnectionIds(userId)

    res.json({
        userId,
        connectionCount: count,
        connectionIds,
        isOnline: sse.isUserOnline(userId),
        timestamp: new Date().toISOString()
    })
})

// 获取所有用户连接统计 API
app.get('/api/users/connections/stats', (req, res) => {
    const userStats = sse.getAllUsersConnectionStats()
    const globalStats = sse.stats()

    res.json({
        globalStats: {
            totalConnections: globalStats.connections,
            totalUsers: globalStats.users,
            totalRooms: globalStats.rooms
        },
        userStats,
        onlineUsers: Object.keys(userStats),
        timestamp: new Date().toISOString()
    })
})

// 发送消息给用户 API
app.post('/api/user/:userId/message', (req, res) => {
    const userId = req.params.userId
    const { message } = req.body

    const connectionCount = sse.getUserConnectionCount(userId)

    if (!sse.isUserOnline(userId)) {
        return res.status(404).json({
            error: '用户不在线',
            userId,
            connectionCount: 0
        })
    }

    const sentCount = sse.sendToUser(userId, {
        type: 'message',
        content: message,
        timestamp: new Date().toISOString()
    })

    res.json({
        success: true,
        userId,
        message,
        connectionCount,
        sentToConnections: sentCount
    })
})

// 批量发送消息给多个用户 API
app.post('/api/users/broadcast', (req, res) => {
    const { userIds, message } = req.body
    const results = []

    for (const userId of userIds) {
        const connectionCount = sse.getUserConnectionCount(userId)
        const isOnline = sse.isUserOnline(userId)

        let sentCount = 0
        if (isOnline) {
            sentCount = sse.sendToUser(userId, {
                type: 'broadcast',
                content: message,
                timestamp: new Date().toISOString()
            })
        }

        results.push({
            userId,
            connectionCount,
            isOnline,
            sentCount
        })
    }

    res.json({
        success: true,
        message,
        results,
        totalOnlineUsers: results.filter(r => r.isOnline).length
    })
})

// 监听连接事件
sse.on('connect', ({ userId, connId }) => {
    const count = sse.getUserConnectionCount(userId)
    const allStats = sse.getAllUsersConnectionStats()

    console.log(`🔗 用户连接事件:`)
    console.log(`   用户: ${userId}`)
    console.log(`   连接ID: ${connId}`)
    console.log(`   该用户连接数: ${count}`)
    console.log(`   全局在线用户: ${Object.keys(allStats).length}`)
})

// 监听断开事件
sse.on('disconnect', ({ userId, connId }) => {
    const count = sse.getUserConnectionCount(userId)
    const allStats = sse.getAllUsersConnectionStats()

    console.log(`💔 用户断开事件:`)
    console.log(`   用户: ${userId}`)
    console.log(`   连接ID: ${connId}`)
    console.log(`   剩余连接数: ${count}`)
    console.log(`   全局在线用户: ${Object.keys(allStats).length}`)
})

// 定期输出统计信息
setInterval(() => {
    const globalStats = sse.stats()
    const userStats = sse.getAllUsersConnectionStats()

    console.log('\n📈 实时统计报告:')
    console.log(`   总连接数: ${globalStats.connections}`)
    console.log(`   在线用户数: ${globalStats.users}`)
    console.log(`   房间数: ${globalStats.rooms}`)

    if (Object.keys(userStats).length > 0) {
        console.log('   用户连接详情:')
        for (const [userId, count] of Object.entries(userStats)) {
            const connectionIds = sse.getUserConnectionIds(userId)
            console.log(`     ${userId}: ${count} 个连接 [${connectionIds.join(', ')}]`)
        }
    } else {
        console.log('   当前无在线用户')
    }
    console.log('   ─────────────────────')
}, 15000) // 每15秒输出一次

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`🚀 sseKify 用户连接统计演示服务启动`)
    console.log(`   端口: ${PORT}`)
    console.log(`\n📖 API 使用说明:`)
    console.log(`   建立SSE连接:        GET  /sse/{userId}`)
    console.log(`   查询用户连接数:      GET  /api/user/{userId}/connections/count`)
    console.log(`   查询用户连接详情:    GET  /api/user/{userId}/connections/details`)
    console.log(`   查询全局统计:        GET  /api/users/connections/stats`)
    console.log(`   发送消息给用户:      POST /api/user/{userId}/message`)
    console.log(`   批量发送消息:        POST /api/users/broadcast`)
    console.log(`\n💡 测试示例:`)
    console.log(`   # 建立连接`)
    console.log(`   curl http://localhost:${PORT}/sse/alice`)
    console.log(`   curl http://localhost:${PORT}/sse/bob`)
    console.log(`   `)
    console.log(`   # 查询连接数`)
    console.log(`   curl http://localhost:${PORT}/api/user/alice/connections/count`)
    console.log(`   curl http://localhost:${PORT}/api/users/connections/stats`)
    console.log(`   `)
    console.log(`   # 发送消息`)
    console.log(`   curl -X POST -H "Content-Type: application/json" \\`)
    console.log(`        -d '{"message":"Hello Alice!"}' \\`)
    console.log(`        http://localhost:${PORT}/api/user/alice/message`)
    console.log(`   `)
    console.log(`   # 批量发送`)
    console.log(`   curl -X POST -H "Content-Type: application/json" \\`)
    console.log(`        -d '{"userIds":["alice","bob"],"message":"Hello everyone!"}' \\`)
    console.log(`        http://localhost:${PORT}/api/users/broadcast`)
})
