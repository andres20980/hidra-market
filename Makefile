# Makefile v2.0 - Hidra Market: verify / demo / testnet
# Works from a clean clone and inside a jail with a read-only $HOME.

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.ONESHELL:
.DEFAULT_GOAL := help
.PHONY: help deps verify demo testnet

export PATH := $(HOME)/.cargo/bin:$(PATH)

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
CONTRACT := $(ROOT)/contract
SWARM := $(ROOT)/swarm
WEB := $(ROOT)/web
WASM := $(CONTRACT)/target/wasm32-unknown-unknown/release/contract.wasm
PESADO_LOCK ?= /tmp/coalicion_pesado.lock

# near-sandbox binary: keep the caller's value, else pick the newest one cached by near-kit.
NEAR_SANDBOX_BIN_PATH ?= $(shell ls -1v $(HOME)/.near-kit/sandbox/bin/near-sandbox-* 2>/dev/null | tail -n 1)
ifneq ($(strip $(NEAR_SANDBOX_BIN_PATH)),)
export NEAR_SANDBOX_BIN_PATH
endif

# Per-run scratch dir (removed on exit). XDG config and npm cache move there when the
# defaults are not writable, so cargo-near never hits "os error 30 (Read-only file system)".
define SETUP_ENV
scratch="$$(mktemp -d "$${TMPDIR:-/tmp}/hidra-market.XXXXXX")"
trap 'rm -rf "$$scratch"' EXIT
if [[ -z "$${XDG_CONFIG_HOME:-}" ]] || ! { mkdir -p "$$XDG_CONFIG_HOME" && [[ -w "$$XDG_CONFIG_HOME" ]]; } 2>/dev/null; then
  export XDG_CONFIG_HOME="$$scratch/config"; mkdir -p "$$XDG_CONFIG_HOME"
fi
npm_cache="$${npm_config_cache:-$$HOME/.npm}"
if ! { mkdir -p "$$npm_cache" && [[ -w "$$npm_cache" ]]; } 2>/dev/null; then
  export npm_config_cache="$$scratch/npm"
fi
heavy() {
  if command -v flock >/dev/null 2>&1 && touch "$(PESADO_LOCK)" 2>/dev/null; then
    flock -w 1800 "$(PESADO_LOCK)" "$$@"
  else
    "$$@"
  fi
}
endef

help:
	@echo "make verify   contract build + Rust tests, swarm tests + simulator, web typecheck + tests + build"
	@echo "make demo     deterministic simulation + real on-chain round in near-sandbox + web build (no LLM, no network)"
	@echo "make testnet  worker sub-account with a limited function-call key on NEAR testnet (needs swarm/.env)"

deps:
	@$(SETUP_ENV)
	for d in "$(SWARM)" "$(WEB)"; do
	  if [[ ! -d "$$d/node_modules" ]]; then
	    echo "==> npm ci in $${d#$(ROOT)/}"
	    (cd "$$d" && npm ci --no-audit --no-fund --loglevel=error)
	  fi
	done

verify: deps
	@$(SETUP_ENV)
	echo "==> contract: cargo near build non-reproducible-wasm"
	cd "$(CONTRACT)"
	heavy timeout 900 cargo near build non-reproducible-wasm
	echo "==> contract: cargo test --offline"
	heavy timeout 900 cargo test --offline -q
	echo "==> swarm: npm test + npm run sim"
	cd "$(SWARM)"
	npm test --silent
	npm run --silent sim
	echo "==> web: typecheck + test + build"
	cd "$(WEB)"
	npm run --silent typecheck
	npm test --silent
	npm run --silent build
	echo "verify: OK"

demo: deps
	@$(SETUP_ENV)
	start="$$(date +%s)"
	if [[ ! -f "$(WASM)" ]]; then
	  echo "==> contract wasm missing, building it once (not part of the 60s demo)"
	  (cd "$(CONTRACT)" && heavy timeout 900 cargo near build non-reproducible-wasm)
	  start="$$(date +%s)"
	fi
	cd "$(SWARM)"
	echo "==> 1/4 deterministic simulator (seed 42, real anonymised ledger)"
	npm run --silent sim
	echo "==> 2/4 real round on near-sandbox (commit -> reveal -> close -> submit -> attest)"
	npm run --silent sandbox:round
	echo "==> 3/4 sync results to web/public and build web/dist"
	cp out/sim.json "$(WEB)/public/sim.json"
	if [[ -f out/sandbox_round.json ]]; then cp out/sandbox_round.json "$(WEB)/public/sandbox_round.json"; fi
	(cd "$(WEB)" && npm run --silent build >/dev/null)
	echo "==> 4/4 summary"
	python3 "$(ROOT)/scripts/demo_summary.py" --root "$(ROOT)" --since "$$start"

testnet: deps
	@if [[ ! -f "$(SWARM)/.env" ]]; then
	  echo "swarm/.env not found. Run: cp swarm/.env.example swarm/.env and set NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_CONTRACT_ID (testnet only)." >&2
	  exit 2
	fi
	cd "$(SWARM)" && npm run --silent client:testnet
