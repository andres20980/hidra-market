// test_doc_counts.rs v1.2
// Locks the test counts quoted in contract/README.md, RULES.md and SECURITY.md to the real
// number of test functions, so a new test file cannot leave the docs stale.
use std::fs;
use std::path::Path;

fn count_tests(src: &str) -> usize {
    src.lines()
        .map(str::trim_start)
        .filter_map(|l| l.strip_prefix("#["))
        // Patterns split from "#[" so a plain grep of this file does not count them as tests.
        .filter(|l| l.starts_with("test]") || l.starts_with("tokio::test"))
        .count()
}

fn real_counts() -> (usize, usize, usize) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let unit = count_tests(&fs::read_to_string(root.join("src/lib.rs")).unwrap());
    let mut integ = 0;
    let mut files = 0;
    for entry in fs::read_dir(root.join("tests")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            files += 1;
            integ += count_tests(&fs::read_to_string(&path).unwrap());
        }
    }
    (unit, integ, files)
}

#[test]
fn docs_quote_the_real_test_counts() {
    let (unit, integ, files) = real_counts();
    let total = unit + integ;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let readme = fs::read_to_string(root.join("README.md")).unwrap();
    let rules = fs::read_to_string(root.join("../RULES.md")).unwrap();
    let security = fs::read_to_string(root.join("../SECURITY.md")).unwrap();

    let expected = [
        (
            "contract/README.md (Test)",
            &readme,
            format!("`cargo test` → {total} tests ({unit} unit + {integ} near-sandbox integration across {files} files"),
        ),
        (
            "contract/README.md (Tests)",
            &readme,
            format!("**{total}** ({unit} unit in `src/lib.rs` + {integ} near-sandbox integration across {files} files"),
        ),
        (
            "RULES.md (Tests)",
            &rules,
            format!("→ {total} ({unit} unitarios en `src/lib.rs` + {integ} de integración near-sandbox en {files} ficheros"),
        ),
        (
            "SECURITY.md (cargo test --lib)",
            &security,
            format!("({unit} tests, all green)"),
        ),
    ];
    for (doc, text, phrase) in expected {
        assert!(text.contains(&phrase), "{doc} is stale: expected «{phrase}»");
    }
}
