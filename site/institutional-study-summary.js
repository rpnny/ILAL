window.ILAL_STUDY_SUMMARY = {
  "schema": "ilal-site-study-summary-v1",
  "verdict": "PASS",
  "maturity": "ready for institutional pilot",
  "productionNetBenefitUsd": 4.643449790483895,
  "productionBaseline": "universal-router-bundled",
  "coreRows": 160,
  "supportedRowsMeasured": 40,
  "multiOrderRows": 12,
  "maxBatchGas": 1825968,
  "forkBlock": 50421294,
  "rwaWallets": 100000,
  "rwaTotalMs": 541327.555126,
  "rwaPeakRssBytes": 3832889344,
  "proofP95Ms": 3611.966708,
  "stressCalls": 100000,
  "fuzzRuns": 10000,
  "candidateFixedFailureCount": 5,
  "capacityRows": 135,
  "capacityMinimumUsd": 137,
  "capacityMaximumUsd": 1000000,
  "tcoRows": 243,
  "oracleGuardGas": 37541,
  "oracleIncrementalGas": 36360,
  "chainlinkCandidateEvidence": "COMPLETE",
  "caveat": "Institutional pilot evidence; unaudited and not production-ready. Proof peak 3.57 GiB; pilot hosts need memory headroom above 4 GiB.",
  "supported": "2–16 orders · standard equal-decimal ERC-20 · 5 bps · Chainlink 100 bps/90,000s · ±100 tick",
  "unsupported": "fee-on-transfer/rebasing/nonstandard tokens · other fee tiers · capacity-exceeding batches"
};
(function hydrateInstitutionalStudy(summary) {
  const set = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  set("studyVerdict", `${summary.verdict} · ${summary.maturity}`);
  set("studyCaveat", summary.caveat);
  set("studyNetBenefit", summary.productionNetBenefitUsd == null ? "NOT RUN" : `+$${summary.productionNetBenefitUsd.toFixed(2)}`);
  set("studyBaseline", summary.productionBaseline || "production baseline pending");
  set("studyRows", `${summary.supportedRowsMeasured}/${summary.coreRows}`);
  set("studyStress", summary.stressCalls == null ? "NOT RUN" : summary.stressCalls.toLocaleString("en-US"));
  set("studyRwa", summary.rwaWallets == null ? "NOT RUN" : summary.rwaWallets.toLocaleString("en-US"));
  set("studyOracleGas", summary.oracleIncrementalGas == null ? "NOT RUN" : `+${summary.oracleIncrementalGas.toLocaleString("en-US")}`);
  set("studySupported", summary.supported);
  set("studyUnsupported", summary.unsupported);
})(window.ILAL_STUDY_SUMMARY);
