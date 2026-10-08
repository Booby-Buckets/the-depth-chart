#!/bin/sh
# Bump the dynasty module version: every relative import (engine, ui, tools, tests) and dynasty.html's
# app.js carry the SAME ?v=N, so a deploy can't leave a browser running a stale mix of modules (a module URL
# with a different query is a separate instance — keep them identical).   sh js/dynasty/bump.sh
cd "$(dirname "$0")"
V=$(( $(cat .version 2>/dev/null || echo 1) + 1 )); echo $V > .version
find engine ui tools -name '*.js' | xargs sed -i '' -E "s#(from '\.{1,2}/[^'?]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g"
sed -i '' -E "s#js/dynasty/ui/app\.js(\?v=[0-9]+)?#js/dynasty/ui/app.js?v=$V#" ../../dynasty.html
echo "dynasty modules -> v$V"
