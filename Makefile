.PHONY: verify benchmark break-even-benchmark study-local study-fork study-rwa study-stress study-report study-full baseline-check deployments-check contracts-test protocol-test cli-test sdk-test circuits-test package-check release-check secret-check sbom-check history-check

verify: history-check baseline-check deployments-check release-check contracts-test protocol-test cli-test sdk-test circuits-test package-check secret-check sbom-check

benchmark:
	node scripts/run-netting-benchmark.mjs

break-even-benchmark:
	node scripts/run-break-even-benchmark.mjs

study-local:
	node scripts/study/study-local.mjs

study-fork:
	node scripts/study/study-fork.mjs

study-rwa:
	node scripts/study/study-rwa.mjs
	node scripts/study/study-tco.mjs

study-stress:
	node scripts/study/study-stress.mjs

study-report:
	node scripts/study/study-report.mjs

study-full:
	node scripts/study/study-full.mjs

history-check:
	./scripts/verify-cli-history.sh

baseline-check:
	node scripts/verify-settlement-baseline.mjs

deployments-check:
	node scripts/sync-deployments.mjs --check

release-check:
	node scripts/validate-release.mjs

contracts-test:
	cd contracts && test -d lib/v4-core || ./scripts/install-deps.sh
	cd contracts && forge fmt --check src/*.sol src/interfaces src/libraries src/mocks src/netting src/oracle src/test src/v2 script test
	cd contracts && forge build && forge test

cli-test:
	npm run build --workspace @ilalv3/cli
	npm run test --workspace @ilalv3/cli

protocol-test:
	npm run build --workspace @ilalv3/protocol
	npm run test --workspace @ilalv3/protocol

sdk-test:
	npm run build --workspace @ilalv3/sdk
	npm run test --workspace @ilalv3/sdk

circuits-test:
	cd circuits && npm run test:oracle && npm run test:v1 && npm run test:v2

package-check:
	npm run package-check

secret-check:
	node scripts/secret-scan.mjs

sbom-check:
	npm sbom --workspace @ilalv3/protocol --sbom-format cyclonedx >/dev/null
	npm sbom --workspace @ilalv3/cli --sbom-format cyclonedx >/dev/null
	npm sbom --workspace @ilalv3/sdk --sbom-format cyclonedx >/dev/null
	cd circuits && npm sbom --sbom-format cyclonedx >/dev/null
