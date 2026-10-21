//! Recognises the prompts Git and OpenSSH send to an askpass helper, so the dialog can say
//! what is being asked for. Anything unrecognised is shown as-is and treated as a secret.

use serde::Serialize;
use ts_rs::TS;

/// What a prompt asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AskpassKind {
    /// Git: `Username for 'https://host': `.
    Username,
    /// Git: `Password for 'https://user@host': `; ssh: `user@host's password: `.
    Password,
    /// ssh: `Enter passphrase for key '/path': ` (also FIDO PINs).
    Passphrase,
    /// ssh: first connection to a server; answered "yes" or cancelled.
    HostKey,
    /// ssh-agent asks to allow a key use (`SSH_ASKPASS_PROMPT=confirm`); "yes" allows.
    Confirm,
    /// ssh shows a message without wanting an answer (`SSH_ASKPASS_PROMPT=none`, e.g.
    /// "touch your security key"); it closes the helper when done.
    Notice,
    Other,
}

/// A classified prompt: the kind plus what could be read out of the text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classified {
    pub kind: AskpassKind,
    /// Server the credential is for, e.g. `github.com` or `[git.example.com]:2222`.
    pub host: Option<String>,
    /// Username (password prompts), key path (passphrase) or fingerprint (host key).
    pub detail: Option<String>,
    /// Whether the answer must be masked.
    pub secret: bool,
}

/// Classifies `prompt`; `hint` is ssh's `SSH_ASKPASS_PROMPT`, if set.
pub fn classify(prompt: &str, hint: Option<&str>) -> Classified {
    let text = prompt.trim();
    let lower = text.to_lowercase();
    let make = |kind, host: Option<&str>, detail: Option<&str>, secret| Classified {
        kind,
        host: host.map(str::to_owned).filter(|s| !s.is_empty()),
        detail: detail.map(str::to_owned).filter(|s| !s.is_empty()),
        secret,
    };

    match hint {
        Some("confirm") => return make(AskpassKind::Confirm, None, None, false),
        Some("none") => return make(AskpassKind::Notice, None, None, false),
        _ => {}
    }

    if text.contains("continue connecting") {
        let host = quoted_after(text, "host '")
            .or_else(|| quoted_after(text, "for '"))
            .map(|h| h.split(" (").next().unwrap_or(h));
        let fingerprint = text
            .lines()
            .find_map(|l| l.split_once("fingerprint is "))
            .map(|(_, f)| f.trim().trim_end_matches('.'));
        return make(AskpassKind::HostKey, host, fingerprint, false);
    }
    if let Some(url) = git_prompt(text, "Username for '") {
        return make(AskpassKind::Username, Some(url_host(url)), None, false);
    }
    if let Some(url) = git_prompt(text, "Password for '") {
        return make(
            AskpassKind::Password,
            Some(url_host(url)),
            url_user(url),
            true,
        );
    }
    if lower.starts_with("enter passphrase") || lower.starts_with("enter pin") {
        let detail = quoted_after(text, "'").or_else(|| {
            text.split_once(" for ")
                .map(|(_, rest)| rest.trim_end_matches(':').trim())
        });
        return make(AskpassKind::Passphrase, None, detail, true);
    }
    // ssh: `user@host's password: ` and keyboard-interactive `(user@host) Password: `.
    let user_at_host = text
        .strip_suffix("'s password:")
        .or_else(|| {
            text.strip_prefix('(')
                .and_then(|r| r.split_once(") "))
                .filter(|(_, rest)| rest.eq_ignore_ascii_case("password:"))
                .map(|(inner, _)| inner)
        })
        .filter(|s| !s.contains('\n'));
    if let Some(user_at_host) = user_at_host {
        let (user, host) = match user_at_host.rsplit_once('@') {
            Some((user, host)) => (Some(user), Some(host)),
            None => (None, Some(user_at_host)),
        };
        return make(AskpassKind::Password, host, user, true);
    }
    if lower.contains("password") {
        return make(AskpassKind::Password, None, None, true);
    }
    if lower.starts_with("username") || lower.starts_with("user name") {
        return make(AskpassKind::Username, None, None, false);
    }
    make(AskpassKind::Other, None, None, true)
}

/// The URL in Git's `<label>'<url>': ` prompt.
fn git_prompt<'a>(text: &'a str, label: &str) -> Option<&'a str> {
    text.strip_prefix(label)?.strip_suffix("':")
}

