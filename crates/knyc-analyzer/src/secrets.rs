//! Secret guard: secret files are never copied; secret-looking lines in kept files are reported
//! so they can be redacted before anything is sent to an AI provider.

use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

/// Files that are secrets by name. Matched against the file name, case-insensitively.
pub fn is_secret_file(file_name: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    // Templates are meant to be shared.
    if [".env.example", ".env.sample", ".env.template", ".env.dist"].contains(&name.as_str()) {
        return false;
    }
    name == ".env"
        || name.starts_with(".env.")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name.starts_with("id_ecdsa")
        || [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kdbx"]
            .iter()
            .any(|ext| name.ends_with(ext))
        || [
            ".npmrc",
            ".pypirc",
            ".netrc",
            "credentials.json",
            "service-account.json",
        ]
        .contains(&name.as_str())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretLine {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    pub kind: &'static str,
}

static PATTERNS: LazyLock<Vec<(&'static str, Regex)>> = LazyLock::new(|| {
    [
        ("private-key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        ("aws-access-key", r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
        ("anthropic-key", r"\bsk-ant-[A-Za-z0-9_-]{20,}"),
        ("openai-key", r"\bsk-(proj-)?[A-Za-z0-9]{32,}"),
        ("github-token", r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}"),
        ("slack-token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
        ("google-api-key", r"\bAIza[0-9A-Za-z_-]{35}\b"),
        ("stripe-key", r"\b(sk|rk)_live_[A-Za-z0-9]{20,}"),
        (
            "connection-string",
            r"\b[a-z+]+://[^\s:/@]+:[^\s:/@]{6,}@[^\s/]+",
        ),
    ]
    .into_iter()
    .map(|(kind, pattern)| (kind, Regex::new(pattern).expect("valid secret regex")))
    .collect()
});

/// Lines of `content` that look like credentials.
pub fn find_secret_lines(path: &str, content: &str) -> Vec<SecretLine> {
    content
        .lines()
        .enumerate()
        .filter_map(|(i, line)| {
            PATTERNS
                .iter()
                .find(|(_, re)| re.is_match(line))
                .map(|(kind, _)| SecretLine {
                    path: path.to_string(),
                    line: i + 1,
                    kind,
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_files_by_name() {
        for name in [
            ".env",
            ".env.local",
            ".ENV.production",
            "server.key",
            "cert.pem",
            "id_rsa",
            "id_ed25519.pub",
            ".npmrc",
        ] {
            assert!(is_secret_file(name), "{name} should be secret");
        }
        for name in [
            ".env.example",
            "env.ts",
            "keyboard.ts",
            "package.json",
            "monkey.json",
        ] {
            assert!(!is_secret_file(name), "{name} should not be secret");
        }
    }

    #[test]
    fn secret_lines_in_content() {
        let content = "const a = 1;\nconst key = \"AKIAABCDEFGHIJKLMNOP\";\nconst db = \"postgres://admin:hunter22@db:5432/app\";\n// sk-ant-api03-abcdefghijklmnopqrstuvwxyz\nconst ok = \"sk-short\";\n";
        let found = find_secret_lines("src/config.ts", content);
        let kinds: Vec<_> = found.iter().map(|s| (s.line, s.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                (2, "aws-access-key"),
                (3, "connection-string"),
                (4, "anthropic-key")
            ]
        );
    }

    #[test]
    fn private_key_block() {
        let found = find_secret_lines("k.txt", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "private-key");
    }
}
