# Build context = repo root (so we can copy packages/shared-types).
# See cloudbuild.yaml step "build-api".
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY api ./api
RUN npm install --workspaces --include-workspace-root
RUN npm --workspace api run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/package-lock.json* ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/api/package.json ./api/package.json
COPY --from=build /repo/api/dist ./api/dist
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 8082
CMD ["node", "api/dist/index.js"]