/// The text between the quote that follows `marker` and the next quote.
fn quoted_after<'a>(text: &'a str, marker: &str) -> Option<&'a str> {
    let start = text.find(marker)? + marker.len();
    let rest = &text[start..];
    Some(&rest[..rest.find('\'')?])
}

/// `scheme://user@host:port/path` → `host:port`.
fn url_host(url: &str) -> &str {
    let authority = authority(url);
    authority.rsplit_once('@').map_or(authority, |(_, h)| h)
}

/// `scheme://user@host/path` → `user`.
fn url_user(url: &str) -> Option<&str> {
    authority(url).rsplit_once('@').map(|(u, _)| u)
}

fn authority(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    rest.split('/').next().unwrap_or(rest)
}

#[cfg(test)]
mod tests {
    use super::AskpassKind::*;
    use super::*;

    fn check(prompt: &str, kind: AskpassKind, host: Option<&str>, detail: Option<&str>) {
        let c = classify(prompt, None);
        assert_eq!(
            (c.kind, c.host.as_deref(), c.detail.as_deref()),
            (kind, host, detail),
            "{prompt:?}"
        );
    }

    #[test]
    fn git_https_prompts() {
        check(
            "Username for 'https://github.com': ",
            Username,
            Some("github.com"),
            None,
        );
        check(
            "Password for 'https://ada@github.com': ",
            Password,
            Some("github.com"),
            Some("ada"),
        );
        check(
            "Password for 'https://ada@git.example.com:8443/team/repo.git': ",
            Password,
            Some("git.example.com:8443"),
            Some("ada"),
        );
        check(
            "Password for 'https://github.com': ",
            Password,
            Some("github.com"),
            None,
        );
        assert!(!classify("Username for 'https://github.com': ", None).secret);
        assert!(classify("Password for 'https://a@b': ", None).secret);
    }

    #[test]
    fn ssh_passphrase_and_password() {
        check(
            "Enter passphrase for key '/home/ada/.ssh/id_ed25519': ",
            Passphrase,
            None,
            Some("/home/ada/.ssh/id_ed25519"),
        );
        check(
            "Enter passphrase for key 'C:\\Users\\Ada\\.ssh\\id_rsa': ",
            Passphrase,
            None,
            Some("C:\\Users\\Ada\\.ssh\\id_rsa"),
        );
        check(
            "Enter passphrase for /home/ada/.ssh/id_rsa:",
            Passphrase,
            None,
            Some("/home/ada/.ssh/id_rsa"),
        );
        check(
            "git@example.com's password: ",
            Password,
            Some("example.com"),
            Some("git"),
        );
        check(
            "(git@example.com) Password: ",
            Password,
            Some("example.com"),
            Some("git"),
        );
        check("Password: ", Password, None, None);
        assert!(classify("Enter passphrase for key '/k': ", None).secret);
        assert!(classify("ada@host's password: ", None).secret);
    }

    #[test]
    fn ssh_host_key() {
        let prompt = "The authenticity of host 'github.com (140.82.121.4)' can't be established.\n\
            ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.\n\
            This key is not known by any other names.\n\
            Are you sure you want to continue connecting (yes/no/[fingerprint])? ";
        check(
            prompt,
            HostKey,
            Some("github.com"),
            Some("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"),
        );
        assert!(!classify(prompt, None).secret);

        let port = "The authenticity of host '[git.example.com]:2222 ([10.0.0.5]:2222)' can't be \
            established.\nECDSA key fingerprint is SHA256:abc.\nAre you sure you want to \
            continue connecting (yes/no)? ";
        check(
            port,
            HostKey,
            Some("[git.example.com]:2222"),
            Some("SHA256:abc"),
        );

        let changed = "Warning: the ECDSA host key for 'example.com' differs from the key for \
            the IP address '1.2.3.4'\nOffending key for IP in /home/ada/.ssh/known_hosts:3\n\
            Are you sure you want to continue connecting (yes/no)? ";
        check(changed, HostKey, Some("example.com"), None);
    }

    #[test]
    fn hints_and_other() {
        assert_eq!(classify("Allow use of key?", Some("confirm")).kind, Confirm);
        assert_eq!(classify("Confirm user presence", Some("none")).kind, Notice);
        let other = classify("Verification code: ", None);
        assert_eq!((other.kind, other.secret), (Other, true));
        let user = classify("Username: ", None);
        assert_eq!((user.kind, user.secret), (Username, false));
        check("", Other, None, None);
    }
}
