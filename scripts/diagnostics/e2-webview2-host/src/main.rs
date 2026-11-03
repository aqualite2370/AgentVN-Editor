use std::{
    env,
    path::{Component, Path, PathBuf},
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows};

struct Options {
    url: String,
    profile: PathBuf,
    debug_port: u16,
    graphite: bool,
}

fn parse_options(args: &[String]) -> Result<Options, String> {
    if args.len() != 3 && args.len() != 4 {
        return Err("Expected loopback URL, dedicated profile path and debug port.".into());
    }
    let graphite = match args.get(3).map(String::as_str) {
        None | Some("default") => false,
        Some("graphite") => true,
        _ => return Err("Renderer diagnostic must be default or graphite.".into()),
    };
    let address = args[0]
        .strip_prefix("http://127.0.0.1:")
        .ok_or("Diagnostic URL must be HTTP loopback.")?;
    let source_port = address.trim_end_matches('/');
    if source_port.parse::<u16>().unwrap_or(0) == 0
        || address != source_port && address != format!("{source_port}/")
    {
        return Err("Diagnostic URL must contain only a nonzero loopback port.".into());
    }
    let profile = PathBuf::from(&args[1]);
    let parent = profile.parent().ok_or("Missing profile parent.")?;
    if !profile.is_absolute()
        || profile.components().any(|part| matches!(part, Component::ParentDir))
        || !profile
            .file_name()
            .and_then(|part| part.to_str())
            .is_some_and(|part| part.starts_with("e2-webview2-profile-") && part.len() > 20)
        || parent.file_name() != Some("playwright".as_ref())
        || parent.parent().and_then(Path::file_name) != Some("output".as_ref())
    {
        return Err("Profile must be a dedicated absolute output/playwright/e2-webview2-profile-* path.".into());
    }
    let debug_port = args[2].parse::<u16>().map_err(|_| "Invalid debug port.")?;
    if debug_port == 0 || debug_port.to_string() == source_port {
        return Err("Debug port must be nonzero and separate from the source server.".into());
    }
    Ok(Options {
        url: args[0].clone(),
        profile,
        debug_port,
        graphite,
    })
}

fn assert_no_links(profile: &Path) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;
    let mut current = PathBuf::new();
    for component in profile.components() {
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_attributes() & 0x400 != 0 => {
                return Err("Diagnostic profile path contains a reparse point.".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = parse_options(&env::args().skip(1).collect::<Vec<_>>())?;
    assert_no_links(&options.profile)?;
    // Only the invoking diagnostic runner's child environment is changed.
    // The profile does not share any Editor, Codex or user WebView2 data.
    env::remove_var("WEBVIEW2_USER_DATA_FOLDER");
    env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    env::remove_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER");
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("AgentVN E2 WebView2 诊断（非 Dev/安装版验收）")
        .with_inner_size(LogicalSize::new(1920.0, 1080.0))
        .build(&event_loop)?;
    let mut context = WebContext::new(Some(options.profile));
    let browser_args = format!(
        "--remote-debugging-port={}{}",
        options.debug_port,
        if options.graphite { " --enable-features=SkiaGraphite" } else { "" }
    );
    let _webview = WebViewBuilder::new_with_web_context(&mut context)
        // CDP installs the isolated fixture before navigating the current
        // production frontend, just as the Chromium diagnostic does.
        .with_url("about:blank")
        .with_devtools(true)
        .with_additional_browser_args(browser_args)
        .build(&window)?;
    println!(
        "E2_WEBVIEW2_HOST_READY pid={} version={} source={}",
        std::process::id(),
        wry::webview_version()?,
        options.url
    );
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments() -> Vec<String> {
        vec![
            "http://127.0.0.1:51000".into(),
            "D:\\AgentVN\\output\\playwright\\e2-webview2-profile-isolated-contract".into(),
            "51001".into(),
        ]
    }

    #[test]
    fn accepts_only_isolated_loopback_diagnostic() {
        assert!(parse_options(&arguments()).is_ok());
    }

    #[test]
    fn rejects_remote_or_embedded_url_content() {
        for url in [
            "https://example.com",
            "http://127.0.0.1:0",
            "http://127.0.0.1:51000//",
            "http://127.0.0.1:51000/?secret=1",
            "http://127.0.0.1:51000/path",
        ] {
            let mut args = arguments();
            args[0] = url.into();
            assert!(parse_options(&args).is_err());
        }
    }

    #[test]
    fn rejects_shared_or_relative_profiles() {
        for profile in [
            "D:\\AgentVN\\data\\webview2-dev",
            "D:\\AgentVN\\output\\playwright",
            "D:\\AgentVN\\output\\playwright\\e2-webview2-profile-..\\..\\user",
            "output\\playwright\\e2-webview2-profile-isolated",
        ] {
            let mut args = arguments();
            args[1] = profile.into();
            assert!(parse_options(&args).is_err());
        }
    }

    #[test]
    fn rejects_conflicting_ports_and_missing_arguments() {
        let mut args = arguments();
        args[2] = "51000".into();
        assert!(parse_options(&args).is_err());
        args[2] = "0".into();
        assert!(parse_options(&args).is_err());
        assert!(parse_options(&args[..2]).is_err());
    }

    #[test]
    fn allows_only_the_named_graphite_diagnostic() {
        let mut args = arguments();
        args.push("graphite".into());
        assert!(parse_options(&args).is_ok());
        args[3] = "--disable-gpu --user-data-dir=C:\\Users\\1".into();
        assert!(parse_options(&args).is_err());
    }
}
