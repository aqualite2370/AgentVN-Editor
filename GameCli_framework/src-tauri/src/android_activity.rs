//! Restore a normally finished Android Activity in a cached Tauri process.
//! JNI is registered against the actual class, independent of applicationId.
use crate::android_activity_state::{ActivityRestoration, RestoreTicket};
use jni::{objects::{GlobalRef, JObject}, sys::{jboolean, jint, JNI_FALSE, JNI_TRUE},
    JNIEnv, JavaVM, NativeMethod};
use std::{collections::HashMap, ffi::c_void, panic::AssertUnwindSafe, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Manager};

#[derive(Default)]
struct Activities {
    ownership: ActivityRestoration,
    references: HashMap<i32, GlobalRef>,
}
static APP: OnceLock<AppHandle> = OnceLock::new();
static VM: OnceLock<JavaVM> = OnceLock::new();
static ACTIVITIES: OnceLock<Mutex<Activities>> = OnceLock::new();

fn activities() -> std::sync::MutexGuard<'static, Activities> {
    ACTIVITIES.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

pub fn install(app: AppHandle, window: tauri::WebviewWindow) -> tauri::Result<()> {
    let _ = APP.set(app);
    window.with_webview(|webview| {
        webview.jni_handle().exec(|env, activity, _| {
            let result = register(env, activity);
            if let Err(error) = result {
                let _ = env.exception_clear();
                crate::append_player_log(&format!("Android lifecycle bridge initialization failed: {error}"));
            }
        });
    })
}

pub fn register(env: &mut JNIEnv<'_>, activity: &JObject<'_>) -> jni::errors::Result<()> {
    let class = env.get_object_class(activity)?;
    env.register_native_methods(class, &[
        NativeMethod {
            name: "runtimeActivityCreated".into(), sig: "(I)Z".into(),
            fn_ptr: activity_created as *mut c_void,
        },
        NativeMethod {
            name: "runtimeActivityDestroyed".into(), sig: "(IZ)V".into(),
            fn_ptr: activity_destroyed as *mut c_void,
        },
    ])?;
    let _ = VM.set(env.get_java_vm()?);
    let id = env.call_method(activity, "getId", "()I", &[])?.i()?;
    let reference = env.new_global_ref(activity)?;
    {
        let mut state = activities();
        state.ownership.initialize(id);
        state.references.insert(id, reference);
    }
    env.call_method(activity, "enableRuntimeRestoration", "()V", &[])?;
    Ok(())
}

extern "system" fn activity_created(mut env: JNIEnv<'_>, activity: JObject<'_>, id: jint) -> jboolean {
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
        let reference = env.new_global_ref(activity).map_err(|e| e.to_string())?;
        {
            let mut state = activities();
            state.ownership.created(id);
            state.references.insert(id, reference);
        }
        // Wake the existing Rust event loop. Actual restoration is deferred
        // until MainEventsCleared and the old functional window is gone.
        APP.get().ok_or("Runtime is not initialized")?
            .run_on_main_thread(|| {}).map_err(|e| e.to_string())
    }));
    match result {
        Ok(Ok(())) => JNI_TRUE,
        _ => {
            let _ = env.exception_clear();
            crate::append_player_log("Android replacement Activity could not request window restoration.");
            JNI_FALSE
        }
    }
}

extern "system" fn activity_destroyed(
    _env: JNIEnv<'_>, _activity: JObject<'_>, id: jint, changing_configuration: jboolean,
) {
    let _ = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let mut state = activities();
        state.ownership.destroyed(id, changing_configuration != JNI_FALSE);
        if changing_configuration == JNI_FALSE {
            state.references.remove(&id);
        }
    }));
    if let Some(app) = APP.get() {
        let _ = app.run_on_main_thread(|| {});
    }
}

fn show_error(ticket: RestoreTicket, error: &str) {
    crate::append_player_log(&format!("Android Activity {} restoration failed: {error}", ticket.activity));
    let reference = activities().references.get(&ticket.activity).cloned();
    if let (Some(vm), Some(reference)) = (VM.get(), reference) {
        if let Ok(mut env) = vm.attach_current_thread() {
            if let Ok(message) = env.new_string("无法恢复游戏窗口。可以重试，或关闭后重新打开游戏。") {
                let _ = env.call_method(reference.as_obj(), "showRuntimeRestoreError",
                    "(Ljava/lang/String;)V", &[(&message).into()]);
                let _ = env.exception_clear();
            }
        }
    }
}

pub fn restore_pending(app: &AppHandle) {
    let windows_empty = app.webview_windows().is_empty();
    let Some(ticket) = activities().ownership.claim(windows_empty) else {
        return;
    };
    let result = (|| -> Result<tauri::WebviewWindow, String> {
        let configs = app.config().app.windows.iter().filter(|config| config.create).collect::<Vec<_>>();
        if configs.len() != 1 {
            return Err("Android Runtime requires one configured game window".into());
        }
        // Old Wry OnDestroy is queued separately from Tauri's window removal.
        // Never share its registry key, even when the Activity id is reused.
        let mut config = (*configs[0]).clone();
        config.label = ticket.window_label();
        tauri::WebviewWindowBuilder::from_config(app, &config)
            .and_then(|builder| builder.build()).map_err(|e| e.to_string())
    })();
    let committed = activities().ownership.complete(ticket, result.is_ok());
    match result {
        Err(error) => show_error(ticket, &error),
        Ok(_) if committed => {
            crate::append_player_log(&format!("Android Runtime window restored for Activity {}.", ticket.activity));
        }
        Ok(window) => {
            // The replacement died while its WebView was being built. Only
            // this just-created handle exists; no other restore can be in
            // flight on the event loop until this callback has returned.
            let _ = window.destroy();
        }
    }
}
