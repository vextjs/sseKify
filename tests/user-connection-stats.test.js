// 测试脚本：验证用户连接数统计功能
const { SSEKify } = require('../lib/index.js')
const http = require('http')

console.log('🧪 开始测试 sseKify 用户连接数统计功能\n')

// 创建 SSE 实例
const sse = new SSEKify()

// 模拟 HTTP 响应对象
function createMockResponse() {
    const EventEmitter = require('events')
    const res = new EventEmitter()
    res.write = () => true
    res.end = () => {}
    res.setHeader = () => {}
    res.headersSent = false
    res.flush = () => {}
    return res
}

async function runTests() {
    console.log('1️⃣ 测试初始状态')
    console.log(`   总连接数: ${sse.stats().connections}`)
    console.log(`   总用户数: ${sse.stats().users}`)
    console.log(`   用户 alice 连接数: ${sse.getUserConnectionCount('alice')}`)
    console.log(`   用户 alice 是否在线: ${sse.isUserOnline('alice')}`)
    console.log(`   所有用户统计: ${JSON.stringify(sse.getAllUsersConnectionStats())}`)

    console.log('\n2️⃣ 为用户 alice 创建第一个连接')
    const res1 = createMockResponse()
    const conn1 = sse.registerConnection('alice', res1)
    console.log(`   连接ID: ${conn1.connId}`)
    console.log(`   alice 连接数: ${sse.getUserConnectionCount('alice')}`)
    console.log(`   alice 连接IDs: [${sse.getUserConnectionIds('alice').join(', ')}]`)
    console.log(`   alice 是否在线: ${sse.isUserOnline('alice')}`)
    console.log(`   总连接数: ${sse.stats().connections}`)
    console.log(`   总用户数: ${sse.stats().users}`)

    console.log('\n3️⃣ 为用户 alice 创建第二个连接')
    const res2 = createMockResponse()
    const conn2 = sse.registerConnection('alice', res2)
    console.log(`   连接ID: ${conn2.connId}`)
    console.log(`   alice 连接数: ${sse.getUserConnectionCount('alice')}`)
    console.log(`   alice 连接IDs: [${sse.getUserConnectionIds('alice').join(', ')}]`)
    console.log(`   总连接数: ${sse.stats().connections}`)

    console.log('\n4️⃣ 为用户 bob 创建连接')
    const res3 = createMockResponse()
    const conn3 = sse.registerConnection('bob', res3)
    console.log(`   连接ID: ${conn3.connId}`)
    console.log(`   bob 连接数: ${sse.getUserConnectionCount('bob')}`)
    console.log(`   bob 是否在线: ${sse.isUserOnline('bob')}`)
    console.log(`   总连接数: ${sse.stats().connections}`)
    console.log(`   总用户数: ${sse.stats().users}`)

    console.log('\n5️⃣ 查看所有用户统计')
    const allStats = sse.getAllUsersConnectionStats()
    console.log(`   所有用户统计: ${JSON.stringify(allStats)}`)
    for (const [userId, count] of Object.entries(allStats)) {
        const connectionIds = sse.getUserConnectionIds(userId)
        console.log(`     ${userId}: ${count} 个连接, IDs: [${connectionIds.join(', ')}]`)
    }

    console.log('\n6️⃣ 测试消息发送')
    const sentToAlice = sse.sendToUser('alice', { message: 'Hello Alice!' })
    const sentToBob = sse.sendToUser('bob', { message: 'Hello Bob!' })
    const sentToCharlie = sse.sendToUser('charlie', { message: 'Hello Charlie!' }) // 用户不在线
    console.log(`   发送给 alice: ${sentToAlice} 个连接`)
    console.log(`   发送给 bob: ${sentToBob} 个连接`)
    console.log(`   发送给 charlie (离线): ${sentToCharlie} 个连接`)

    console.log('\n7️⃣ 关闭 alice 的第一个连接')
    conn1.close()

    // 等待一下让断开事件处理完成
    await new Promise(resolve => setTimeout(resolve, 100))

    console.log(`   alice 剩余连接数: ${sse.getUserConnectionCount('alice')}`)
    console.log(`   alice 剩余连接IDs: [${sse.getUserConnectionIds('alice').join(', ')}]`)
    console.log(`   alice 是否在线: ${sse.isUserOnline('alice')}`)
    console.log(`   总连接数: ${sse.stats().connections}`)

    console.log('\n8️⃣ 关闭 alice 的第二个连接')
    conn2.close()

    await new Promise(resolve => setTimeout(resolve, 100))

    console.log(`   alice 连接数: ${sse.getUserConnectionCount('alice')}`)
    console.log(`   alice 是否在线: ${sse.isUserOnline('alice')}`)
    console.log(`   总连接数: ${sse.stats().connections}`)
    console.log(`   总用户数: ${sse.stats().users}`)

    console.log('\n9️⃣ 关闭 bob 的连接')
    conn3.close()

    await new Promise(resolve => setTimeout(resolve, 100))

    console.log(`   bob 连接数: ${sse.getUserConnectionCount('bob')}`)
    console.log(`   bob 是否在线: ${sse.isUserOnline('bob')}`)
    console.log(`   总连接数: ${sse.stats().connections}`)
    console.log(`   总用户数: ${sse.stats().users}`)
    console.log(`   所有用户统计: ${JSON.stringify(sse.getAllUsersConnectionStats())}`)

    console.log('\n🔟 测试边界情况')
    console.log(`   获取不存在用户连接数: ${sse.getUserConnectionCount('nonexistent')}`)
    console.log(`   获取空用户ID连接数: ${sse.getUserConnectionCount('')}`)
    console.log(`   获取null用户ID连接数: ${sse.getUserConnectionCount(null)}`)
    console.log(`   获取不存在用户连接IDs: [${sse.getUserConnectionIds('nonexistent').join(', ')}]`)

    console.log('\n✅ 所有测试完成！')

    // 最终统计
    const finalStats = sse.stats()
    console.log('\n📊 最终统计:')
    console.log(`   总连接数: ${finalStats.connections}`)
    console.log(`   总用户数: ${finalStats.users}`)
    console.log(`   发送消息数: ${finalStats.sent}`)
}

// 添加事件监听器来查看连接和断开事件
sse.on('connect', ({ userId, connId }) => {
    console.log(`   🔗 连接事件: 用户 ${userId}, 连接 ${connId}`)
})

sse.on('disconnect', ({ userId, connId }) => {
    console.log(`   💔 断开事件: 用户 ${userId}, 连接 ${connId}`)
})

// 运行测试
runTests().catch(console.error)
