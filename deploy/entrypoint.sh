#!/bin/sh
set -eu
umask 077
if [ "$HOSTED_ROLE" = api ]; then
  node --experimental-transform-types /app/apps/server/src/hosted-config.ts
fi
mkdir -p /data/private
exec "$@"
