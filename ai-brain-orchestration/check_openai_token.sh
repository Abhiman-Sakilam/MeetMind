#!/usr/bin/env bash

set -u

ENV_FILE="${1:-.env}"

if [[ -z "${GROQ_API_KEY:-}" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    # Load GROQ_API_KEY from .env without printing it
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
fi

if [[ -z "${GROQ_API_KEY:-}" ]]; then
  echo "ERROR: GROQ_API_KEY is not set."
  echo "Set it in your environment or in ${ENV_FILE}."
  exit 1
fi

MODEL="${MODEL_GENERAL:-llama-3.1-8b-instant}"
ENDPOINT="https://api.groq.com/openai/v1/models/${MODEL}"

TMP_BODY="$(mktemp)"
HTTP_CODE="$(
  curl -sS -o "$TMP_BODY" -w "%{http_code}" \
    -H "Authorization: Bearer ${GROQ_API_KEY}" \
    "$ENDPOINT"
)"

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "SUCCESS: Groq API token is working."
  echo "Model access confirmed: ${MODEL}"
  rm -f "$TMP_BODY"
  exit 0
fi

echo "FAIL: Groq API token check failed."
echo "HTTP status: $HTTP_CODE"
echo "Response:"
sed -n '1,200p' "$TMP_BODY"
echo
rm -f "$TMP_BODY"
exit 1
