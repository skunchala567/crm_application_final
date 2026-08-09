/* A deliberately small DAX-like language. It never executes generated code or SQL. */
export const CALCULATION_FUNCTIONS = [
  ["Aggregation", "SUM", "SUM(field)", "Adds values in the active filter context."],
  ["Aggregation", "AVERAGE", "AVERAGE(field)", "Returns the arithmetic mean."],
  ["Aggregation", "MIN", "MIN(field)", "Returns the smallest value."],
  ["Aggregation", "MAX", "MAX(field)", "Returns the largest value."],
  ["Aggregation", "COUNT", "COUNT(field)", "Counts non-blank values."],
  ["Aggregation", "COUNTA", "COUNTA(field)", "Counts non-blank values of any type."],
  ["Aggregation", "DISTINCTCOUNT", "DISTINCTCOUNT(field)", "Counts unique non-blank values."],
  ["Logical", "IF", "IF(condition, valueIfTrue, valueIfFalse)", "Returns one of two values."],
  ["Logical", "SWITCH", "SWITCH(expression, value, result, else)", "Matches an expression to a result."],
  ["Logical", "AND", "AND(condition1, condition2)", "True when every condition is true."],
  ["Logical", "OR", "OR(condition1, condition2)", "True when any condition is true."],
  ["Logical", "NOT", "NOT(condition)", "Reverses a condition."],
  ["Mathematical", "DIVIDE", "DIVIDE(numerator, denominator, alternateResult)", "Safe division."],
  ["Mathematical", "ROUND", "ROUND(number, digits)", "Rounds to a number of digits."],
  ["Mathematical", "ROUNDUP", "ROUNDUP(number, digits)", "Rounds away from zero."],
  ["Mathematical", "ROUNDDOWN", "ROUNDDOWN(number, digits)", "Rounds toward zero."],
  ["Mathematical", "ABS", "ABS(number)", "Returns an absolute value."],
  ["Information", "ISBLANK", "ISBLANK(value)", "Tests null and empty values."],
  ["Information", "COALESCE", "COALESCE(value, alternate)", "Returns the first non-blank value."],
  ["Text", "CONCATENATE", "CONCATENATE(text1, text2)", "Joins text."],
  ["Text", "CONTAINSSTRING", "CONTAINSSTRING(text, search)", "Case-insensitive text search."],
  ["Text", "STARTSWITH", "STARTSWITH(text, search)", "Tests the start of text."],
  ["Text", "ENDSWITH", "ENDSWITH(text, search)", "Tests the end of text."],
  ["Text", "UPPER", "UPPER(text)", "Converts text to uppercase."],
  ["Text", "LOWER", "LOWER(text)", "Converts text to lowercase."],
  ["Text", "TRIM", "TRIM(text)", "Removes surrounding whitespace."],
  ["Text", "LEN", "LEN(text)", "Returns text length."],
  ["Date & Time", "TODAY", "TODAY()", "Returns today in local application time."],
  ["Date & Time", "NOW", "NOW()", "Returns the current date and time."],
  ["Date & Time", "DATE", "DATE(year, month, day)", "Creates a local date."],
  ["Date & Time", "YEAR", "YEAR(date)", "Returns the year."],
  ["Date & Time", "MONTH", "MONTH(date)", "Returns the month."],
  ["Date & Time", "DAY", "DAY(date)", "Returns the day of month."],
  ["Date & Time", "DATEDIFF", "DATEDIFF(start, end, unit)", "Returns a date difference."],
  ["Filter", "CALCULATE", "CALCULATE(expression, condition, ...)", "Evaluates with additional narrowing filters."],
  ["Filter", "FILTER", "FILTER(table, condition)", "Builds a filtered record context."],
].map(([category, name, signature, description]) => ({ category, name, signature, description }));

