#!/bin/bash
npx tsc --noEmit --pretty 2>&1 | head -20
exit 0
