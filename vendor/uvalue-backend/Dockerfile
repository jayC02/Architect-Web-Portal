FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production
EXPOSE 8787
CMD ["node", "backend/server.mjs"]
