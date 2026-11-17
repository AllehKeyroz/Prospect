# MODO DIAGNÓSTICO — sem banco.
#
# Esta imagem NÃO instala nem importa DuckDB, PostgreSQL ou qualquer módulo
# nativo. Ela sobe apenas Fastify + arquivos estáticos, para isolar se o
# travamento do servidor vem do banco/build nativo ou da plataforma.
#
# App completo: use o Dockerfile.full.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Apenas o necessário para o servidor de diagnóstico. Sem @duckdb, sem pg.
COPY package.minimal.json ./package.json
RUN npm install --include=dev --no-audit --no-fund
COPY tsconfig.minimal.json ./tsconfig.json
COPY src/config.ts ./src/config.ts
COPY src/api/server.minimal.ts ./src/api/server.minimal.ts
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/src/api/server.minimal.js"]
