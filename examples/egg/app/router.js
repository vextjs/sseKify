module.exports = app => {
  const { router, controller } = app
  router.get('/', controller.sse.index)
  router.get('/sse', controller.sse.stream)
  router.post('/notify/:userId', controller.sse.notify)
  router.post('/broadcast', controller.sse.broadcast)
  router.post('/room/:room', controller.sse.room)
  router.post('/publish-room/:room', controller.sse.publishRoom)
  router.post('/close/:userId', controller.sse.close)
  // 健康检查
  router.get('/health', controller.sse.health)
}
