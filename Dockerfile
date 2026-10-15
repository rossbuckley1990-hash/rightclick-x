# Runs anywhere containers run: Fly, Cloud Run, ECS, Kubernetes, a laptop.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY bin ./bin
COPY demo ./demo
ENV RCX_STATE_FILE=/data/state.json RCX_WORKSPACE=/data/workspace PORT=8787
VOLUME /data
EXPOSE 8787
# Binds 0.0.0.0, so a token is required; one is generated and printed if RCX_TOKEN is unset.
CMD ["node", "bin/rcx.ts", "serve", "--host", "0.0.0.0"]
