# 适用于示例服务（Express/Koa/Fastify/Hapi 任一）
# 使用：
#   docker build -t ssekit-demo \
#     --build-arg EXAMPLE_PATH=examples/express/index.js .
#   docker run -p 3000:3000 -e PORT=3000 ssekit-demo
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
# 仅安装示例所需依赖（使用 devDependencies）
RUN npm i --only=development --legacy-peer-deps || npm i --legacy-peer-deps
COPY . .
ARG EXAMPLE_PATH=examples/express/index.js
ENV EXAMPLE_PATH=${EXAMPLE_PATH}
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "node $EXAMPLE_PATH"]
