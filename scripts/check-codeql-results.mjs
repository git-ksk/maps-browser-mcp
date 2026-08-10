import fs from "node:fs/promises";
import path from "node:path";

const sarifDir = process.argv[2];
if (!sarifDir) throw new Error("SARIF directory argument is required");

async function collectSarifFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectSarifFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".sarif")) files.push(fullPath);
  }
  return files;
}

function annotationEscape(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

const files = await collectSarifFiles(sarifDir);
if (files.length === 0) throw new Error(`No SARIF files found in ${sarifDir}`);

const findings = [];
for (const file of files) {
  const sarif = JSON.parse(await fs.readFile(file, "utf8"));
  for (const run of sarif.runs ?? []) {
    for (const result of run.results ?? []) {
      const location = result.locations?.[0]?.physicalLocation;
      findings.push({
        ruleId: result.ruleId ?? "unknown-rule",
        level: result.level ?? "unknown",
        message: result.message?.text ?? "CodeQL finding",
        file: location?.artifactLocation?.uri,
        line: location?.region?.startLine
      });
    }
  }
}

if (findings.length > 0) {
  console.error(`CodeQL reported ${findings.length} finding(s):`);
  for (const finding of findings.slice(0, 20)) {
    console.error(`- [${finding.level}] ${finding.ruleId}: ${finding.message}`);
    const location = finding.file
      ? ` file=${annotationEscape(finding.file)}${Number.isInteger(finding.line) ? `,line=${finding.line}` : ""}`
      : "";
    console.error(`::error${location},title=${annotationEscape(`CodeQL ${finding.ruleId}`)}::${annotationEscape(finding.message)}`);
  }
  if (findings.length > 20) console.error(`- ...and ${findings.length - 20} more`);
  process.exit(1);
}

console.log("CodeQL SARIF gate passed: 0 findings");
