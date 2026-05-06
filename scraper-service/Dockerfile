FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npx playwright install chromium

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