const AGGREGATES = new Set(["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "DISTINCTCOUNT"]);
const PRECEDENCE = { OR: 1, "||": 1, AND: 2, "&&": 2, IN: 3, "NOT IN": 3, "=": 3, "==": 3, "!=": 3, "<>": 3, ">": 3, "<": 3, ">=": 3, "<=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 };
const blank = value => value === null || value === undefined || value === "";
const text = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase();
const number = value => Number(value) || 0;

export function tokenizeFormula(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i += 1; continue; }
    const start = i;
    if (source[i] === "[") {
      i += 1; let value = "";
      while (i < source.length && source[i] !== "]") value += source[i++];
      if (source[i] !== "]") throw new SyntaxError(`Unclosed field bracket at character ${start + 1}.`);
      i += 1; tokens.push({ type: "field", value: value.trim(), start, end: i }); continue;
    }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i++]; let value = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) { i += 1; value += source[i++]; } else value += source[i++];
      }
      if (source[i] !== quote) throw new SyntaxError(`Unclosed text value at character ${start + 1}.`);
      i += 1; tokens.push({ type: "string", value, start, end: i }); continue;
    }
    const numeric = source.slice(i).match(/^\d+(?:\.\d+)?/);
    if (numeric) { i += numeric[0].length; tokens.push({ type: "number", value: Number(numeric[0]), start, end: i }); continue; }
    const identifier = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) { i += identifier[0].length; tokens.push({ type: "identifier", value: identifier[0].toUpperCase(), raw: identifier[0], start, end: i }); continue; }
    const op = [">=", "<=", "!=", "==", "<>", "&&", "||"].find(item => source.startsWith(item, i)) || ("+-*/%=><(),{}".includes(source[i]) ? source[i] : null);
    if (!op) throw new SyntaxError(`Unexpected '${source[i]}' at character ${i + 1}.`);
    i += op.length; tokens.push({ type: "symbol", value: op, start, end: i });
  }
  tokens.push({ type: "eof", value: "", start: i, end: i });
  return tokens;
}

export function parseFormula(source) {
  const tokens = tokenizeFormula(String(source || "")); let position = 0;
  const peek = (offset = 0) => tokens[position + offset];
  const take = () => tokens[position++];
  const expect = value => { const token = take(); if (token.value !== value) throw new SyntaxError(`Expected '${value}' at character ${token.start + 1}.`); return token; };
  function primary() {
    const token = take();
    if (token.type === "number" || token.type === "string") return { type: "literal", value: token.value };
    if (token.type === "field") return { type: "field", name: token.value };
    if (token.value === "(") { const node = expression(0); expect(")"); return node; }
    if (token.value === "{") { const values = []; if (peek().value !== "}") do { values.push(expression(0)); if (peek().value !== ",") break; take(); } while (true); expect("}"); return { type: "set", values }; }
    if (["-", "+"].includes(token.value) || (token.type === "identifier" && token.value === "NOT")) return { type: "unary", operator: token.value, argument: primary() };
    if (token.type === "identifier") {
      if (["TRUE", "FALSE", "BLANK", "NULL"].includes(token.value)) return { type: "literal", value: token.value === "TRUE" ? true : token.value === "FALSE" ? false : null };
      if (peek().value === "(") {
        take(); const args = [];
        if (peek().value !== ")") do { args.push(expression(0)); if (peek().value !== ",") break; take(); } while (true);
        expect(")"); return { type: "call", name: token.value, args };
      }
      return { type: "identifier", name: token.value };
    }
    throw new SyntaxError(`Expected a value at character ${token.start + 1}.`);
  }
  function expression(minimum) {
    let left = primary();
    while (true) {
      let operator = peek().value;
      if (operator === "NOT" && peek(1).value === "IN") operator = "NOT IN";
      const precedence = PRECEDENCE[operator];
      if (!precedence || precedence <= minimum) break;
      take(); if (operator === "NOT IN") take();
      left = { type: "binary", operator, left, right: expression(precedence) };
    }
    return left;
  }
  if (!String(source || "").trim()) throw new SyntaxError("Formula is required.");
  const ast = expression(0);
  if (peek().type !== "eof") throw new SyntaxError(`Unexpected '${peek().raw || peek().value}' at character ${peek().start + 1}.`);
  return ast;
}

