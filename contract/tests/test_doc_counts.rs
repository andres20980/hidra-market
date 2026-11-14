// test_doc_counts.rs v1.3
// Locks the test counts quoted in contract/README.md, RULES.md and SECURITY.md to the real
// number of test functions, so a new test file cannot leave the docs stale.
use std::fs;
use std::path::Path;

// Returns (plain `#[test]`, `#[tokio::test]`) counts.
fn count_tests(src: &str) -> (usize, usize) {
    let attrs = || src.lines().map(str::trim_start).filter_map(|l| l.strip_prefix("#["));
    // Patterns split from "#[" so a plain grep of this file does not count them as tests.
    let plain = attrs().filter(|l| l.starts_with("test]")).count();
    let tokio = attrs().filter(|l| l.starts_with("tokio::test")).count();
    (plain, tokio)
}

struct Counts {
    unit: usize,
    files: usize,
    // `#[tokio::test]` in tests/: rounds played against a real near-sandbox node.
    sandbox: usize,
    // `#[test]` in tests/: near-sdk mock VM (`testing_env!`) or plain offline checks, no node.
    mock: usize,
}

fn real_counts() -> Counts {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let (plain, tokio) = count_tests(&fs::read_to_string(root.join("src/lib.rs")).unwrap());
    let mut c = Counts { unit: plain + tokio, files: 0, sandbox: 0, mock: 0 };
    for entry in fs::read_dir(root.join("tests")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            let (plain, tokio) = count_tests(&fs::read_to_string(&path).unwrap());
            c.files += 1;
            c.mock += plain;
            c.sandbox += tokio;
        }
    }
    c
}

#[test]
fn docs_quote_the_real_test_counts() {
    let Counts { unit, files, sandbox, mock } = real_counts();
    let integ = sandbox + mock;
    let total = unit + integ;
    let split = format!("{integ} integration tests across {files} files ({sandbox} near-sandbox + {mock} mock-VM)");
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let readme = fs::read_to_string(root.join("README.md")).unwrap();
    let rules = fs::read_to_string(root.join("../RULES.md")).unwrap();
    let security = fs::read_to_string(root.join("../SECURITY.md")).unwrap();

    let expected = [
        (
            "contract/README.md (Test)",
            &readme,
            format!("`cargo test` → {total} tests ({unit} unit + {split}"),
        ),
        (
            "contract/README.md (Tests)",
            &readme,
            format!("**{total}** ({unit} unit in `src/lib.rs` + {split}"),
        ),
        (
            "RULES.md (Tests)",
            &rules,
            format!("→ {total} ({unit} unit in `src/lib.rs` + {split}"),
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
