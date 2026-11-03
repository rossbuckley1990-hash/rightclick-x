# Runs anywhere containers run: Fly, Cloud Run, ECS, Kubernetes, a laptop.
# Never root: the runtime holds operator credentials, so it gets an unprivileged uid.
FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node bin ./bin
COPY --chown=node:node demo ./demo
ENV RCX_STATE_FILE=/data/state.json RCX_WORKSPACE=/data/workspace PORT=8787
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node
EXPOSE 8787
# Binds 0.0.0.0, so a token is required; one is generated and printed if RCX_TOKEN is unset.
CMD ["node", "bin/rcx.ts", "serve", "--host", "0.0.0.0"]
