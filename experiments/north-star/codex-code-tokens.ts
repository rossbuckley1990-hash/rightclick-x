// Parse recorded Code Mode as data only; emit syntax facts for the Python checker.
// No evaluation, product imports or imports of the session auditor.
import ts from "typescript";
import { readFileSync } from "node:fs";
const records = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
const result = [];
for (const { payload: call } of records) {
  if (!["function_call", "custom_tool_call"].includes(call.type) || !["exec", "functions.exec"].includes(call.name)) continue;
  const source = ts.createSourceFile("recorded.js", call.input ?? call.arguments, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const facts: any[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) facts.push({ identifier: node.text, propertyObject: ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node, propertyName: ts.isPropertyAccessExpression(node.parent) ? node.parent.name.text : null });
    if (node.kind === ts.SyntaxKind.ImportKeyword || ts.isImportDeclaration(node)) facts.push({ import: true });
    if (ts.isPropertyAccessExpression(node)) facts.push({ propertyAccess: node.name.text });
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) facts.push({ elementAccess: node.argumentExpression.text });
    ts.forEachChild(node, visit);
  };
  visit(source);
  result.push({ callId: call.call_id, parseErrors: (source as any).parseDiagnostics.length, facts });
}
console.log(JSON.stringify(result));
