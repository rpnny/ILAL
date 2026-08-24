.PHONY: verify benchmark break-even-benchmark study-local study-fork study-rwa study-stress study-report study-full deployments-check contracts-test cli-test sdk-test circuits-test package-check release-check secret-check sbom-check history-check

verify: history-check deployments-check release-check contracts-test cli-test sdk-test circuits-test package-check secret-check sbom-check

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

deployments-check:
	node scripts/sync-deployments.mjs --check

release-check:
	node scripts/validate-release.mjs

contracts-test:
	cd contracts && test -d lib/v4-core || ./scripts/install-deps.sh
	cd contracts && forge fmt --check src/*.sol src/interfaces src/libraries src/mocks src/netting src/test src/v2 script test
	cd contracts && forge build && forge test

cli-test:
	cd cli && npm run build && npm test

sdk-test:
	cd sdk && npm run build && npm test

circuits-test:
	cd circuits && npm run test:oracle && npm run test:v1 && npm run test:v2

package-check:
	cd cli && npm pack --dry-run

secret-check:
	node scripts/secret-scan.mjs

sbom-check:
	cd cli && npm sbom --sbom-format cyclonedx >/dev/null
	cd sdk && npm sbom --sbom-format cyclonedx >/dev/null
	cd circuits && npm sbom --sbom-format cyclonedx >/dev/null
