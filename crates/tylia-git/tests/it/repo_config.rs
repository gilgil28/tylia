//! Repository settings (identity, SSH key, credentials, remotes) on temp repositories.

use crate::common::TestRepo;
use tylia_git::{ConfigScope, Git, GitError, UrlProtocol};

fn git() -> Git {
    Git::discover().expect("git must be installed to run the tests")
}

#[tokio::test]
async fn identity_is_set_and_removed_locally() {
    let r = TestRepo::new();
    // TestRepo sets a local identity; remove it to see the repository without one.
    git().set_identity(r.path(), None, None).await.unwrap();
    let config = git().repo_config(r.path()).await.unwrap();
    assert!(
        config
            .user_name
            .as_ref()
            .is_none_or(|v| v.scope != ConfigScope::Local)
    );

    git()
        .set_identity(r.path(), Some(" Ada Lovelace "), Some("ada@example.com"))
        .await
        .unwrap();
    let config = git().repo_config(r.path()).await.unwrap();
    let name = config.user_name.unwrap();
    assert_eq!(
        (name.value.as_str(), name.scope),
        ("Ada Lovelace", ConfigScope::Local)
    );
    assert_eq!(config.user_email.unwrap().value, "ada@example.com");

    // Blank removes; removing what isn't set is fine.
    git()
        .set_identity(r.path(), Some("  "), None)
        .await
        .unwrap();
    git().set_identity(r.path(), None, None).await.unwrap();
    assert!(!r.git_ok(&["config", "--local", "user.name"]));
}

#[tokio::test]
async fn ssh_key_writes_a_repository_ssh_command() {
    let r = TestRepo::new();
    let key = r.path().join("my key");
    std::fs::write(&key, "not really a key").unwrap();
    git().set_ssh_key(r.path(), Some(&key)).await.unwrap();

    let command = r.git(&["config", "--local", "core.sshCommand"]);
    assert!(command.starts_with("ssh -i '") && command.ends_with("' -o IdentitiesOnly=yes"));
    let config = git().repo_config(r.path()).await.unwrap();
    assert_eq!(
        config.ssh_key.as_deref(),
        Some(key.display().to_string().replace('\\', "/").as_str())
    );
    assert_eq!(config.ssh_command.unwrap().scope, ConfigScope::Local);

    git().set_ssh_key(r.path(), None).await.unwrap();
    assert!(!r.git_ok(&["config", "--local", "core.sshCommand"]));
    assert_eq!(git().repo_config(r.path()).await.unwrap().ssh_key, None);
}

#[tokio::test]
async fn ssh_key_refuses_public_keys_and_missing_files() {
    let r = TestRepo::new();
    let public = r.path().join("id_ed25519.pub");
    std::fs::write(&public, "ssh-ed25519 AAAA").unwrap();
    assert!(matches!(
        git().set_ssh_key(r.path(), Some(&public)).await,
        Err(GitError::InvalidInput(m)) if m.contains("public key")
    ));
    assert!(matches!(
        git()
            .set_ssh_key(r.path(), Some(&r.path().join("missing")))
            .await,
        Err(GitError::InvalidInput(_))
    ));
}

#[tokio::test]
async fn forgetting_credentials_erases_them_from_the_helper() {
    let r = TestRepo::new();
    let store = r.path().join("creds");
    let helper = format!(
        "store --file={}",
        store.display().to_string().replace('\\', "/")
    );
    // Only this repository's helper (an empty value first clears any global ones).
    r.git(&["config", "--local", "--add", "credential.helper", ""]);
    r.git(&["config", "--local", "--add", "credential.helper", &helper]);
    let approve = std::process::Command::new("git")
        .args(["credential", "approve"])
        .current_dir(r.path())
        .stdin(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(b"url=https://ada:tok123@git.example.com/team/app.git\n\n")?;
            child.wait()
        })
        .unwrap();
    assert!(approve.success());
    assert!(std::fs::read_to_string(&store).unwrap().contains("tok123"));

    let config = git().repo_config(r.path()).await.unwrap();
    assert_eq!(
        config.credential_helpers.len(),
        1,
        "the empty value cleared the list"
    );
    assert_eq!(config.credential_helpers[0].value, helper);

    git()
        .forget_credentials(r.path(), "https://git.example.com/team/app.git")
        .await
        .unwrap();
    assert!(!std::fs::read_to_string(&store).unwrap().contains("tok123"));

    assert!(matches!(
        git()
            .forget_credentials(r.path(), "git@git.example.com:team/app.git")
            .await,
        Err(GitError::InvalidInput(_))
    ));
}

#[tokio::test]
async fn remotes_with_protocol_and_alternate() {
    let r = TestRepo::new();
    r.git(&[
        "remote",
        "add",
        "origin",
        "https://github.com/tylia-dev/tylia.git",
    ]);
    r.git(&["remote", "add", "fork.mine", "git@github.com:ada/tylia.git"]);
    r.git(&[
        "remote",
        "set-url",
        "--push",
        "fork.mine",
        "git@github.com:ada/push.git",
    ]);
    let remotes = git().repo_config(r.path()).await.unwrap().remotes;
    assert_eq!(remotes.len(), 2);
    let origin = remotes.iter().find(|x| x.name == "origin").unwrap();
    assert_eq!(origin.protocol, UrlProtocol::Https);
    assert_eq!(
        origin.alternate_url.as_deref(),
        Some("git@github.com:tylia-dev/tylia.git")
    );
    let fork = remotes.iter().find(|x| x.name == "fork.mine").unwrap();
    assert_eq!(fork.protocol, UrlProtocol::Ssh);
    assert_eq!(
        fork.push_url.as_deref(),
        Some("git@github.com:ada/push.git")
    );
    assert_eq!(
        fork.alternate_url.as_deref(),
        Some("https://github.com/ada/tylia.git")
    );
}
