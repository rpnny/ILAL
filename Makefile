.PHONY: verify build contracts-test cli-test sdk-test circuits-test protocol-test local-test pilot-test deployments-check release-check package-check secret-check sbom-check history-check

.NOTPARALLEL:

# One protocol: policy-controlled atomic execution and settlement.
verify: history-check deployments-check release-check contracts-test cli-test sdk-test circuits-test protocol-test local-test pilot-test package-check secret-check sbom-check

build:
	cd cli && npm run build

contracts-test:
	@test -d contracts/lib/v4-core || contracts/scripts/install-deps.sh
	cd contracts && forge fmt --check src/*.sol src/interfaces src/libraries src/mocks src/mixed src/oracle src/v2 test && forge build && forge test

cli-test:
	cd cli && npm test

sdk-test:
	cd sdk && npm run build && npm test

circuits-test:
	cd circuits && npm test

protocol-test: build contracts-test
	circuits/scripts/prepare_v2_test_artifacts.sh
	node scripts/mixed/prepare-real-proof.mjs
	ILAL_MIXED_DIFFERENTIAL=true ILAL_MIXED_REAL_PROOF=true forge test --root contracts --match-path 'test/Mixed*.t.sol' --no-match-test invariant_ --ffi
	FOUNDRY_INVARIANT_RUNS=2500 FOUNDRY_INVARIANT_DEPTH=40 forge test --root contracts --match-contract MixedInvariantTest --match-test invariant_ -vv
	node scripts/mixed/sync-abis.mjs --check
	node scripts/mixed/check-sizes.mjs
	node --test scripts/mixed/deployment.test.mjs

local-test: protocol-test
	bash scripts/mixed/run-local.sh

pilot-test: build contracts-test
	node --test scripts/pilot/model.test.mjs scripts/pilot/deployment.test.mjs
	bash scripts/pilot/run-local.sh
	node scripts/pilot/verify-evidence.mjs artifacts/pilot/local-evidence.json

deployments-check:
	node scripts/sync-deployments.mjs --check

release-check:
	node scripts/validate-release.mjs

package-check:
	node --test scripts/package.test.mjs

secret-check:
	node scripts/secret-scan.mjs

sbom-check:
	cd cli && npm sbom --sbom-format cyclonedx >/dev/null
	cd sdk && npm sbom --sbom-format cyclonedx >/dev/null
	cd circuits && npm sbom --sbom-format cyclonedx >/dev/null

history-check:
	./scripts/verify-cli-history.sh
