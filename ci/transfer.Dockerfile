# Stage 6 transfer environment: the Linux test image plus the Debian packages that provide the
# holdout programs' names (decided before the transfer ran; EVALUATION-PLAN.md section 10).
FROM rightclick-x-linux-test
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends sharutils pcre2-utils libjson-xs-perl xz-utils libimage-exiftool-perl autoconf perl \
 && rm -rf /var/lib/apt/lists/*
USER tester
