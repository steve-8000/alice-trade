FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/opentypebb/package.json packages/opentypebb/
COPY ui/package.json ui/
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM deps AS build
COPY . .
RUN pnpm build

# ---- Runtime ----
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/opentypebb ./packages/opentypebb
COPY --from=build /app/package.json ./
COPY --from=build /app/data/default ./data/default

ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "dist/main.js"]
