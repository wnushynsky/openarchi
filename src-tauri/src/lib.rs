use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileEntry {
  name: String,
  relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceScanResult {
  directory_name: String,
  files: Vec<WorkspaceFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHistoryEntry {
  hash: String,
  short_hash: String,
  author: String,
  date: String,
  subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitFile {
  relative_path: String,
  content: String,
}

fn is_valid_model_file(name: &str) -> bool {
  let lower = name.to_ascii_lowercase();
  lower.ends_with(".archimate")
    || lower.ends_with(".xml")
    || lower.ends_with(".json")
    || lower.ends_with(".openarchi.md")
}

fn git_repo_context(directory_path: &str) -> Result<(PathBuf, String), String> {
  let output = Command::new("git")
    .args(["-C", directory_path, "rev-parse", "--show-toplevel"])
    .output()
    .map_err(|err| format!("Failed to resolve git root: {err}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Workspace is not inside a git repository".to_string()
    } else {
      stderr
    });
  }

  let repo_root = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim().to_string());
  let workspace = PathBuf::from(directory_path);
  let prefix = workspace
    .strip_prefix(&repo_root)
    .map(|path| normalize_relative_path(path))
    .unwrap_or_default();

  Ok((repo_root, prefix))
}

fn strip_workspace_prefix(path: &str, prefix: &str) -> Option<String> {
  let normalized = path.replace('\\', "/");
  if prefix.is_empty() {
    return Some(normalized);
  }
  let normalized_prefix = prefix.trim_matches('/');
  if normalized == normalized_prefix {
    return None;
  }
  normalized
    .strip_prefix(&format!("{normalized_prefix}/"))
    .map(|value| value.to_string())
}

fn add_workspace_prefix(path: &str, prefix: &str) -> String {
  if prefix.is_empty() {
    path.to_string()
  } else {
    format!("{}/{}", prefix.trim_matches('/'), path.trim_matches('/'))
  }
}

fn normalize_relative_path(path: &Path) -> String {
  path.components()
    .filter_map(|component| match component {
      Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
      _ => None,
    })
    .collect::<Vec<_>>()
    .join("/")
}

fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
  let path = Path::new(relative_path);
  if path.is_absolute() {
    return Err("Absolute paths are not allowed".to_string());
  }

  let mut normalized = PathBuf::new();
  for component in path.components() {
    match component {
      Component::Normal(value) => normalized.push(value),
      Component::CurDir => {}
      Component::ParentDir => {
        return Err("Parent directory traversal is not allowed".to_string());
      }
      Component::RootDir | Component::Prefix(_) => {
        return Err("Invalid relative path".to_string());
      }
    }
  }

  if normalized.as_os_str().is_empty() {
    return Err("Relative path is empty".to_string());
  }

  Ok(normalized)
}

fn resolve_workspace_path(directory_path: &str, relative_path: &str) -> Result<PathBuf, String> {
  let relative = validate_relative_path(relative_path)?;
  Ok(Path::new(directory_path).join(relative))
}

fn scan_workspace_directory(
  root: &Path,
  current: &Path,
  files: &mut Vec<WorkspaceFileEntry>,
) -> Result<(), String> {
  let entries = fs::read_dir(current).map_err(|err| format!("Failed to read directory: {err}"))?;

  for entry in entries {
    let entry = entry.map_err(|err| format!("Failed to read directory entry: {err}"))?;
    let path = entry.path();
    let file_type = entry.file_type().map_err(|err| format!("Failed to read file type: {err}"))?;

    if file_type.is_dir() {
      scan_workspace_directory(root, &path, files)?;
      continue;
    }

    if !file_type.is_file() {
      continue;
    }

    let name = entry.file_name().to_string_lossy().into_owned();
    if !is_valid_model_file(&name) {
      continue;
    }

    let relative_path = path
      .strip_prefix(root)
      .map_err(|err| format!("Failed to normalize workspace path: {err}"))?;

    files.push(WorkspaceFileEntry {
      name,
      relative_path: normalize_relative_path(relative_path),
    });
  }

  Ok(())
}

fn detect_git_branch_from_path(directory_path: &Path) -> Result<Option<String>, String> {
  let git_head_path = directory_path.join(".git").join("HEAD");
  if !git_head_path.exists() {
    return Ok(None);
  }

  let head = fs::read_to_string(&git_head_path)
    .map_err(|err| format!("Failed to read git HEAD: {err}"))?;
  let trimmed = head.trim();

  if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
    return Ok(Some(branch.to_string()));
  }

  if trimmed.len() == 40 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
    return Ok(Some(format!("{}...", &trimmed[..8])));
  }

  Ok(None)
}

#[tauri::command]
async fn pick_workspace_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let selected = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
    .await
    .map_err(|err| format!("Failed to join directory picker task: {err}"))?
    .map(|path| path.into_path())
    .transpose()
    .map_err(|err| format!("Failed to resolve selected directory: {err}"))?;

  Ok(selected.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn scan_workspace(directory_path: String) -> Result<WorkspaceScanResult, String> {
  let root = PathBuf::from(&directory_path);
  if !root.is_dir() {
    return Err("Selected workspace directory does not exist".to_string());
  }

  let mut files = Vec::new();
  scan_workspace_directory(&root, &root, &mut files)?;
  files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

  let directory_name = root
    .file_name()
    .map(|value| value.to_string_lossy().into_owned())
    .unwrap_or_else(|| directory_path.clone());

  Ok(WorkspaceScanResult {
    directory_name,
    files,
  })
}

#[tauri::command]
fn read_workspace_file(directory_path: String, relative_path: String) -> Result<String, String> {
  let path = resolve_workspace_path(&directory_path, &relative_path)?;
  fs::read_to_string(path).map_err(|err| format!("Failed to read file: {err}"))
}

#[tauri::command]
fn write_workspace_file(
  directory_path: String,
  relative_path: String,
  content: String,
) -> Result<(), String> {
  let path = resolve_workspace_path(&directory_path, &relative_path)?;
  #[cfg(debug_assertions)]
  eprintln!("[OpenArchi] write {}", path.display());
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|err| format!("Failed to create directory: {err}"))?;
  }
  fs::write(path, content).map_err(|err| format!("Failed to write file: {err}"))
}

