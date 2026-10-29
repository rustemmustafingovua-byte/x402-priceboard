FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY src ./src
COPY data ./data
COPY README.md LICENSE ./

# Featured listings persist here. Mount a volume at /data so a redeploy keeps them.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV PORT=8080
ENV FEATURED_PATH=/data/featured.json
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
