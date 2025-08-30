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

    return {
        publish: (channel, message) => pub.publish(channel, message),
        subscribe: async (channel) => { await sub.subscribe(channel) },
        on: (event, cb) => {
            if (event === 'message') msgListeners.push(cb)
            else if (event === 'error') errListeners.push(cb)
        },
        close: async () => {
            try { await pub.quit() } catch {}
            try { await sub.quit() } catch {}
        },
    }
}

module.exports = { createIORedisAdapter }