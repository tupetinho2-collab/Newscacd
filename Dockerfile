
# Multi-stage build
FROM node:18-bullseye as builder
WORKDIR /app
COPY . .
RUN cd client && npm ci && npm run build
RUN cd server && npm ci

# Runtime
FROM node:18-bullseye
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app .
EXPOSE 4000
CMD ["node", "server/index.js"]