#[tauri::command]
fn delete_workspace_file(directory_path: String, relative_path: String) -> Result<(), String> {
  let path = resolve_workspace_path(&directory_path, &relative_path)?;
  #[cfg(debug_assertions)]
  eprintln!("[OpenArchi] delete {}", path.display());
  match fs::remove_file(path) {
    Ok(()) => Ok(()),
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(err) => Err(format!("Failed to delete file: {err}")),
  }
}

#[tauri::command]
fn detect_git_branch(directory_path: String) -> Result<Option<String>, String> {
  detect_git_branch_from_path(Path::new(&directory_path))
}

#[tauri::command]
fn read_git_history(directory_path: String, limit: Option<usize>) -> Result<Vec<GitHistoryEntry>, String> {
  let limit = limit.unwrap_or(30).max(1).min(100);
  let output = Command::new("git")
    .args([
      "-C",
      &directory_path,
      "log",
      &format!("-n{limit}"),
      "--date=short",
      "--pretty=format:%H%x1f%h%x1f%ad%x1f%an%x1f%s%x1e",
    ])
    .output()
    .map_err(|err| format!("Failed to run git log: {err}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "git log failed".to_string()
    } else {
      stderr
    });
  }

  let stdout = String::from_utf8_lossy(&output.stdout);
  let mut commits = Vec::new();

  for record in stdout.split('\x1e') {
    let trimmed = record.trim();
    if trimmed.is_empty() {
      continue;
    }

    let parts: Vec<&str> = trimmed.split('\x1f').collect();
    if parts.len() < 5 {
      continue;
    }

    commits.push(GitHistoryEntry {
      hash: parts[0].to_string(),
      short_hash: parts[1].to_string(),
      date: parts[2].to_string(),
      author: parts[3].to_string(),
      subject: parts[4].to_string(),
    });
  }

  Ok(commits)
}

#[tauri::command]
fn read_git_changed_files(directory_path: String, commit: String) -> Result<Vec<String>, String> {
  let (repo_root, prefix) = git_repo_context(&directory_path)?;
  let output = Command::new("git")
    .args([
      "-C",
      &repo_root.to_string_lossy(),
      "show",
      "--pretty=format:",
      "--name-only",
      &commit,
    ])
    .output()
    .map_err(|err| format!("Failed to run git show: {err}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "git show failed".to_string()
    } else {
      stderr
    });
  }

  let files = String::from_utf8_lossy(&output.stdout)
    .lines()
    .map(str::trim)
    .filter(|line| !line.is_empty())
    .filter_map(|line| strip_workspace_prefix(line, &prefix))
    .collect::<Vec<_>>();

  Ok(files)
}

#[tauri::command]
fn read_git_model_snapshot(directory_path: String, commit: String) -> Result<Vec<GitCommitFile>, String> {
  let (repo_root, prefix) = git_repo_context(&directory_path)?;
  let repo_root_str = repo_root.to_string_lossy().into_owned();
  let output = Command::new("git")
    .args([
      "-C",
      &repo_root_str,
      "ls-tree",
      "-r",
      "--name-only",
      &commit,
    ])
    .output()
    .map_err(|err| format!("Failed to run git ls-tree: {err}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "git ls-tree failed".to_string()
    } else {
      stderr
    });
  }

  let mut files = Vec::new();
  for repo_relative_path in String::from_utf8_lossy(&output.stdout)
    .lines()
    .map(str::trim)
    .filter(|line| !line.is_empty())
  {
    let Some(workspace_relative_path) = strip_workspace_prefix(repo_relative_path, &prefix) else {
      continue;
    };
    if !is_valid_model_file(&workspace_relative_path) {
      continue;
    }

    let object_spec = format!("{}:{}", commit, add_workspace_prefix(&workspace_relative_path, &prefix));
    let file_output = Command::new("git")
      .args(["-C", &repo_root_str, "show", &object_spec])
      .output()
      .map_err(|err| format!("Failed to read git file '{workspace_relative_path}': {err}"))?;

    if !file_output.status.success() {
      let stderr = String::from_utf8_lossy(&file_output.stderr).trim().to_string();
      return Err(if stderr.is_empty() {
        format!("git show failed for '{workspace_relative_path}'")
      } else {
        stderr
      });
    }

    files.push(GitCommitFile {
      relative_path: workspace_relative_path.clone(),
      content: String::from_utf8_lossy(&file_output.stdout).into_owned(),
    });
  }

  files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
  Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      pick_workspace_directory,
      scan_workspace,
      read_workspace_file,
      write_workspace_file,
      delete_workspace_file,
      detect_git_branch,
      read_git_history,
      read_git_changed_files,
      read_git_model_snapshot
    ])
    .run(tauri::generate_context!())
    .expect("error while running OpenArchi");
}
