'use strict'

/**
 * Egg 最小配置示例：
 * - 设置默认端口（可被环境变量 PORT 覆盖）。
 * - 生产环境请根据需要配置安全、CORS、日志等。
 */
module.exports = appInfo => {
  const config = {}

  // 端口（以 EGG_SERVER_ENV=local 运行时，默认 3050）
  config.cluster = {
    listen: {
      port: Number(process.env.PORT || 3050),
      hostname: '127.0.0.1',
    },
  }

  // 示例环境下关闭 csrf（生产请按需配置）
  config.security = {
    csrf: { enable: false },
  }

  // 最小可用 CORS（示例/本地调试）：若需携带 cookie 请改为指定来源 + credentials
    config.cors = {
        origin: '*', // 或者 'http://localhost:3000'
        allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS',
    };

  return config
}
