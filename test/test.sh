#!/bin/bash
# Usage: ./test/test.sh <url>
# Runs assertions and exits 1 on first failure.

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: $0 <url>"
    exit 1
fi

URL="$1"
OUTPUT="test/output.txt"
PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "  PASS  $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  FAIL  $1: $2" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); exit 1; }

assert_contains() {
    local label="$1" output="$2" expected="$3"
    if echo "$output" | grep -q "$expected"; then
        pass "$label"
    else
        fail "$label" "Expected '$expected' in: $output"
    fi
}

assert_exit_nonzero() {
    local label="$1" cmd="${@:2}"
    if $cmd > /dev/null 2>&1; then
        fail "$label" "Expected non-zero exit"
    else
        pass "$label"
    fi
}

node src/index.js clear > /dev/null 2>&1 || true

# ─── Quick crawl ─────────────────────────────────────────────────────────────

echo ""
echo "=== Quick crawl ==="

OUT=$(node src/index.js "$URL" --output="$OUTPUT" 2>&1)
assert_contains "quick crawl exits cleanly" "$OUT" "Output saved"
[ -s "$OUTPUT" ] && pass "output file has content" || fail "output file has content" "file is empty"
assert_contains "output contains a URL" "$(cat $OUTPUT)" "http"

# ─── Run with job persistence ─────────────────────────────────────────────────

echo ""
echo "=== Run with job persistence ==="

RUN_OUT=$(node src/index.js run "$URL" 2>&1)
JOB_ID=$(echo "$RUN_OUT" | grep "Job created:" | awk '{print $3}')
[ -n "$JOB_ID" ] && pass "job ID assigned" || fail "job ID assigned" "no job ID in output"
assert_contains "progress shown during scrape" "$RUN_OUT" "%"
assert_contains "job completes" "$RUN_OUT" "Job completed"

# ─── List ─────────────────────────────────────────────────────────────────────

echo ""
echo "=== List ==="

LIST_OUT=$(node src/index.js list 2>&1)
assert_contains "list shows completed job" "$LIST_OUT" "COMPLETED"
assert_contains "list shows job ID" "$LIST_OUT" "$JOB_ID"

# ─── Status ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Status ==="

STATUS_OUT=$(node src/index.js status "$JOB_ID" 2>&1)
assert_contains "status shows COMPLETED" "$STATUS_OUT" "COMPLETED"
assert_contains "status shows root_url" "$STATUS_OUT" "$URL"
assert_contains "status shows progress 100" "$STATUS_OUT" '"progress": 100'

# ─── Result ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Result ==="

RESULT_OUT=$(node src/index.js result "$JOB_ID" 2>&1)
assert_contains "result contains URL" "$RESULT_OUT" "http"

RESULT_JSON=$(node src/index.js result "$JOB_ID" --format=json 2>&1)
assert_contains "result json has url field" "$RESULT_JSON" '"url"'
assert_contains "result json has children field" "$RESULT_JSON" '"children"'

# ─── Error cases ──────────────────────────────────────────────────────────────

echo ""
echo "=== Error cases ==="

assert_exit_nonzero "result on non-existent job fails" node src/index.js result "00000000-0000-0000-0000-000000000000"
assert_exit_nonzero "cancel on non-existent job fails" node src/index.js cancel "00000000-0000-0000-0000-000000000000"
assert_exit_nonzero "cancel on non-SCRAPING job fails" node src/index.js cancel "$JOB_ID"
assert_exit_nonzero "rerun on completed job fails" node src/index.js rerun "$JOB_ID"
assert_exit_nonzero "run with no URL fails" node src/index.js run
assert_exit_nonzero "run with invalid URL fails" node src/index.js run "not-a-url"

# ─── Cancel ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Cancel ==="

# Use depth=2 to give enough time to cancel
node src/index.js run "$URL" --depth=2 > /dev/null &
BG_PID=$!

# Poll until job reaches SCRAPING state (up to 30s)
CANCEL_JOB=""
DEADLINE=$((SECONDS + 30))
while [ $SECONDS -lt $DEADLINE ]; do
    CANCEL_JOB=$(node src/index.js list 2>/dev/null | grep "SCRAPING" | awk '{print $1}')
    [ -n "$CANCEL_JOB" ] && break
    sleep 1
done

[ -n "$CANCEL_JOB" ] && pass "job reached SCRAPING state" || fail "job reached SCRAPING state" "timed out waiting"

CANCEL_OUT=$(node src/index.js cancel "$CANCEL_JOB" 2>&1)
assert_contains "cancel sends signal" "$CANCEL_OUT" "Cancel signal sent"

wait $BG_PID || true  # job exits with code 1 on cancel

CANCELLED_STATUS=$(node src/index.js list 2>&1 | grep "$CANCEL_JOB")
assert_contains "job shows CANCELLED in list" "$CANCELLED_STATUS" "CANCELLED"

# ─── Rerun ────────────────────────────────────────────────────────────────────

echo ""
echo "=== Rerun ==="

RERUN_OUT=$(node src/index.js rerun "$CANCEL_JOB" 2>&1)
assert_contains "rerun reports progress" "$RERUN_OUT" "%"
assert_contains "rerun completes" "$RERUN_OUT" "Job completed"

RERUN_STATUS=$(node src/index.js status "$CANCEL_JOB" 2>&1)
assert_contains "rerun job now COMPLETED" "$RERUN_STATUS" "COMPLETED"

# ─── Clear ────────────────────────────────────────────────────────────────────

echo ""
echo "=== Clear ==="

node src/index.js clear > /dev/null
CLEAR_OUT=$(node src/index.js list 2>&1)
assert_contains "list empty after clear" "$CLEAR_OUT" "No jobs found"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "=== Done: $PASS_COUNT passed, $FAIL_COUNT failed ==="
