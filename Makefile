# Makefile para producto/ (Hidra Market)
# Verificador local: make verify (build + tests + simulacion sin red)

.PHONY: verify demo testnet

CONTRACT_DIR = contract

verify:
	cd $(CONTRACT_DIR) && timeout 600 cargo near build non-reproducible-wasm && timeout 900 cargo test -q

demo:
	@echo "Demo no implementada aun (fuera de alcance hasta make verify en verde)"

testnet:
	@echo "Testnet opcional, requiere .env"
