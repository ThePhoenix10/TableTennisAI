#!/usr/bin/env bash
# PongAI — provision and deploy. Idempotent; safe to re-run.
set -euo pipefail

RG=rgTableTennisAI
LOC=westus3                      # serverless GPU is available here
ACR=pongaiacr                    # must be globally unique
ENV=pongai-env
STORAGE=blobtabletennisai

echo "== 1. storage: containers, queue, table =="
CS=$(az storage account show-connection-string -n $STORAGE -g $RG -o tsv)
for c in uploads outputs demos; do
  az storage container create -n $c --connection-string "$CS" -o none
done
az storage queue create -n analysis-jobs --connection-string "$CS" -o none
az storage table create  -n jobs          --connection-string "$CS" -o none

# The browser PUTs directly to blob, so the blob service needs CORS.
az storage cors add --services b --methods PUT OPTIONS GET HEAD \
  --origins "http://localhost:3000" "https://YOUR-APP.azurestaticapps.net" \
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
# Serverless GPU is unsupported on consumption-only environments and the type
# cannot be changed later.
az containerapp env create -n $ENV -g $RG -l $LOC \
  --enable-workload-profiles -o none

# Requires GPU quota, requested via a support case.
az containerapp env workload-profile add -n $ENV -g $RG \
  --workload-profile-name gpu-t4 \
  --workload-profile-type Consumption-GPU-NC8as-T4 -o none

echo "== 4. build images =="
docker build -f docker/api.Dockerfile    -t $ACR.azurecr.io/pongai-api:latest .
docker build -f docker/worker.Dockerfile -t $ACR.azurecr.io/pongai-worker:latest .
docker push $ACR.azurecr.io/pongai-api:latest
docker push $ACR.azurecr.io/pongai-worker:latest

# The worker image is 4-6 GB. Without artifact streaming every cold start
# pulls the whole thing before the container runs.
az acr artifact-streaming update -n $ACR --repository pongai-worker --enable-streaming true || \
  echo "  (artifact streaming unavailable on this SKU — cold starts will be slower)"

echo "== 5. API: always warm, SSE holds connections for ~40 min =="
az containerapp create -n pongai-api -g $RG --environment $ENV \
  --image $ACR.azurecr.io/pongai-api:latest \
  --registry-server $ACR.azurecr.io \
  --target-port 8000 --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.5 --memory 1Gi \
  --env-vars AZURE_STORAGE_CONNECTION_STRING="$CS" \
             ALLOWED_ORIGINS="https://YOUR-APP.azurestaticapps.net" \
  -o none

echo "== 6. worker: GPU job, scales to zero =="
az containerapp job create -n pongai-worker -g $RG --environment $ENV \
  --image $ACR.azurecr.io/pongai-worker:latest \
  --registry-server $ACR.azurecr.io \
  --workload-profile-name gpu-t4 \
  --trigger-type Event \
  --replica-timeout 3600 --replica-retry-limit 2 \
  --parallelism 1 --replica-completion-count 1 \
  --min-executions 0 --max-executions 3 \
  --polling-interval 30 \
  --scale-rule-name queue --scale-rule-type azure-queue \
  --scale-rule-metadata queueName=analysis-jobs queueLength=1 \
  --scale-rule-auth connection=connection-string \
  --secrets connection-string="$CS" \
  --env-vars AZURE_STORAGE_CONNECTION_STRING=secretref:connection-string \
  --cpu 8 --memory 56Gi \
  -o none

echo
echo "API: https://$(az containerapp show -n pongai-api -g $RG --query properties.configuration.ingress.fqdn -o tsv)"
echo
echo "Remaining:"
echo "  - raise the API ingress request timeout, or 40-minute SSE streams get cut"
echo "  - point the Static Web App at the API URL"
