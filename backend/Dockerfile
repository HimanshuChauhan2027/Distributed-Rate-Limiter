FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY redis/scripts /app/redis/scripts

EXPOSE 8080
CMD ["node", "src/app.js"]
