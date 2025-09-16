// ioredis 适配器：传入一个 Redis URL 即可启用跨实例广播。
// REDIS_URL 示例：redis://:password@host:6379/0

const IORedis = require('ioredis')

/**
 * @param {string} [url]
 * @returns {{ publish:(channel:string,message:string)=>Promise<number>|number, subscribe:(channel:string)=>Promise<void>|void, on:(event:'message'|'error', cb:Function)=>void, close?:()=>Promise<void>|void }}
 */
function createIORedisAdapter(url) {
    const pub = new IORedis(url)
    const sub = new IORedis(url)
    // 独立 KV 连接：SUBSCRIBE 模式下无法执行普通命令
    let kv
    try {
        kv = new IORedis(url)
    } catch (_) {
        kv = undefined
    }

    /** @type {Array<(ch:string, msg:string)=>void>} */
    const msgListeners = []
    /** @type {Array<(e:any)=>void>} */
    const errListeners = []

    sub.on('message', (ch, msg) => {
        for (const l of msgListeners) l(ch, msg)
    })

    const onError = (e) => { for (const l of errListeners) { try { l(e) } catch {} } }
    pub.on('error', onError)
    sub.on('error', onError)
    kv?.on('error', onError)

    const adapter = {
        publish: (channel, message) => pub.publish(channel, message),
        subscribe: async (channel) => { await sub.subscribe(channel) },
        on: (event, cb) => {
            if (event === 'message') msgListeners.push(cb)
            else if (event === 'error') errListeners.push(cb)
        },
        close: async () => {
            try { await pub.quit() } catch {}
            try { await sub.quit() } catch {}
            try { await kv?.quit?.() } catch {}
        },
    }

    // 可选 KV 能力暴露（若存在）
    if (kv) {
        adapter.incr = (key) => kv.incr(key)
        adapter.expire = (key, seconds) => kv.expire(key, seconds)
        adapter.pexpire = (key, ms) => kv.pexpire(key, ms)
        adapter.kv = { incr: adapter.incr, expire: adapter.expire, pexpire: adapter.pexpire }
    }

    return adapter
}

module.exports = { createIORedisAdapter }
