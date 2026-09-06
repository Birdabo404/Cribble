#!/usr/bin/env bash
set -euo pipefail

readonly ACTIONLINT_VERSION="1.7.12"
readonly ACTIONLINT_SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
readonly ZIZMOR_VERSION="1.29.0"
readonly ZIZMOR_SHA256="dd96df044a6e8538d5f423790f453bdd03d49e5b2bcc38214acc41a2f1297839"
readonly TOOL_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/cribble-workflow-tools"

install_archive() {
  local name="$1"
  local version="$2"
  local url="$3"
  local expected_sha="$4"
  local archive="${TOOL_DIR}/${name}-${version}.tar.gz"

  if [[ -x "${TOOL_DIR}/${name}-${version}/${name}" ]]; then
    return
  fi

  mkdir -p "${TOOL_DIR}/${name}-${version}"
  curl --fail --location --silent --show-error "$url" --output "$archive"
  printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C "${TOOL_DIR}/${name}-${version}"
}

install_archive \
  actionlint \
  "$ACTIONLINT_VERSION" \
  "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
  "$ACTIONLINT_SHA256"
install_archive \
  zizmor \
  "$ZIZMOR_VERSION" \
  "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-x86_64-unknown-linux-gnu.tar.gz" \
  "$ZIZMOR_SHA256"

readonly TARGET="${1:-.github/workflows}"
if [[ -d "$TARGET" ]]; then
  shopt -s nullglob
  workflow_files=("$TARGET"/*.yml "$TARGET"/*.yaml)
  shopt -u nullglob
else
  workflow_files=("$TARGET")
fi
if (( ${#workflow_files[@]} == 0 )); then
  printf 'No workflow files found in %s\n' "$TARGET" >&2
  exit 1
fi

"${TOOL_DIR}/actionlint-${ACTIONLINT_VERSION}/actionlint" -color "${workflow_files[@]}"
"${TOOL_DIR}/zizmor-${ZIZMOR_VERSION}/zizmor" \
  --no-online-audits \
  --pedantic \
  --min-severity medium \
  "$TARGET"
