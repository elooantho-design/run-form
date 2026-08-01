#!/usr/bin/env bash
set -euo pipefail

echo "== Portal translator containers =="
docker ps --filter "name=portal-libretranslate" --filter "name=portal-translator-gateway" \
  --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo
echo "== Docker stats =="
docker stats --no-stream portal-libretranslate portal-translator-gateway 2>/dev/null || true

echo
echo "== Restart policy and limits =="
for container in portal-libretranslate portal-translator-gateway; do
  if docker inspect "$container" >/dev/null 2>&1; then
    docker inspect "$container" \
      --format "{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} cpus={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}} memoryReservation={{.HostConfig.MemoryReservation}} pidsLimit={{.HostConfig.PidsLimit}}"
  fi
done

echo
echo "== Health logs tail, no secrets =="
docker logs --tail 50 portal-translator-gateway 2>/dev/null | sed -E 's/(signature|secret|token|key)=([^ ]+)/\1=***MASKED***/gi' || true
