#!/bin/sh
# Mounted volumes (Railway, Fly, Docker) arrive owned by root. Fix ownership of
# the data directory, then drop privileges to the unprivileged app user.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/data/rivalwatch.db}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R app:app "$DATA_DIR"
  exec su-exec app "$@"
fi
exec "$@"
