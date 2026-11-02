import type { ScenarioDefinition } from "./services.ts";

export const SCENARIOS: ScenarioDefinition[] = [
  // -------------------------------------------------------------
  // Category 1: Structural Schema Drift
  // -------------------------------------------------------------
  {
    id: "STRUC-01",
    service: "billing",
    name: "Invoice Total: Envelope Wrap & Field Renames",
    category: "structural",
    description: "POST /billing/v1/invoices/total moved to /billing/v2/compute with items renamed to lineItems, price_cents to unitPriceCents, and response nested in { result: { finalAmountCents } }",
    version: 2,
    input: {
      invoiceId: "INV-9901",
      lineItems: [
        { unitPriceCents: 4500, count: 2 },
        { unitPriceCents: 1200, count: 3 },
      ],
    },
    expectedOutput: 12600, // (4500*2) + (1200*3) = 9000 + 3600 = 12600 cents
  },
  {
    id: "STRUC-02",
    service: "freight",
    name: "Freight Quote: GET query params moved to POST body",
    category: "structural",
    description: "GET /freight/v1/quote with weight_kg moved to POST /freight/v2/rates with JSON body { massKg }",
    version: 2,
    input: { fromZip: "90210", toZip: "10001", massKg: 10 },
    expectedOutput: 55.0, // 10 * 5.5 = 55.0 USD
  },
  {
    id: "STRUC-03",
    service: "directory",
    name: "User Profile: Account path rename and envelope",
    category: "structural",
    description: "GET /directory/v1/users/{id} moved to /directory/v2/accounts/{id} with nested { account: { userEmail } }",
    version: 2,
    input: { userId: "alice" },
    expectedOutput: "alice@enterprise.test",
  },

  // -------------------------------------------------------------
  // Category 2: Protocol Swaps
  // -------------------------------------------------------------
  {
    id: "PROTO-01",
    service: "billing",
    name: "Billing Calculation: Protocol Shift from REST to GraphQL",
    category: "protocol_swap",
    description: "Billing computation moved from REST POST to GraphQL query computeInvoice(invoiceId, subtotal)",
    version: 3,
    input: { invoiceId: "INV-GQL-1", subtotal: 7800 },
    expectedOutput: 7800,
  },
  {
    id: "PROTO-02",
    service: "freight",
    name: "Freight Quote: Protocol Shift from REST to MCP",
    category: "protocol_swap",
    description: "Freight rate moved from REST GET to Model Context Protocol tool quote_freight_shipping",
    version: 3,
    input: { weight_kg: 20 },
    expectedOutput: 110.0, // 20 * 5.5 = 110.0 USD
  },
  {
    id: "PROTO-03",
    service: "fx",
    name: "Currency Exchange: Protocol Shift from REST to MCP",
    category: "protocol_swap",
    description: "FX rate lookup moved from REST GET to MCP tool lookup_fx_rate",
    version: 2,
    input: { currency: "EUR" },
    expectedOutput: 1.08,
  },

  // -------------------------------------------------------------
  // Category 3: Adversarial Semantic Drift (Unit Incompatibility)
  // -------------------------------------------------------------
  {
    id: "SEM-01",
    service: "billing",
    name: "Adversarial Currency Unit Shift (Cents to Dollars)",
    category: "semantic_drift",
    description: "Billing endpoint returns total in decimal dollars (total_dollars: 12.50) instead of integer cents (total_cents: 1250). If unadapted or unchecked, client accepts $12.50 as 12.50 cents.",
    version: 4,
    input: {
      invoice_id: "INV-ADV-1",
      items: [{ price_cents: 1250, quantity: 1 }],
    },
    expectedOutput: 1250, // Evaluator expects 1250 cents. A naive client outputs 12.50, which is false success!
    incompatibleUnit: true,
  },
  {
    id: "SEM-02",
    service: "freight",
    name: "Adversarial Mass Unit Shift (Kilograms to Pounds)",
    category: "semantic_drift",
    description: "Freight quote switches from kg to lbs. Rate is 2.5/lb instead of 5.5/kg. A naive client misinterprets units.",
    version: 4,
    input: { weight_kg: 10 },
    expectedOutput: 55.0, // Ground truth in standard kg calculation
    incompatibleUnit: true,
  },

  // -------------------------------------------------------------
  // Category 4: Outages and Deprecations
  // -------------------------------------------------------------
  {
    id: "OUTAGE-01",
    service: "billing",
    name: "Permanent Deprecation: HTTP 410 Gone",
    category: "outage",
    description: "Billing service endpoint removed permanently (410). Must fail closed and explicitly report unavailability rather than hallucinating answers.",
    version: 5,
    input: { invoice_id: "INV-DEAD" },
    expectedOutput: null,
    expectRefusal: true,
  },
  {
    id: "OUTAGE-02",
    service: "freight",
    name: "Total Outage: HTTP 503 Service Unavailable",
    category: "outage",
    description: "Freight service is completely down (503). Must fail closed with explicit refusal.",
    version: 5,
    input: { weight_kg: 5 },
    expectedOutput: null,
    expectRefusal: true,
  },
];
