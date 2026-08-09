import assert from "node:assert/strict";
import test from "node:test";
import { detectCircularDependency, evaluateFormula, parseFormula, validateFormula } from "./calculationEngine.js";

const fields = [
  { id: "quantity", label: "Quantity", type: "number" }, { id: "price", label: "Unit Price", type: "currency" },
  { id: "amount", label: "Amount", type: "currency" }, { id: "status", label: "Status", type: "text" },
  { id: "campus", label: "Campus", type: "text" }, { id: "created", label: "Created Date", type: "date" },
  { id: "email", label: "Email", type: "text" }, { id: "lead", label: "Lead ID", type: "text" },
];
const rows = [
  { quantity: 5, price: 2000, amount: 100000, status: "Won", campus: "Hyderabad", created: new Date(), email: "admin@school.edu", lead: "1" },
  { quantity: 2, price: 500, amount: 50000, status: "Closed", campus: "Bangalore", created: new Date(), email: "", lead: "2" },
  { quantity: 1, price: 100, amount: 9000, status: "Lost", campus: "Hyderabad", created: new Date("2020-01-01"), email: null, lead: "3" },
];
const context = { fields, rows, record: rows[0], getFieldValue: (record, id) => record[id] };

test("safe arithmetic and nested logical IF", () => {
  assert.equal(evaluateFormula("[Quantity] * [Unit Price]", context), 10000);
  assert.equal(evaluateFormula('IF([Amount] >= 80000 && [Status] = "Won", "Hot", "Cold")', context), "Hot");
});

test("aggregates, CALCULATE, IN and nested OR", () => {
  assert.equal(evaluateFormula("SUM([Amount])", context), 159000);
  assert.equal(evaluateFormula('CALCULATE(SUM([Amount]), [Status] IN {"Won", "Closed"})', context), 150000);
  assert.equal(evaluateFormula('CALCULATE(COUNT([Lead ID]), ([Campus] = "Hyderabad" || [Campus] = "Bangalore") && [Status] <> "Lost")', context), 2);
  assert.equal(evaluateFormula('DIVIDE(CALCULATE(COUNTA([Status]), [Status] = "Won"), COUNTA([Status]), 0)', context), 1 / 3);
});

test("FILTER, text, blank, division and relative dates", () => {
  assert.equal(evaluateFormula('CALCULATE(SUM([Amount]), FILTER(Opportunities, [Status] = "Won" && [Amount] > 50000))', context), 100000);
  assert.equal(evaluateFormula('CONTAINSSTRING([Email], "SCHOOL") && ENDSWITH([Email], ".edu")', context), true);
  assert.equal(evaluateFormula("DIVIDE(10, 0, 7)", context), 7);
  assert.equal(evaluateFormula("CALCULATE(COUNT([Lead ID]), [Created Date] >= TODAY() - 30)", context), 2);
  assert.equal(evaluateFormula("ISBLANK([Email])", { ...context, record: rows[1] }), true);
  assert.equal(evaluateFormula("[Created Date] = TODAY()", context), true);
  const today = new Date(); const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(evaluateFormula(`[Created Date] IN {"${todayKey}"}`, context), true);
});

test("validation and dependency cycles", () => {
  assert.equal(validateFormula("SUM([Amount])", { fields, calculationType: "row" }).valid, false);
  assert.match(validateFormula("[Lead Amunt]", { fields }).errors[0], /Unknown field/);
  const a = { id: "a", name: "Field A", formula: "[Field B] + 1" };
  const b = { id: "b", name: "Field B", formula: "[Field A] + 1" };
  assert.deepEqual(detectCircularDependency(b, [a]), ["Field B", "Field A", "Field B"]);
  assert.throws(() => parseFormula("[Amount] + (2"), /Expected/);
});
