// ioredis 适配器：传入一个 Redis URL 即可启用跨实例广播。
// REDIS_URL 示例：redis://:password@host:6379/0

const IORedis = require('ioredis')

/**
 * @param {string} [url]
 * @returns {import('./ssekit').RedisLike}
 */
function createIORedisAdapter(url) {
    const pub = new IORedis(url)
    const sub = new IORedis(url)

    /** @type {Array<(ch:string, msg:string)=>void>} */
    const listeners = []

    sub.on('message', (ch, msg) => {
        for (const l of listeners) l(ch, msg)
    })

    return {
        publish: (channel, message) => pub.publish(channel, message),
        subscribe: async (channel) => { await sub.subscribe(channel) },
        on: (event, cb) => { if (event === 'message') listeners.push(cb) },
    }
}

module.exports = { createIORedisAdapter }