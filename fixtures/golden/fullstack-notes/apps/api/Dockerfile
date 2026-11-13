# The API: compiled in a first stage, run with production dependencies only. The build context is
# the project root (npm workspaces: one lockfile there).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --omit=dev
COPY --from=build /app/apps/api/dist apps/api/dist
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
