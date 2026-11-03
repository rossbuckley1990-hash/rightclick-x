// Independent Adversarial Semantic Integrity Test Suite
// Target: Frozen candidate ebfbf857d5189db44d3043c284c4e89b9e8dcba1
// Evaluator: Independent Adversarial Systems Evaluator

import assert from "node:assert/strict";
import { inferType, distance, strongly, accepts } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/core/semantics.ts";
import { inferUnitType, unitType, UNITS } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/core/units.ts";
import { convertMoney, moneyType } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/core/quantities.ts";
import { RightClick } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/runtime.ts";
import { reflectOpenAPI } from "/Users/ross/.gemini/antigravity/scratch/rightclick-x/src/reflectors/openapi.ts";

export interface SemanticTestCaseResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  expected: string;
  observed: string;
  vulnerability: string | null;
  detail: string;
}

export async function runSemanticSuite(): Promise<SemanticTestCaseResult[]> {
  const results: SemanticTestCaseResult[] = [];

  // -------------------------------------------------------------------------
  // CASE A1: Cross-Currency Mismatch Without ISO 4217 Distinction (CAD vs USD)
  // -------------------------------------------------------------------------
  {
    // A provider returns Canadian Dollars (CAD) but the field is named "amount" or "price".
    // Does inferType detect CAD, or collapse it to unknown/number?
    const typeCAD = inferType("amount_cad", { type: "number" }, "Total amount in Canadian dollars");
    const typeUSD = inferType("amount_usd", { type: "number" }, "Total amount in US dollars");
    const acceptsUSDforCAD = accepts("amount", typeUSD, typeCAD);
    const passes = typeCAD !== typeUSD && !acceptsUSDforCAD;
    results.push({
      id: "SEM-ADV-01",
      name: "Cross-Currency Mismatch Without Universal ISO Code (CAD vs USD)",
      category: "currency_integrity",
      passed: passes,
      expected: "typeCAD !== typeUSD and accepts(USD, CAD) === false",
      observed: `typeCAD=${typeCAD}, typeUSD=${typeUSD}, accepts=${acceptsUSDforCAD}`,
      vulnerability: passes ? null : "USD and CAD conflated, risking unhedged FX balance corruption",
      detail: "Tests whether currency inference isolates CAD from USD without explicit exchange step.",
    });
  }

  // -------------------------------------------------------------------------
  // CASE A2: Zero-Decimal Currency Scale Mismatch (USD cents vs JPY yen)
  // -------------------------------------------------------------------------
  {
    // USD cents: 1000 = $10.00. JPY yen: 1000 = 1000 yen (zero decimal currency).
    // If a service migrates to JPY, 1000 minor units does NOT equal 1000 cents!
    const jpyMinor = moneyType("JPY", "minor");
    const usdMinor = moneyType("USD", "minor");
    const acceptsJPY = accepts("amount", usdMinor, jpyMinor);
    // Does convertMoney support JPY?
    let convertError: string | null = null;
    try {
      convertMoney(1000, "JPY", "minor", "major");
    } catch (e: any) {
      convertError = e.message;
    }
    const passes = !acceptsJPY && (convertError !== null && convertError.includes("unsupported currency"));
    results.push({
      id: "SEM-ADV-02",
      name: "Zero-Decimal Currency Rejection (JPY vs USD)",
      category: "currency_scale",
      passed: passes,
      expected: "JPY minor rejected for USD and unsupported without zero-decimal convention",
      observed: `accepts=${acceptsJPY}, convertError=${convertError}`,
      vulnerability: passes ? null : "Zero-decimal currency misbound to minor units",
      detail: "Validates that unsupported/zero-decimal currencies fail closed rather than dividing by 100.",
    });
  }

  // -------------------------------------------------------------------------
  // CASE A3: Physical Quantity Unit Conversion Without Registered Converter (Grams vs Kilograms)
  // -------------------------------------------------------------------------
  {
    // UNITS only defines kg, lb, m, ft, l, gal, celsius, fahrenheit, kelvin, s, ms, mb, mib, kmh, mph, percent, bps.
    // "grams" is NOT defined in UNITS.
    const unitGrams = inferUnitType("weight_grams", "Weight in grams");
    const unitKg = inferUnitType("weight_kg", "Weight in kilograms");
    // Does inferUnitType guess grams into kg?
    const passes = unitGrams !== unitType("kg") && unitGrams !== "quantity:mass:kg";
    results.push({
      id: "SEM-ADV-03",
      name: "Unregistered Metric Physical Unit (Grams vs Kilograms)",
      category: "physical_quantities",
      passed: passes,
      expected: "weight_grams must not bind to quantity:mass:kg without converter",
      observed: `unitGrams=${unitGrams}, unitKg=${unitKg}`,
      vulnerability: passes ? null : "Grams bound directly to Kilograms (1000x scale error)",
      detail: "Verifies that unmapped physical sub-units (grams) are not coerced into base units (kg).",
    });
  }

  // -------------------------------------------------------------------------
  // CASE A4: Reversed Accounting Semantics (Discount vs Surcharge)
  // -------------------------------------------------------------------------
  {
    // An invoice input has "discount_cents". A changed API has "surcharge_cents".
    // Both are quantity:money:USD:minor.
    const discountType = inferType("discount_cents", { type: "integer" }, "Discount to subtract from total in USD cents");
    const surchargeType = inferType("surcharge_cents", { type: "integer" }, "Surcharge to add to total in USD cents");
    
    // In RightClick X, distance/strongly checks compatibility.
    // Notice: Both infer as quantity:money:USD:minor!
    // But do the port names "discount" and "surcharge" match in planner token scoring?
    const rc = await RightClick.create({ directories: [] });
    const spec = {
      openapi: "3.1.0",
      info: { title: "Billing", version: "1.0.0" },
      servers: [{ url: "https://billing.test" }],
      paths: {
        "/charge": {
          post: {
            operationId: "addSurcharge",
            summary: "Add surcharge fee",
            parameters: [
              {
                name: "surcharge_cents",
                in: "query",
                required: true,
                schema: { type: "integer" },
                description: "Surcharge fee in USD cents",
              },
            ],
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { status: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    rc.graph.add(reflectOpenAPI(spec, "https://billing.test/openapi.json"));

    const plan = await rc.compose({
      have: { discount_cents: 500 },
      want: "text",
      intent: "apply customer discount",
      run: false,
    });

    // An adversarial vulnerability exists if RightClick binds discount_cents to surcharge_cents!
    const boundSurcharge = plan.plans.some(p => p.steps.some(s => s.bindings.some(b => b.port === "surcharge_cents" && b.from.includes("discount_cents"))));
    const passes = !boundSurcharge || plan.plans.length === 0;

    results.push({
      id: "SEM-ADV-04",
      name: "Reversed Accounting Polarity (Discount vs Surcharge)",
      category: "semantic_inversion",
      passed: passes,
      expected: "Discount must not bind to Surcharge port",
      observed: `plansCount=${plan.plans.length}, boundSurcharge=${boundSurcharge}`,
      vulnerability: boundSurcharge ? "Discount bound to Surcharge port (customer charged fee instead of granted discount!)" : null,
      detail: "Adversarial test checking whether monetary minor typing overrides opposite polarities (discount vs surcharge).",
    });
  }

  // -------------------------------------------------------------------------
  // CASE A5: Ambiguous Tax Basis (Gross vs Net without Rate)
  // -------------------------------------------------------------------------
  {
    // Net basis: $100.00 pre-tax. Gross basis: $108.25 post-tax.
    const netType = inferUnitType("net_amount", "Pre-tax net balance");
    const grossType = inferUnitType("gross_amount", "Total gross amount inclusive of VAT");
    const passes = netType === "quantity:money:unknown:unknown" && grossType === "quantity:money:unknown:unknown";
    results.push({
      id: "SEM-ADV-05",
      name: "Tax Basis Ambiguity (Gross vs Net Preservation)",
      category: "tax_basis",
      passed: passes,
      expected: "Both net and gross infer as quantity:money:unknown:unknown to block direct binding",
      observed: `netType=${netType}, grossType=${grossType}`,
      vulnerability: passes ? null : "Gross amount bound to Net amount without tax calculation",
      detail: "Checks that basis words 'gross' and 'net' retain unknown basis to prevent silent tax conflation.",
    });
  }

  // -------------------------------------------------------------------------
  // CASE A6: Deceptive Metadata (Field Name 'amount_cents' with Description 'in dollars')
  // -------------------------------------------------------------------------
  {
    // Adversarial schema deception: property is named "amount_cents", but description says "Amount in US dollars, not cents".
    const deceptiveType = inferType("amount_cents", { type: "number", description: "Taxable amount in US dollars, not cents" });
    // In quantities.ts: line 13 checks negative lookahead / negation.
    // Does inferType get confused and pick minor because of 'cents' in the name?
    const passes = deceptiveType === "quantity:money:USD:major" || deceptiveType === "quantity:money:USD:unknown";
    results.push({
      id: "SEM-ADV-06",
      name: "Deceptive Metadata: Name 'cents' vs Description 'in dollars, not cents'",
      category: "metadata_conflict",
      passed: passes,
      expected: "Must recognize negation 'not cents' and classify as major or unknown, NOT minor",
      observed: `deceptiveType=${deceptiveType}`,
      vulnerability: deceptiveType === "quantity:money:USD:minor" ? "Misclassified as cents due to token in parameter name despite explicit negation in description" : null,
      detail: "Checks if name tokens override natural language negation in OpenAPI description.",
    });
  }

  // -------------------------------------------------------------------------
  // CASE A7: Precision Loss / Non-Integer Minor Units
  // -------------------------------------------------------------------------
  {
    // In finance, cents must be integers. A division $100 / 3 = 33.3333333...
    let nonIntegerRejected = false;
    try {
      convertMoney(33.333, "USD", "minor", "major");
      // Wait: minor units MUST be integers per quantities.ts:52
    } catch (e: any) {
      if (/integer/.test(e.message)) nonIntegerRejected = true;
    }

    let precisionLossRejected = false;
    try {
      // Trying to convert an amount that would lose precision
      convertMoney("1.0000000000000001", "USD", "major", "minor");
    } catch (e: any) {
      precisionLossRejected = true;
    }

    const passes = nonIntegerRejected;
    results.push({
      id: "SEM-ADV-07",
      name: "Financial Precision: Non-Integer Minor Unit Rejection",
      category: "precision_loss",
      passed: passes,
      expected: "convertMoney rejects non-integer minor units",
      observed: `nonIntegerRejected=${nonIntegerRejected}, precisionLossRejected=${precisionLossRejected}`,
      vulnerability: nonIntegerRejected ? null : "Fractional minor units accepted, risking roundoff leakage",
      detail: "Verifies that financial conversions reject fractional cents.",
    });
  }

  return results;
}
