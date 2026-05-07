# Build context = repo root (for packages/shared-types).
# See cloudbuild.yaml step "build-frontend".
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY frontend ./frontend
RUN npm install --workspaces --include-workspace-root
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm --workspace frontend run build

FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
# Cloud Run requires the container to listen on $PORT (default 8080). The
# nginx.conf is templated below to read $PORT at startup via envsubst.
CMD ["sh", "-c", "envsubst '$$PORT' < /etc/nginx/conf.d/default.conf > /tmp/default.conf && mv /tmp/default.conf /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