function fieldValue(record, name, context) {
  const normalized = text(name);
  const calculated = context.calculatedFields?.find(item => text(item.name) === normalized || text(item.id) === normalized);
  if (calculated) {
    if (context.stack?.includes(calculated.id)) throw new Error(`Circular dependency detected: ${[...context.stack, calculated.id].join(" → ")}`);
    return evaluateFormula(calculated.formula, { ...context, record, stack: [...(context.stack || []), calculated.id] });
  }
  const definition = context.fields?.find(item => text(item.label) === normalized || text(item.id) === normalized);
  if (!definition) return undefined;
  if (context.allowedFieldIds && !context.allowedFieldIds.has(definition.id)) throw new Error(`You do not have permission to use [${definition.label}].`);
  const value = context.getFieldValue ? context.getFieldValue(record, definition.id) : record?.[definition.id];
  if (["date", "datetime", "date & time"].includes(String(definition.type).toLowerCase()) && !blank(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return String(definition.type).toLowerCase() === "date" ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : date;
  }
  return value;
}

function evaluate(node, context) {
  if (node.type === "literal") return node.value;
  if (node.type === "identifier") return node.name;
  if (node.type === "field") return fieldValue(context.record, node.name, context);
  if (node.type === "set") return node.values.map(item => evaluate(item, context));
  if (node.type === "unary") { const value = evaluate(node.argument, context); return node.operator === "NOT" ? !value : node.operator === "-" ? -number(value) : number(value); }
  if (node.type === "binary") {
    if (["AND", "&&"].includes(node.operator)) return Boolean(evaluate(node.left, context)) && Boolean(evaluate(node.right, context));
    if (["OR", "||"].includes(node.operator)) return Boolean(evaluate(node.left, context)) || Boolean(evaluate(node.right, context));
    const left = evaluate(node.left, context); const right = evaluate(node.right, context);
    if (node.operator === "+") return left instanceof Date || right instanceof Date ? new Date(new Date(left).getTime() + number(right) * 86400000) : number(left) + number(right);
    if (node.operator === "-") return left instanceof Date ? new Date(left.getTime() - number(right) * 86400000) : number(left) - number(right);
    if (node.operator === "*") return number(left) * number(right);
    if (node.operator === "/") return number(right) ? number(left) / number(right) : null;
    if (node.operator === "%") return number(right) ? number(left) % number(right) : null;
    if (["=", "==", "!=", "<>"].includes(node.operator)) {
      let equal;
      if (left instanceof Date || right instanceof Date) {
        const leftDate = new Date(left); const rightDate = new Date(right);
        const dateOnly = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
        const dateKey = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
        equal = !Number.isNaN(leftDate.getTime()) && !Number.isNaN(rightDate.getTime()) && (dateOnly(left) || dateOnly(right) ? dateKey(leftDate) === dateKey(rightDate) : leftDate.getTime() === rightDate.getTime());
      } else equal = text(left) === text(right);
      return ["=", "=="].includes(node.operator) ? equal : !equal;
    }
    if (node.operator === "IN" || node.operator === "NOT IN") {
      const found = (Array.isArray(right) ? right : [right]).some(value => {
        if (!(left instanceof Date) && !(value instanceof Date)) return text(value) === text(left);
        const leftDate = new Date(left); const valueDate = new Date(value);
        if (Number.isNaN(leftDate.getTime()) || Number.isNaN(valueDate.getTime())) return false;
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return leftDate.getFullYear() === valueDate.getUTCFullYear() && leftDate.getMonth() + 1 === valueDate.getUTCMonth() + 1 && leftDate.getDate() === valueDate.getUTCDate();
        return leftDate.getTime() === valueDate.getTime();
      });
      return node.operator === "IN" ? found : !found;
    }
    const dateComparison = left instanceof Date || right instanceof Date;
    const a = dateComparison ? new Date(left).getTime() : Number.isNaN(Number(left)) ? text(left) : Number(left);
    const b = dateComparison ? new Date(right).getTime() : Number.isNaN(Number(right)) ? text(right) : Number(right);
    return node.operator === ">" ? a > b : node.operator === "<" ? a < b : node.operator === ">=" ? a >= b : a <= b;
  }
  if (node.type !== "call") return null;
  const name = node.name;
  if (name === "CALCULATE") {
    let rows = context.rows || [];
    for (const condition of node.args.slice(1)) {
      if (condition.type === "call" && condition.name === "FILTER") {
        const allowed = new Set(evaluate(condition, { ...context, rows }));
        rows = rows.filter(record => allowed.has(record));
      } else rows = rows.filter(record => Boolean(evaluate(condition, { ...context, rows, record })));
    }
    return evaluate(node.args[0], { ...context, rows, record: rows[0] });
  }
  if (name === "FILTER") {
    const condition = node.args[node.args.length - 1];
    return (context.rows || []).filter(record => Boolean(evaluate(condition, { ...context, record })));
  }
  if (AGGREGATES.has(name)) {
    const rows = context.rows || (context.record ? [context.record] : []);
    const values = rows.map(record => evaluate(node.args[0], { ...context, record })).filter(value => !blank(value));
    if (name === "COUNT" || name === "COUNTA") return values.length;
    if (name === "DISTINCTCOUNT") return new Set(values.map(text)).size;
    const valuesAsNumbers = values.map(number);
    if (name === "AVERAGE") return valuesAsNumbers.length ? valuesAsNumbers.reduce((a, b) => a + b, 0) / valuesAsNumbers.length : null;
    if (name === "MIN") return valuesAsNumbers.length ? Math.min(...valuesAsNumbers) : null;
    if (name === "MAX") return valuesAsNumbers.length ? Math.max(...valuesAsNumbers) : null;
    return valuesAsNumbers.reduce((a, b) => a + b, 0);
  }
  const args = node.args.map(arg => evaluate(arg, context));
  if (name === "IF") return args[0] ? args[1] : args[2];
  if (name === "AND") return args.every(Boolean); if (name === "OR") return args.some(Boolean); if (name === "NOT") return !args[0];
  if (name === "DIVIDE") return number(args[1]) ? number(args[0]) / number(args[1]) : (args[2] ?? null);
  if (name === "ABS") return Math.abs(number(args[0]));
  if (["ROUND", "ROUNDUP", "ROUNDDOWN"].includes(name)) { const factor = 10 ** number(args[1]); const value = number(args[0]) * factor; return (name === "ROUND" ? Math.round(value) : name === "ROUNDUP" ? (value < 0 ? Math.floor(value) : Math.ceil(value)) : (value < 0 ? Math.ceil(value) : Math.floor(value))) / factor; }
  if (name === "ISBLANK") return blank(args[0]); if (name === "COALESCE") return args.find(value => !blank(value)) ?? null;
  if (name === "CONCATENATE") return args.map(value => String(value ?? "")).join("");
  if (name === "CONTAINSSTRING") return text(args[0]).includes(text(args[1])); if (name === "STARTSWITH") return text(args[0]).startsWith(text(args[1])); if (name === "ENDSWITH") return text(args[0]).endsWith(text(args[1]));
  if (name === "UPPER") return String(args[0] ?? "").toLocaleUpperCase(); if (name === "LOWER") return String(args[0] ?? "").toLocaleLowerCase(); if (name === "TRIM") return String(args[0] ?? "").trim(); if (name === "LEN") return String(args[0] ?? "").length;
  if (name === "TODAY") { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); } if (name === "NOW") return new Date();
  if (name === "DATE") return new Date(number(args[0]), number(args[1]) - 1, number(args[2]));
  if (["YEAR", "MONTH", "DAY"].includes(name)) { const date = new Date(args[0]); return name === "YEAR" ? date.getFullYear() : name === "MONTH" ? date.getMonth() + 1 : date.getDate(); }
  if (name === "DATEDIFF") { const delta = new Date(args[1]).getTime() - new Date(args[0]).getTime(); const divisor = { DAY: 86400000, HOUR: 3600000, MINUTE: 60000, SECOND: 1000, MONTH: 2629800000, YEAR: 31557600000 }[String(args[2]).toUpperCase()] || 86400000; return Math.trunc(delta / divisor); }
  if (name === "SWITCH") { for (let i = 1; i + 1 < args.length; i += 2) if (text(args[0]) === text(args[i])) return args[i + 1]; return args.length % 2 === 0 ? args[args.length - 1] : null; }
  throw new Error(`Unknown function: ${name}.`);
}

