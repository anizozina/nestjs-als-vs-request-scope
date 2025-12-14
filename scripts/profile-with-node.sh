#!/bin/sh

# Node.js built-in profiler script
# Usage: ./profile-with-node.sh <endpoint-path> <output-name>
# Example: ./profile-with-node.sh /bench/request-scope request-scope

ENDPOINT_PATH=${1:-/bench/singleton}
OUTPUT_NAME=${2:-singleton}
DURATION=30
CONNECTIONS=100
PORT=3000

REPORT_DIR="./reports"
mkdir -p "$REPORT_DIR"

echo "=========================================="
echo "Node.js Profiling: $OUTPUT_NAME"
echo "Endpoint: $ENDPOINT_PATH"
echo "Duration: ${DURATION}s, Connections: $CONNECTIONS"
echo "=========================================="
echo ""

# Start application with profiler
echo "Starting application with --prof..."
node --prof dist/main.js &
APP_PID=$!

# Wait for application to start
echo "Waiting for application to start..."
sleep 3

# Check if app is running
if ! kill -0 $APP_PID 2>/dev/null; then
  echo "ERROR: Application failed to start"
  exit 1
fi

echo "Application started (PID: $APP_PID)"
echo ""

# Run load test
echo "Running load test..."
npx autocannon -c $CONNECTIONS -d $DURATION "http://localhost:$PORT$ENDPOINT_PATH"
AUTOCANNON_EXIT=$?

echo ""
echo "Load test completed (exit code: $AUTOCANNON_EXIT)"
echo ""

# Stop application gracefully
echo "Stopping application..."
kill -SIGTERM $APP_PID
wait $APP_PID 2>/dev/null

echo "Application stopped"
echo ""

# Find and process the profiler log
echo "Processing profiler output..."
PROF_FILE=$(ls -t isolate-*.log 2>/dev/null | head -1)

if [ -z "$PROF_FILE" ]; then
  echo "ERROR: No profiler log file found"
  exit 1
fi

echo "Found profiler log: $PROF_FILE"
echo "Generating report..."

# Process the profiler log
node --prof-process "$PROF_FILE" > "$REPORT_DIR/${OUTPUT_NAME}-profile.txt"

# Move the raw log file
mv "$PROF_FILE" "$REPORT_DIR/${OUTPUT_NAME}-raw.log"

echo ""
echo "=========================================="
echo "Profiling complete!"
echo "Report: $REPORT_DIR/${OUTPUT_NAME}-profile.txt"
echo "Raw log: $REPORT_DIR/${OUTPUT_NAME}-raw.log"
echo "=========================================="
