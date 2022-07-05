#!/bin/sh
set -e
cd "`dirname "$0"`"
./node_modules/.bin/prettier --write bugzilla.js index.html
./node_modules/.bin/stylelint --fix index.css
