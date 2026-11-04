# Linux test environment: a clean Debian with Node 24 and bubblewrap (RightClick X's Linux sandbox).
#   docker build -f ci/linux.Dockerfile -t rightclick-x-linux-test .
#   docker run --rm --privileged -e RCX_EXPECT_SANDBOX=1 rightclick-x-linux-test   # as linux-bubblewrap: a missing sandbox fails
#   docker run --rm rightclick-x-linux-test                                        # as linux-no-sandbox: confinement tests skip
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap procps man-db bsdextrautils git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m tester
WORKDIR /app
COPY --chown=tester:tester package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=tester:tester . .
USER tester
CMD ["npm", "test"]
