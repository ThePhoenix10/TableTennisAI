#!/usr/bin/env bash
# PongAI — provision and deploy. Idempotent; safe to re-run.
set -euo pipefail

RG=rgTableTennisAI
LOC=westus3                      # serverless GPU is available here
ACR=pongaiacr                    # must be globally unique
ENV=pongai-env
STORAGE=blobtabletennisai
SWA=lemon-hill-0a56e611e.5.azurestaticapps.net   # stTableTennisAI

# An immutable tag per build.
#
# Deploying `:latest` twice is a silent no-op: Container Apps compares the
# image STRING, not the digest, so `az containerapp update --image ...:latest`
# after a rebuild creates no revision and the old code keeps serving. A tag
# that changes every build makes the update real.
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)

echo "== 1. storage: containers, queue, table =="
CS=$(az storage account show-connection-string -n $STORAGE -g $RG -o tsv)
for c in uploads outputs demos; do
  az storage container create -n $c --connection-string "$CS" -o none
done
az storage queue create -n analysis-jobs --connection-string "$CS" -o none
az storage table create  -n jobs          --connection-string "$CS" -o none

# The browser PUTs directly to blob, so the blob service needs CORS.
az storage cors add --services b --methods PUT OPTIONS GET HEAD \
  --origins "http://localhost:3000" "https://$SWA" \
  --allowed-headers '*' --exposed-headers '*' --max-age 3600 \
  --connection-string "$CS"

# Raw uploads are the bulk of storage cost and users never clean up.
cat > /tmp/lifecycle.json <<'JSON'
{"rules":[{"enabled":true,"name":"expire-uploads","type":"Lifecycle",
  "definition":{"filters":{"blobTypes":["blockBlob"],"prefixMatch":["uploads/"]},
  "actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":7}}}}}]}
JSON
az storage account management-policy create --account-name $STORAGE -g $RG \
  --policy @/tmp/lifecycle.json -o none

echo "== 2. container registry =="
az acr create -n $ACR -g $RG --sku Basic --admin-enabled true -o none
az acr login -n $ACR

echo "== 3. container apps environment (WORKLOAD PROFILE, not consumption-only) =="
# Created with workload profiles even though nothing here needs one yet: the
# environment type cannot be changed later, and serverless GPU is unsupported
# on consumption-only environments. This costs nothing extra and leaves the
# door open.
az containerapp env create -n $ENV -g $RG -l $LOC \
  --enable-workload-profiles -o none

# To move the worker onto a T4 later: request GPU quota via a support case,
# then add the profile and pass --workload-profile-name gpu-t4 in step 6.
#
#   az containerapp env workload-profile add -n $ENV -g $RG \
#     --workload-profile-name gpu-t4 \
#     --workload-profile-type Consumption-GPU-NC8as-T4

echo "== 4. build images (server-side, in ACR) =="
# `az acr build`, not `docker build`. Two reasons:
#   arch  — Container Apps nodes are x86_64. A build on an Apple Silicon Mac
#           produces arm64 images that fail at startup with "exec format error".
#   size  — the worker image is GBs. This uploads a ~127 MB context and builds
#           in Azure instead of pushing the built image back up.
az acr build -r $ACR -t pongai-api:$TAG    -t pongai-api:latest    -f docker/api.Dockerfile        .
az acr build -r $ACR -t pongai-worker:$TAG -t pongai-worker:latest -f docker/worker.cpu.Dockerfile .

# The worker image is 4-6 GB. Without artifact streaming every cold start
# pulls the whole thing before the container runs.
az acr artifact-streaming update -n $ACR --repository pongai-worker --enable-streaming true || \
  echo "  (artifact streaming unavailable on this SKU — cold starts will be slower)"

echo "== 5. API: always warm, SSE holds connections for ~40 min =="
az containerapp create -n pongai-api -g $RG --environment $ENV \
  --image $ACR.azurecr.io/pongai-api:$TAG \
  --registry-server $ACR.azurecr.io \
  --target-port 8000 --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.5 --memory 1Gi \
  --env-vars AZURE_STORAGE_CONNECTION_STRING="$CS" \
             ALLOWED_ORIGINS="http://localhost:3000,https://$SWA" \
  -o none

echo "== 6. worker: CPU job, scales to zero =="
az containerapp job create -n pongai-worker -g $RG --environment $ENV \
  --image $ACR.azurecr.io/pongai-worker:$TAG \
  --registry-server $ACR.azurecr.io \
  --trigger-type Event \
  `# 3h: CPU runs ~14x realtime, so a 5-minute clip needs well over an hour.` \
  `# retry-limit 0: the worker deletes its queue message on failure and retry` \
  `# is explicit via POST /api/jobs/{id}/retry, so a platform retry would only` \
  `# start a replica that finds an empty queue.` \
  --replica-timeout 10800 --replica-retry-limit 0 \
  --parallelism 1 --replica-completion-count 1 \
  --min-executions 0 --max-executions 3 \
  --polling-interval 30 \
  --scale-rule-name queue --scale-rule-type azure-queue \
  --scale-rule-metadata queueName=analysis-jobs queueLength=1 \
  --scale-rule-auth connection=connection-string \
  --secrets connection-string="$CS" \
  --env-vars AZURE_STORAGE_CONNECTION_STRING=secretref:connection-string \
             REPLICA_TIMEOUT=10800 \
  --cpu 4 --memory 8Gi \
  -o none

echo
echo "API: https://$(az containerapp show -n pongai-api -g $RG --query properties.configuration.ingress.fqdn -o tsv)"
echo
echo "To redeploy after a code change, re-run this script. It retags by commit,"
echo "so the container actually rolls onto the new image."
echo
echo "Remaining:"
echo "  - raise the API ingress request timeout, or 40-minute SSE streams get cut"
echo "  - set NEXT_PUBLIC_API_URL on the Static Web App ($SWA) to the API URL above"
