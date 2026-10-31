# PressFlow InDesign automation layer. InDesign itself is not needed for any target here.
PYTEST = uv run --no-project --with pytest --with jsonschema pytest

.PHONY: check check-jsx test test-js uxp-sync

check: check-jsx test

## node --check on both .jsx files (via stdin), the UXP JS, and the UXP jsx copy freshness
check-jsx:
	./scripts/check-jsx.sh

## Python bridge tests + JSX mock-DOM tests + UXP library tests (pytest drives node)
test:
	$(PYTEST)

## UXP library tests only (Node's built-in test runner)
test-js:
	node --test tests/js/uxp_libs.test.js

## Copy the renderer into the UXP plugin (UXP plugins cannot read files outside their folder)
uxp-sync:
	mkdir -p uxp/jsx
	cp extendscript/pressflow-render.jsx uxp/jsx/pressflow-render.jsx
