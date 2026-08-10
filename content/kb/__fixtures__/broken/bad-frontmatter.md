This file intentionally has no frontmatter block at all, so parseKbDocument
throws immediately. It exists only to prove that loadCorpus's error names the
offending FILE PATH, not a bare parser message with no idea which document
failed. Kept in its own directory (__fixtures__/broken/) so it never lands in
loadCorpus(KB_FIXTURES_DIR) and takes the whole fixture suite down with it.
