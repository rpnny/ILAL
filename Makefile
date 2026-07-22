.PHONY: verify deployments-check contracts-test cli-test sdk-test circuits-test package-check release-check secret-check sbom-check history-check

verify: history-check deployments-check release-check contracts-test cli-test sdk-test circuits-test package-check secret-check sbom-check

history-check:
	./scripts/verify-cli-history.sh

deployments-check:
	node scripts/sync-deployments.mjs --check

release-check:
	node scripts/validate-release.mjs

contracts-test:
	cd contracts && test -d lib/v4-core || ./scripts/install-deps.sh
	cd contracts && forge fmt --check src/*.sol src/interfaces src/libraries src/mocks src/test src/v2 script test
	cd contracts && forge build && forge test

cli-test:
	cd cli && npm run build && npm test

sdk-test:
	cd sdk && npm run build && npm test

circuits-test:
	cd circuits && npm run test:oracle && npm run test:v2

package-check:
	cd cli && npm pack --dry-run

secret-check:
	node scripts/secret-scan.mjs

sbom-check:
	cd cli && npm sbom --sbom-format cyclonedx >/dev/null
	cd sdk && npm sbom --sbom-format cyclonedx >/dev/null
	cd circuits && npm sbom --sbom-format cyclonedx >/dev/null
