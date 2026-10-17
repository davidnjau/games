# ── Build stage: each game builds its own single-file dist/index.html ──
FROM node:20-alpine AS build
WORKDIR /app

COPY kanjo-escape ./kanjo-escape
RUN npm --prefix kanjo-escape ci && npm --prefix kanjo-escape run build

COPY matatu-rush ./matatu-rush
RUN npm --prefix matatu-rush ci && npm --prefix matatu-rush run build

COPY choma-tycoon ./choma-tycoon
RUN npm --prefix choma-tycoon ci && npm --prefix choma-tycoon run build

COPY shillings-stages ./shillings-stages
RUN npm --prefix shillings-stages ci && npm --prefix shillings-stages run build

# ── Runtime stage: just the root server + each game's build output ──
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

# Kanjo Escape's, Matatu Rush's and Shillings & Stages's relays
# (server/relay.ts) import their game rules straight from TypeScript
# source via tsx, so that source has to ship too — not just their
# dist/index.html.
COPY kanjo-escape/src ./kanjo-escape/src
COPY kanjo-escape/server ./kanjo-escape/server
COPY --from=build /app/kanjo-escape/dist ./kanjo-escape/dist
COPY matatu-rush/src ./matatu-rush/src
COPY matatu-rush/server ./matatu-rush/server
COPY --from=build /app/matatu-rush/dist ./matatu-rush/dist
COPY shillings-stages/src ./shillings-stages/src
COPY shillings-stages/server ./shillings-stages/server
COPY --from=build /app/shillings-stages/dist ./shillings-stages/dist
COPY --from=build /app/choma-tycoon/dist ./choma-tycoon/dist

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
CMD ["npm", "start"]
