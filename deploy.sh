#!/bin/bash
# Lalia production deploy. Publishes origin/main to the live app
# (lalia.cloud, backend port 3101). share.jarmetals.com is only a redirect.
exec "$(cd "$(dirname "$0")" && pwd)/deploy-staging.sh" "$@"
