FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY services ./services
COPY shared ./shared

ENV NODE_ENV=production

CMD ["node", "server.js"]
