// CLI over lib/kb-check.ts, for checking the corpus without running the suite:
//   npx tsx scripts/kb-check.mts
// The same rules run inside lib/kb-corpus.test.ts, which is what actually gates
// CI. This exists for the authoring loop.
import { getCorpus } from "../lib/kb-corpus";
import { checkCorpus } from "../lib/kb-check";

const docs = getCorpus();
const problems = checkCorpus(docs);

console.log(`Checked ${docs.length} document(s) in content/kb/.`);
for (const p of problems) console.error(`  FAIL  ${p.slug}: ${p.problem}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s). Fix the corpus — this is not a warning.`);
  process.exit(1);
}
console.log("Corpus is clean.");
