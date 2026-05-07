FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY api-service ./api-service

EXPOSE 4000

CMD ["node", "api-service/server.js"]
