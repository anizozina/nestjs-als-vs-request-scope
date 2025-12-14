#!/bin/sh

# Profile all three endpoints
echo "======================================"
echo "Profiling All Endpoints"
echo "======================================"
echo ""

# Profile each endpoint
sh scripts/profile-with-node.sh /bench/singleton singleton
echo ""
echo "--------------------------------------"
echo ""

sh scripts/profile-with-node.sh /bench/request-scope request-scope
echo ""
echo "--------------------------------------"
echo ""

sh scripts/profile-with-node.sh /bench/cls cls
echo ""

echo "======================================"
echo "All profiling complete!"
echo "Check reports/ directory for results"
echo "======================================"
