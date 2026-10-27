import type { OperatorAuthority } from "../../../src/runtime.ts";

// Selected rows also descend by amount, so direct filter order matches the harness contract.
const boundaryCsv = `invoice_id,supplier,region,amount
SYN-A-01,Cedar Workshop,EMEA,875
SYN-A-02,Blue Orchard,APAC,920
SYN-A-03,North Loom,EMEA,500
SYN-A-04,Silver Kiln,EMEA,499
SYN-A-05,Amber Foundry,emea,650
`;

const decimalCsv = `invoice_id,supplier,region,amount
SYN-B-01,"Harbor, Works",EMEA,1200.5
SYN-B-02,Fern Assembly,AMER,1600
SYN-B-03,Linen Studio,EMEA,640.25
SYN-B-04,Sage Depot,EMEA,499.75
SYN-B-05,Maple Forge,EMEA,0
`;

export const recoverySamples = {
  "cli:mlr:filter": {
    samples: [
      {
        args: {
          global_options: ["--icsv", "--ojson"],
          options: ["-e", '$region=="EMEA" && $amount>=500'],
          files: { "recovery-boundary.csv": boundaryCsv },
          operands: ["recovery-boundary.csv"],
        },
        output: [
          { invoice_id: "SYN-A-01", supplier: "Cedar Workshop", region: "EMEA", amount: 875 },
          { invoice_id: "SYN-A-03", supplier: "North Loom", region: "EMEA", amount: 500 },
        ],
        format: "json",
      },
      {
        args: {
          global_options: ["--icsv", "--ojson"],
          options: ["-e", '$region=="EMEA" && $amount>=500'],
          files: { "recovery-decimal.csv": decimalCsv },
          operands: ["recovery-decimal.csv"],
        },
        output: [
          { invoice_id: "SYN-B-01", supplier: "Harbor, Works", region: "EMEA", amount: 1200.5 },
          { invoice_id: "SYN-B-03", supplier: "Linen Studio", region: "EMEA", amount: 640.25 },
        ],
        format: "json",
      },
    ],
  },
  "cli:cli-anything-mlr:filter": {
    samples: [
      {
        args: {
          options: ["--input", "recovery-boundary.csv", "--region", "EMEA", "--min-amount", "500", "--columns", "invoice_id,supplier,amount"],
          files: { "recovery-boundary.csv": boundaryCsv },
          operands: [],
        },
        output: [
          { invoice_id: "SYN-A-01", supplier: "Cedar Workshop", amount: 875 },
          { invoice_id: "SYN-A-03", supplier: "North Loom", amount: 500 },
        ],
        format: "json",
      },
      {
        args: {
          options: ["--input", "recovery-decimal.csv", "--region", "EMEA", "--min-amount", "500", "--columns", "invoice_id,supplier,amount"],
          files: { "recovery-decimal.csv": decimalCsv },
          operands: [],
        },
        output: [
          { invoice_id: "SYN-B-01", supplier: "Harbor, Works", amount: 1200.5 },
          { invoice_id: "SYN-B-03", supplier: "Linen Studio", amount: 640.25 },
        ],
        format: "json",
      },
    ],
  },
} satisfies NonNullable<OperatorAuthority["cliConformance"]>;