export function evaluateFormula(formulaOrAst, context = {}) { return evaluate(typeof formulaOrAst === "string" ? parseFormula(formulaOrAst) : formulaOrAst, context); }

function walk(node, visitor) { visitor(node); if (node.left) walk(node.left, visitor); if (node.right) walk(node.right, visitor); if (node.argument) walk(node.argument, visitor); (node.args || node.values || []).forEach(item => walk(item, visitor)); }
export function validateFormula(formula, { fields = [], calculatedFields = [], calculationType = "row" } = {}) {
  const errors = []; let ast;
  try { ast = parseFormula(formula); } catch (error) { return { valid: false, errors: [error.message], dependencies: [] }; }
  const names = new Map([...fields.map(field => [text(field.label), field]), ...fields.map(field => [text(field.id), field]), ...calculatedFields.map(field => [text(field.name), field])]);
  const functions = new Set(CALCULATION_FUNCTIONS.map(item => item.name)); const dependencies = [];
  walk(ast, node => {
    if (node.type === "field") { const definition = names.get(text(node.name)); if (!definition) errors.push(`Unknown field: [${node.name}].`); else dependencies.push(definition.id); }
    if (node.type === "call" && !functions.has(node.name)) errors.push(`Unknown function: ${node.name}.`);
    if (calculationType === "row" && node.type === "call" && (AGGREGATES.has(node.name) || ["CALCULATE", "FILTER"].includes(node.name))) errors.push(`${node.name} is only available in measures.`);
  });
  return { valid: !errors.length, errors: [...new Set(errors)], ast, dependencies: [...new Set(dependencies)] };
}

export function detectCircularDependency(candidate, calculatedFields = []) {
  const all = [...calculatedFields.filter(item => item.id !== candidate.id), candidate]; const byName = new Map(all.map(item => [text(item.name), item]));
  const graph = new Map(all.map(item => { const refs = []; try { walk(parseFormula(item.formula), node => { if (node.type === "field" && byName.has(text(node.name))) refs.push(byName.get(text(node.name)).id); }); } catch {} return [item.id, refs]; }));
  const visit = (id, path = []) => { if (path.includes(id)) return [...path.slice(path.indexOf(id)), id]; for (const next of graph.get(id) || []) { const cycle = visit(next, [...path, id]); if (cycle) return cycle; } return null; };
  const cycle = visit(candidate.id); return cycle ? cycle.map(id => all.find(item => item.id === id)?.name || id) : null;
}
