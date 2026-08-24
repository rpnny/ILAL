window.ILAL_STUDY_SUMMARY = {
  "schema": "ilal-site-study-summary-v1",
  "verdict": "PASS",
  "maturity": "ready for institutional pilot",
  "productionNetBenefitUsd": 4.748350323551133,
  "productionBaseline": "universal-router-bundled",
  "coreRows": 160,
  "supportedRowsMeasured": 40,
  "multiOrderRows": 12,
  "maxBatchGas": 1787349,
  "forkBlock": 50394803,
  "rwaWallets": 100000,
  "rwaTotalMs": 483834.742166,
  "rwaPeakRssBytes": 3894575104,
  "proofP95Ms": 3459.544083,
  "stressCalls": 100000,
  "fuzzRuns": 10000,
  "candidateFixedFailureCount": 5,
  "capacityRows": 135,
  "capacityMinimumUsd": 257,
  "capacityMaximumUsd": 1000000,
  "tcoRows": 243,
  "caveat": "Institutional pilot evidence; unaudited and not production-ready. Proof peak 3.63 GiB; pilot hosts need memory headroom above 4 GiB.",
  "supported": "2–16 orders · standard equal-decimal ERC-20 · 5 bps · ±100 tick start guard",
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
  set("studySupported", summary.supported);
  set("studyUnsupported", summary.unsupported);
})(window.ILAL_STUDY_SUMMARY);
