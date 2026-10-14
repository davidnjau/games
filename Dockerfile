# ── Build stage: each game builds its own single-file dist/index.html ──
FROM node:20-alpine AS build
WORKDIR /app

COPY kanjo-escape ./kanjo-escape
RUN npm --prefix kanjo-escape ci && npm --prefix kanjo-escape run build

COPY matatu-rush ./matatu-rush
RUN npm --prefix matatu-rush ci && npm --prefix matatu-rush run build

# ── Runtime stage: just the root server + each game's build output ──
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

# Matatu Rush's relay (server/relay.ts) imports its game rules straight
# from TypeScript source via tsx, so that source has to ship too — not
# just its dist/index.html.
COPY matatu-rush/src ./matatu-rush/src
COPY matatu-rush/server ./matatu-rush/server
COPY --from=build /app/matatu-rush/dist ./matatu-rush/dist
COPY --from=build /app/kanjo-escape/dist ./kanjo-escape/dist

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
CMD ["npm", "start"]
